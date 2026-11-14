import {scanReport} from './lib/scan-report.mjs';
import { ckdReport } from './lib/ckd-report.mjs';
import { hsCode } from './public/hs-code.js';
import { createServer } from 'node:http';
import { readFile, open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { openDatabase, transaction } from './lib/db.mjs';
import { digest, hashPassword, verifyPassword, publicUser, issueSession, sessionUser, roles } from './lib/auth.mjs';
import { parseCSV, excel, streamZip, reportWorkbook } from './lib/formats.mjs';
import { initCkd, parseCkdWorkbook, importCkdWorkbook, checkCkd, saveCkd, ckdOverview, deleteCkdHistory } from './lib/ckd.mjs';
import { scanQuantity } from './lib/scan-quantity.mjs';
import { stockData } from './lib/stock-data.mjs';
import { MAX_MM_BYTES,parseMMInWorker } from './lib/mm-workbook.mjs';
import { importMMRows,listMM } from './lib/mm-data.mjs';
import { parseCuttingInWorker } from './lib/cutting-workbook.mjs';
import { cuttingStatus,importCutting,lookupCutting,saveCuttingScan } from './lib/cutting-data.mjs';
import {initHolding,holdingReference,importHolding,holdingLookup,holdingPreferences,receiveHolding,withdrawHolding,editHolding,editHoldingGroup,holdingInventory,holdingEvents,holdingReport} from './lib/holding.mjs';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const text = (value, title, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `${title}: cần nhập từ 1 đến ${max} ký tự.`);
  return value.trim();
};
const positive = (value, title) => {
  if (!Number.isSafeInteger(Number(value)) || Number(value) <= 0 || Number(value) > 1_000_000_000) fail(400, `${title} phải là số nguyên dương, tối đa 1 tỷ.`);
  return Number(value);
};
const norm = value => value.trim().toUpperCase();
const requestId = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(value)) fail(400, 'Mã yêu cầu không hợp lệ.');
  return value;
};
function validPassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) fail(400, 'Mật khẩu phải có từ 8 đến 128 ký tự.');
  return value;
}
async function jsonBody(req, limit = 5 * 1024 * 1024) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Yêu cầu phải dùng JSON.');
  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) fail(413, 'Dữ liệu quá lớn; ảnh tối đa 3 MB.');
    chunks.push(chunk);
  }
  try { const value = JSON.parse(Buffer.concat(chunks)); if (!value || Array.isArray(value) || typeof value !== 'object') throw Error(); return value; }
  catch { fail(400, 'Dữ liệu JSON không hợp lệ.'); }
}
async function workbookBody(req,label='MM'){
  if(req.headers['content-type']?.split(';')[0]!=='application/octet-stream')fail(415,'Gửi trực tiếp file Excel .xls hoặc .xlsx.');
  if(Number(req.headers['content-length'])>MAX_MM_BYTES)fail(413,`File ${label} tối đa 32 MB.`);
  const chunks=[];let total=0;
  for await(const chunk of req){total+=chunk.length;if(total>MAX_MM_BYTES)fail(413,`File ${label} tối đa 32 MB.`);chunks.push(chunk);}
  if(!total)fail(400,`File ${label} rỗng.`);return Buffer.concat(chunks,total);
}
function imageData(source) {
  if (!source) return { mime: null, buffer: null };
  if (typeof source !== 'string') fail(400, 'Ảnh không hợp lệ.');
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(source);
  if (!match) fail(400, 'Chỉ nhận ảnh JPEG, PNG hoặc WebP.');
  const buffer = Buffer.from(match[2], 'base64'), mime = match[1];
  const valid = mime === 'image/jpeg' ? buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255])) : mime === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (!valid || buffer.length > 3 * 1024 * 1024) fail(400, 'Ảnh không hợp lệ hoặc lớn hơn 3 MB.');
  return { mime, buffer };
}

export async function createApp({ db = openDatabase(), origin = process.env.APP_ORIGIN || '', production = process.env.NODE_ENV === 'production', recoveryArchive=fileURLToPath(new URL('./private/recovery-backup.zip',import.meta.url)) } = {}) {
  initCkd(db);
  initHolding(db);
  if (production && !/^https:\/\/[^/]+$/.test(origin)) throw new Error('Production cần APP_ORIGIN=https://ten-mien-cua-ban (không có dấu / cuối).');
  const dummy = await hashPassword('unused-' + crypto.randomUUID());
  const send = (res, status, data, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(data)); };
  const cookie = (token, expired = false) => `wa_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${expired ? 0 : 28800}${production ? '; Secure' : ''}`;
  const writeAccess = u => { if (!['admin', 'inspector'].includes(u.role)) fail(403, 'Tài khoản chỉ có quyền xem.'); };
  const adminAccess = u => { if (u.role !== 'admin') fail(403, 'Chỉ quản trị viên được thực hiện thao tác này.'); };

  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(req.url, 'http://localhost'), path = url.pathname;
      if (!path.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Phương thức không được hỗ trợ.');
        if(path==='/downloads/WorkArea-Android-1.0.0.apk'){
          const buffer=await readFile(resolve(publicDir,'downloads/WorkArea-Android-1.0.0.apk'));
          res.writeHead(200,{'Content-Type':'application/vnd.android.package-archive','Content-Disposition':'attachment; filename="WorkArea-Android-1.0.0.apk"','Content-Length':buffer.length,'Cache-Control':'no-cache'});
          return res.end(req.method==='HEAD'?undefined:buffer);
        }
        const files = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/icon.svg': ['icon.svg', 'image/svg+xml'], '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'] };
        Object.assign(files,{'/holding.js':['holding.js','text/javascript'],'/holding.css':['holding.css','text/css'],'/hs-code.js':['hs-code.js','text/javascript'],'/cutting.css':['cutting.css','text/css'],'/cutting.js':['cutting.js','text/javascript'],'/ckd.js':['ckd.js','text/javascript'],'/vendor/JsBarcode.code128-3.12.3.min.js':['vendor/JsBarcode.code128-3.12.3.min.js','text/javascript'],'/vendor/jsbarcode-LICENSE':['vendor/jsbarcode-LICENSE','text/plain'],'/scanner.js':['scanner.js','text/javascript'],'/scanner-tools.js':['scanner-tools.js','text/javascript'],'/scanner.css':['scanner.css','text/css'],'/vendor/zxing-0.21.3.min.js':['vendor/zxing-0.21.3.min.js','text/javascript'],'/vendor/zxing-LICENSE':['vendor/zxing-LICENSE','text/plain']});
        const asset = files[path]; if (!asset) fail(404, 'Không tìm thấy trang.');
        const buffer = await readFile(resolve(publicDir, asset[0]));
        res.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8', 'Cache-Control': path.startsWith('/vendor/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : buffer);
      }
      res.setHeader('Cache-Control', 'no-store');
      if (req.method === 'GET' && path === '/api/health') return send(res, 200, { ok: true, app: 'work-area',build:'recovery-download-20261114-35' });
      if (!['GET', 'POST', 'DELETE'].includes(req.method)) fail(405, 'Phương thức không được hỗ trợ.');
      const mutating = req.method !== 'GET';
      if (mutating && req.headers.origin) {
        const allowed = origin || `http://${req.headers.host}`;
        if (req.headers.origin !== allowed) fail(403, 'Nguồn yêu cầu không hợp lệ.');
      }
      if (req.method === 'GET' && path === '/api/me') {
        const u = sessionUser(db, req.headers.cookie);
        return send(res, 200, { user: u ? publicUser(u) : null, csrf: u?.csrf || null, needsSetup: db.prepare('SELECT COUNT(*) n FROM users').get().n === 0 });
      }
      if (req.method === 'POST' && path === '/api/login') {
        const body = await jsonBody(req), username = text(body.username, 'Tên đăng nhập', 64).toLowerCase();
        const now = Date.now(), key = digest(username), globalKey = 'all-logins';
        db.prepare('DELETE FROM login_attempts WHERE until < ?').run(now);
        for (const [k, limit] of [[key, 8], [globalKey, 100]]) {
          const limitRow = db.prepare('SELECT * FROM login_attempts WHERE attempt_key=?').get(k);
          if (limitRow && limitRow.count >= limit) fail(429, 'Quá nhiều lần đăng nhập. Vui lòng thử lại sau 15 phút.');
        }
        const addAttempt = db.prepare('INSERT INTO login_attempts VALUES (?,1,?) ON CONFLICT(attempt_key) DO UPDATE SET count=count+1');
        addAttempt.run(key, now + 900_000); addAttempt.run(globalKey, now + 900_000);
        const u = db.prepare('SELECT * FROM users WHERE username=?').get(username);
        const valid = await verifyPassword(body.password, u?.password || dummy);
        if (!u || !u.active || !valid) fail(401, 'Tên đăng nhập hoặc mật khẩu không đúng.');
        db.prepare('DELETE FROM login_attempts WHERE attempt_key=?').run(key);
        db.prepare('UPDATE login_attempts SET count=MAX(count-1,0) WHERE attempt_key=?').run(globalKey);
        const s = issueSession(db, u.id);
        return send(res, 200, { user: publicUser(u), csrf: s.csrf }, { 'Set-Cookie': cookie(s.token) });
      }
      const u = sessionUser(db, req.headers.cookie);
      if (!u) fail(401, 'Vui lòng đăng nhập để sử dụng dữ liệu công việc.');
      if (mutating && req.headers['x-csrf-token'] !== u.csrf) fail(403, 'Phiên thao tác không hợp lệ. Hãy tải lại trang.');
      if(req.method==='GET'&&path==='/api/admin/recovery-backup'){
        adminAccess(u);let file;
        try{file=await open(recoveryArchive,'r');}catch(error){if(error.code==='ENOENT')fail(404,'Chưa có bản sao lưu để tải.');throw error;}
        try{const info=await file.stat();res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="WorkArea-Recovery.zip"','Content-Length':info.size,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});await pipeline(file.createReadStream(),res);}finally{await file.close();}
        return;
      }
      if(path.startsWith('/api/holding/v2/')){
        const action=path.slice('/api/holding/v2/'.length),query=Object.fromEntries(url.searchParams);
        if(req.method==='GET'&&action==='reference')return send(res,200,holdingReference(db));
        if(req.method==='GET'&&action==='lookup')return send(res,200,holdingLookup(db,query.barcode));
        if(req.method==='GET'&&action==='preferences')return send(res,200,holdingPreferences(db,u.id));
        if(req.method==='POST'&&action==='preferences'){writeAccess(u);return send(res,200,holdingPreferences(db,u.id,await jsonBody(req)));}
        if(req.method==='GET'&&action==='inventory')return send(res,200,holdingInventory(db,query));
        if(req.method==='GET'&&action==='events'){const events=holdingEvents(db,query);return send(res,200,{events,next:events.length===100?events.at(-1).id:null});}
        if(req.method==='POST'&&action==='receive'){writeAccess(u);const b=await jsonBody(req);return send(res,201,receiveHolding(db,b,u.id,imageData(b.image)));}
        if(req.method==='POST'&&action==='withdraw'){writeAccess(u);return send(res,200,withdrawHolding(db,await jsonBody(req),u.id));}
        if(req.method==='POST'&&action==='edit'){writeAccess(u);return send(res,200,editHolding(db,await jsonBody(req),u.id));}
        if(req.method==='POST'&&action==='edit-group'){writeAccess(u);return send(res,200,editHoldingGroup(db,await jsonBody(req),u.id));}
        if(req.method==='POST'&&action==='import'){
          adminAccess(u);let name;try{name=decodeURIComponent(req.headers['x-mm-file-name']||'');}catch{fail(400,'Tên file không hợp lệ.');}name=text(name,'Tên file',200);if(!/\.(xls|xlsx)$/i.test(name))fail(400,'Chọn file .xls hoặc .xlsx.');
          const bytes=await workbookBody(req,'Holding');let parsed;try{parsed=await parseMMInWorker(bytes);}catch(e){fail(400,e.message);}return send(res,200,importHolding(db,parsed,name,query.kind,u.id));
        }
        const image=/^entries\/(\d+)\/image$/.exec(action);
        if(req.method==='GET'&&image){const r=db.prepare('SELECT image_type,image FROM holding_entries WHERE id=?').get(Number(image[1]));if(!r?.image)fail(404,'Chưa có ảnh.');res.writeHead(200,{'Content-Type':r.image_type,'Cache-Control':'no-store'});return res.end(r.image);}
        if(req.method==='GET'&&action==='export'){const bytes=holdingReport(db,query,u);res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="work-area-holding.xlsx"'});return res.end(bytes);}
        fail(404,'Không tìm thấy chức năng Holding.');
      }
      if (req.method === 'GET' && path === '/api/preferences') {
        const row=db.prepare('SELECT navigation,continuous_scan,updated_at FROM user_preferences WHERE user_id=?').get(u.id);
        return send(res,200,{navigation:row ? JSON.parse(row.navigation) : ['home','scan','assistant','account'],continuous_scan:row ? Boolean(row.continuous_scan) : true,updated_at:row?.updated_at || null});
      }
      if (req.method === 'POST' && path === '/api/preferences') {
        const body=await jsonBody(req),hasNavigation=Object.hasOwn(body,'navigation'),hasContinuous=Object.hasOwn(body,'continuous_scan'),navigation=hasNavigation ? body.navigation : ['home','scan','assistant','account'];
        const allowed=['home','scan','ckd','cut','holding','mm','assistant','account'];
        if (!hasNavigation && !hasContinuous) fail(400,'Cần gửi phím tắt hoặc chế độ quét.');
        if (hasContinuous && typeof body.continuous_scan!=='boolean') fail(400,'Chế độ quét liên tục phải là bật hoặc tắt.');
        if (!Array.isArray(navigation) || navigation.length<3 || navigation.length>5 || new Set(navigation).size!==navigation.length || navigation.some(x=>typeof x!=='string' || !allowed.includes(x))) fail(400,'Chọn từ 3 đến 5 phím tắt khác nhau trong danh sách.');
        db.prepare('INSERT INTO user_preferences(user_id,navigation,continuous_scan) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET navigation=CASE WHEN ? THEN excluded.navigation ELSE user_preferences.navigation END,continuous_scan=CASE WHEN ? THEN excluded.continuous_scan ELSE user_preferences.continuous_scan END,updated_at=CURRENT_TIMESTAMP').run(u.id,JSON.stringify(navigation),body.continuous_scan===false?0:1,hasNavigation?1:0,hasContinuous?1:0);
        const saved=db.prepare('SELECT navigation,continuous_scan FROM user_preferences WHERE user_id=?').get(u.id);
        return send(res,200,{navigation:JSON.parse(saved.navigation),continuous_scan:Boolean(saved.continuous_scan)});
      }
      if (req.method === 'POST' && path === '/api/logout') {
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(u.token_hash);
        return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', true) });
      }
      if (req.method === 'POST' && path === '/api/password') {
        const body = await jsonBody(req);
        if (!await verifyPassword(body.oldPassword, u.password)) fail(400, 'Mật khẩu hiện tại không đúng.');
        const password = await hashPassword(validPassword(body.password));
        transaction(db, () => { db.prepare('UPDATE users SET password=? WHERE id=?').run(password, u.id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id); });
        return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', true) });
      }
      if (req.method === 'GET' && path === '/api/users') {
        adminAccess(u); return send(res, 200, { users: db.prepare('SELECT id,username,name,role,active FROM users ORDER BY id').all() });
      }
      if (req.method === 'POST' && path === '/api/users') {
        adminAccess(u); const b = await jsonBody(req);
        const username = text(b.username, 'Tên đăng nhập', 64).toLowerCase();
        if (!/^[a-z0-9._-]{3,64}$/.test(username)) fail(400, 'Tên đăng nhập: 3–64 ký tự a–z, số, dấu chấm, gạch ngang hoặc gạch dưới.');
        if (!roles.includes(b.role)) fail(400, 'Quyền không hợp lệ.');
        const name = text(b.name, 'Họ tên', 100), password = await hashPassword(validPassword(b.password));
        if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) fail(409, 'Tên đăng nhập đã tồn tại.');
        db.prepare('INSERT INTO users(username,name,password,role) VALUES (?,?,?,?)').run(username, name, password, b.role);
        return send(res, 201, { ok: true });
      }
      if (req.method === 'GET' && path === '/api/stats') return send(res, 200, {
        scans: db.prepare('SELECT COUNT(*) n FROM scans').get().n,
        materials: db.prepare('SELECT COUNT(*) n FROM (SELECT item_code FROM materials UNION SELECT item_code FROM mm_inventory)').get().n,
        boxes: db.prepare('SELECT COUNT(*) n FROM boxes').get().n,
        holding: db.prepare('SELECT COALESCE(SUM(remaining_qty),0) n FROM holding_entries').get().n
      });
      if (req.method === 'GET' && path === '/api/ckd/workbooks') return send(res,200,{workbooks:db.prepare('SELECT w.*,(SELECT COUNT(*) FROM ckd_models WHERE workbook_id=w.id) models,(SELECT COUNT(*) FROM ckd_orders WHERE workbook_id=w.id) orders FROM ckd_workbooks w ORDER BY w.id DESC').all()});
      if (req.method === 'POST' && path === '/api/ckd/import') {
        writeAccess(u);const b=await jsonBody(req,25*1024*1024);
        if(typeof b.file!=='string'||b.file.length>24*1024*1024||!/^data:.*?;base64,[A-Za-z0-9+/=]+$/.test(b.file))fail(400,'Chọn file .xlsx tối đa 18 MB.');
        try {const parsed=parseCkdWorkbook(Buffer.from(b.file.slice(b.file.indexOf(',')+1),'base64'));return send(res,201,importCkdWorkbook(db,parsed,text(b.name,'Tên file / đơn hàng',200),u.id));}catch(e){fail(400,e.message);}
      }
      if (req.method === 'POST' && ['/api/ckd/pair/check','/api/ckd/pair/save'].includes(path)) {
        const b=await jsonBody(req);if(path.endsWith('/save'))writeAccess(u);
        const images=[];
        if(path.endsWith('/save')&&b.images){if(typeof b.images!=='object'||Array.isArray(b.images)||Object.keys(b.images).some(k=>!['samsung','item'].includes(k)))fail(400,'Ảnh CKD không hợp lệ.');for(const slot of ['samsung','item'])if(b.images[slot]){const value=b.images[slot],source=typeof value==='string'?value:value?.source;const parsed={slot,...imageData(source)};if(!parsed.buffer)fail(400,'Missing capture image');if(typeof value==='object'&&value.thumbnail){const thumb=imageData(value.thumbnail);if(thumb.mime!=='image/jpeg'||thumb.buffer.length>65536)fail(400,'Invalid image thumbnail');parsed.thumbnail=thumb.buffer;}images.push(parsed);}}
        try {const result=path.endsWith('/save')?saveCkd(db,b,u.id,images):checkCkd(db,b);return send(res,path.endsWith('/save')&&!result.duplicate?201:200,result);}catch(e){fail(400,e.message);}
      }
      if(req.method==='POST'&&path==='/api/ckd/history/delete'){adminAccess(u);return send(res,200,deleteCkdHistory(db,await jsonBody(req),u.id));}
      const ckdImage=/^\/api\/ckd\/checks\/(\d+)\/image\/(samsung|item)$/.exec(path);
      if(req.method==='GET'&&ckdImage){const image=db.prepare('SELECT mime,image FROM ckd_check_images WHERE check_id=? AND slot=?').get(Number(ckdImage[1]),ckdImage[2]);if(!image)fail(404,'Chưa có ảnh đối chiếu.');res.writeHead(200,{'Content-Type':image.mime,'Cache-Control':'no-store'});res.end(image.image);return;}
      if (req.method === 'GET' && ['/api/ckd/history','/api/ckd/export','/api/ckd/report.zip'].includes(path)) {
        const workbook=Number(url.searchParams.get('workbook_id')),all=url.searchParams.get('scope')==='all';
        if(!all&&(!Number.isSafeInteger(workbook)||workbook<1))fail(400,'Chon SO.');
        if(path.endsWith('/history')){const report=ckdOverview(db,all?0:workbook),before=Number(url.searchParams.get('before'))||0,rows=report.checks.filter(c=>!before||c.id<before),checks=rows.slice(0,200);return send(res,200,{checks,next:rows.length>200?checks.at(-1).id:null,count:report.checks.length,max_id:report.checks[0]?.id||0,summary:report.summary,unsold:report.unsold,totals:report.summary.filter(g=>g.boxes>0)});}
        let report;try{report=ckdReport(db,all?0:workbook,{exportedBy:u.name,imageLinks:path.endsWith('.zip')});}catch(e){fail(400,e.message);}
        if(path.endsWith('.zip')){res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="work-area-ckd-report.zip"'});try{await streamZip(res,report.entries());}catch{res.destroy();}return;}
        res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="work-area-ckd.xlsx"'});res.end(report.workbookBytes);return;
      }
      if(req.method==='GET'&&path==='/api/cutting/status')return send(res,200,cuttingStatus(db));
      if(req.method==='GET'&&path==='/api/cutting/template'){
        const bytes=excel([['Model Code','Model Name','MI 1st','AI 1st','MI 2nd','AI 2nd','Item Name','Maker 1st','Maker 2nd','BOM QTY','Location','FCN']]);
        res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="ai-mi-template.xlsx"'});res.end(bytes);return;
      }
      if(req.method==='POST'&&path==='/api/cutting/import-file'){
        adminAccess(u);let name;try{name=decodeURIComponent(req.headers['x-mm-file-name']||'');}catch{fail(400,'Tên file không hợp lệ.');}name=text(name,'Tên file',200);
        const bytes=await workbookBody(req,'quy đổi AI/MI');let parsed;try{parsed=await parseCuttingInWorker(bytes);}catch(e){fail(400,e.message);}
        return send(res,201,importCutting(db,parsed,name,u.id));
      }
      if(req.method==='GET'&&path==='/api/cutting/lookup'){
        try{return send(res,200,lookupCutting(db,{code:url.searchParams.get('code'),model:url.searchParams.get('model')||'',direction:url.searchParams.get('direction')||'auto'}));}catch(e){fail(400,e.message);}
      }
      if(req.method==='POST'&&path==='/api/cutting/scans'){
        writeAccess(u);const b=await jsonBody(req);const id=requestId(b.request_id),image=imageData(b.image);
        const previous=db.prepare('SELECT user_id FROM cutting_scans WHERE request_id=?').get(id);if(previous&&previous.user_id!==u.id)fail(409,'Mã yêu cầu đã thuộc tài khoản khác.');
        try{return send(res,201,saveCuttingScan(db,{request_id:id,user_id:u.id,code:b.code,model:b.model||'',direction:b.direction||'auto',image}));}catch(e){fail(400,e.message);}
      }
      if(req.method==='GET'&&path==='/api/cutting/scans'){
        const before=Number(url.searchParams.get('before'))||Number.MAX_SAFE_INTEGER;
        const rows=db.prepare('SELECT s.id,s.code,s.snapshot,s.created_at,u.name AS scanner,s.image IS NOT NULL AS has_image FROM cutting_scans s JOIN users u ON u.id=s.user_id WHERE s.id<? ORDER BY s.id DESC LIMIT 50').all(before);
        return send(res,200,{scans:rows.map(({snapshot,...row})=>{const value=JSON.parse(snapshot);return {...row,count:value.count,targets:[...new Set(value.matches.map(m=>m.target_code))],model:value.model,direction:value.direction};}),next:rows.length===50?rows.at(-1).id:null,total:db.prepare('SELECT COUNT(*) n FROM cutting_scans').get().n});
      }
      const cuttingImage=/^\/api\/cutting\/scans\/(\d+)\/image$/.exec(path);
      if(req.method==='GET'&&cuttingImage){const row=db.prepare('SELECT image_type,image FROM cutting_scans WHERE id=?').get(Number(cuttingImage[1]));if(!row?.image)fail(404,'Chưa có ảnh đối chiếu.');res.writeHead(200,{'Content-Type':row.image_type});res.end(row.image);return;}
      const cuttingDetail=/^\/api\/cutting\/scans\/(\d+)$/.exec(path);
      if(req.method==='GET'&&cuttingDetail){const row=db.prepare('SELECT s.id,s.code,s.snapshot,s.created_at,s.image IS NOT NULL AS has_image,u.name AS scanner FROM cutting_scans s JOIN users u ON u.id=s.user_id WHERE s.id=?').get(Number(cuttingDetail[1]));if(!row)fail(404,'Không tìm thấy lượt quy đổi.');return send(res,200,{...JSON.parse(row.snapshot),id:row.id,scanner:row.scanner,created_at:row.created_at,has_image:row.has_image});}
      if (req.method === 'GET' && path === '/api/materials') {
        const q = (url.searchParams.get('q') || '').slice(0, 200);
        const field=url.searchParams.get('field')||'all';
        const fields={all:'m.item_code || m.samsung || m.item || m.description || m.maker || m.location || m.vendor',location:'m.location',item_code:'m.item_code',spec:'m.description'};
        if(!Object.hasOwn(fields,field))fail(400,'Chọn Location, Item code hoặc Spec.');
        const offset=Number(url.searchParams.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)fail(400,'Trang tra cứu không hợp lệ.');
        return send(res,200,listMM(db,{q,field,offset}));
      }
      if(req.method==='POST'&&path==='/api/materials/import-file'){
        adminAccess(u);
        let name;try{name=decodeURIComponent(req.headers['x-mm-file-name']||'');}catch{fail(400,'Tên file không hợp lệ.');}
        name=text(name,'Tên file',200);
        const bytes=await workbookBody(req);
        let parsed;try{parsed=await parseMMInWorker(bytes);}catch(e){fail(400,e.message);}
        return send(res,200,importMMRows(db,parsed,name));
      }
      if (req.method === 'POST' && path === '/api/materials/import') {
        adminAccess(u); const b = await jsonBody(req,46*1024*1024);
        if(Object.hasOwn(b,'file')){
          if(typeof b.file!=='string'||b.file.length>Math.ceil(MAX_MM_BYTES/3)*4+200||!/^data:[^,]*;base64,[A-Za-z0-9+/=]+$/.test(b.file))fail(400,'Chọn file MM .xls / .xlsx tối đa 32 MB.');
          const bytes=Buffer.from(b.file.slice(b.file.indexOf(',')+1),'base64');
          if(bytes.length>MAX_MM_BYTES)fail(400,'File MM tối đa 32 MB.');
          const name=text(b.name,'Tên file',200);
          let parsed;try{parsed=await parseMMInWorker(bytes);}catch(e){fail(400,e.message);}
          return send(res,200,importMMRows(db,parsed,name));
        }
        if (typeof b.csv !== 'string' || b.csv.length > 2_000_000) fail(400, 'CSV tối đa 2 MB.');
        let rows;
        try { rows = parseCSV(b.csv); } catch (e) { fail(400, e.message); }
        const aliases={item_nm:'item',item_name:'item',mark:'maker',barcode:'samsung',spec:'description'};
        const headers = rows.shift()?.map(value=>{const key=value.trim().toLowerCase().replace(/\s+/g,'_');return aliases[key]||key;});
        const keys = ['item_code', 'samsung', 'item', 'description', 'maker', 'vendor', 'location', 'selling_qty', 'moq'];
        if (!headers || new Set(headers).size!==headers.length || keys.some(k => !headers.includes(k)) || headers.some(k=>![...keys,'qty','lot_no'].includes(k))) fail(400, `Cột CSV cần đủ và không trùng: ${keys.join(', ')}; có thể thêm qty, lot_no.`);
        if (!rows.length || rows.length > 10000) fail(400, 'CSV cần có từ 1 đến 10.000 dòng.');
        const checked = rows.map((row, i) => {
          if (row.length !== headers.length) fail(400, `Dòng ${i + 2}: số cột không đúng.`);
          const r = Object.fromEntries(headers.map((k, j) => [k, row[j]]));
          r.item_code = norm(text(r.item_code, `Dòng ${i + 2}: ITEM`));
          r.samsung = norm(text(r.samsung, `Dòng ${i + 2}: Samsung`));
          r.item = text(r.item, `Dòng ${i + 2}: tên hàng`);
          r.maker = r.maker.trim()?norm(text(r.maker, `Dòng ${i + 2}: maker`)):'';
          if(!r.maker && !r.vendor.trim())fail(400,`Dòng ${i+2}: cần Maker hoặc Vendor.`);
          for (const k of ['description','vendor','location']) if (r[k].length > 1000) fail(400, `Dòng ${i + 2}: ${k} quá dài.`);
          r.selling_qty = positive(r.selling_qty, `Dòng ${i + 2}: Selling Q’ty`); r.moq = positive(r.moq, `Dòng ${i + 2}: MOQ`);
          r.qty=r.qty?.trim()?positive(r.qty,`Dòng ${i+2}: QTY Stock`):null;
          r.lot_no=r.lot_no?.trim()||'';if(r.lot_no.length>200)fail(400,`Dòng ${i+2}: Lot No quá dài.`);
          return r;
        });
        if (new Set(checked.map(r => r.item_code)).size !== checked.length || new Set(checked.map(r => r.samsung)).size !== checked.length) fail(400, 'CSV chứa ITEM hoặc mã Samsung trùng.');
        transaction(db, () => {
          const save = db.prepare('INSERT INTO materials VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(item_code) DO UPDATE SET samsung=excluded.samsung,item=excluded.item,description=excluded.description,maker=excluded.maker,vendor=excluded.vendor,location=excluded.location,selling_qty=excluded.selling_qty,moq=excluded.moq');
          const stock=db.prepare('INSERT INTO material_stock(item_code,qty,lot_no) VALUES (?,?,?) ON CONFLICT(item_code) DO UPDATE SET qty=CASE WHEN ? THEN excluded.qty ELSE material_stock.qty END,lot_no=CASE WHEN ? THEN excluded.lot_no ELSE material_stock.lot_no END');
          for (const row of checked){save.run(...keys.map(k => row[k]));stock.run(row.item_code,row.qty,row.lot_no,headers.includes('qty')?1:0,headers.includes('lot_no')?1:0);}
        });
        return send(res, 200, { count: checked.length });
      }
      const scanSelect = `SELECT s.id,s.barcode,s.raw_barcode,s.mode,s.quantity,s.prior_count,s.created_at,u.name AS scanner,COALESCE(ss.item_code,m.item_code) AS item_code,COALESCE(ss.item_name,m.item) AS item_name,COALESCE(ss.maker,m.maker) AS maker,COALESCE(ss.vendor,m.vendor) AS vendor,ss.lot_no,ss.quantity_source,CASE WHEN s.image IS NULL THEN 0 ELSE 1 END has_image FROM scans s JOIN users u ON u.id=s.user_id LEFT JOIN scan_stock ss ON ss.scan_id=s.id LEFT JOIN materials m ON m.item_code=COALESCE((SELECT item_code FROM materials WHERE samsung=s.barcode),s.barcode)`;
      const stockInfo=id=>db.prepare(`${scanSelect} WHERE s.id=?`).get(id);
      const stockSummary=()=>db.prepare(`SELECT UPPER(TRIM(item_code)) item_code,MAX(item_name) item_name,COUNT(*) scans,COUNT(quantity) quantity_count,SUM(quantity) total_quantity FROM (${scanSelect} WHERE s.mode='Stock') WHERE TRIM(COALESCE(item_code,''))<>'' GROUP BY UPPER(TRIM(item_code)) ORDER BY item_code`).all();
      const scanCount=(barcode,mode)=>db.prepare('SELECT COUNT(*) n FROM scans WHERE barcode=? AND mode=?').get(barcode,mode).n;
      const scanMode=()=>{
        const mode=url.searchParams.get('mode');
        if(mode!==null && !['HS','Stock','Label'].includes(mode))fail(400,'Loại quét không hợp lệ.');
        return mode;
      };
      if (req.method === 'GET' && path === '/api/scans/check') {
        const mode=url.searchParams.get('mode'),raw=norm(text(url.searchParams.get('barcode'),'Barcode',500)),barcode=mode==='HS'?hsCode(raw):raw;
        if (!['HS','Stock','Label'].includes(mode)) fail(400,'Loại quét không hợp lệ.');
        return send(res,200,{barcode,mode,count:scanCount(barcode,mode),scope:'server'});
      }
      if (req.method === 'GET' && path === '/api/scans') {
        const mode=scanMode();
        const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
        const rows = db.prepare(`${scanSelect} WHERE s.id < ? AND (? IS NULL OR s.mode=?) ORDER BY s.id DESC LIMIT 100`).all(before,mode,mode);
        const totals=db.prepare('SELECT COUNT(*) total,SUM(quantity) total_quantity,COUNT(quantity) quantity_count,COALESCE(MAX(id),0) max_id FROM scans WHERE (? IS NULL OR mode=?)').get(mode,mode);
        return send(res, 200, { scans: rows, next: rows.length === 100 ? rows.at(-1).id : null, mode, ...totals,...(mode==='Stock'?{stock_summary:stockSummary()}:{} ) });
      }
      if(req.method==='POST'&&path==='/api/scans/delete'){
        adminAccess(u);const b=await jsonBody(req);
        if(!['HS','Stock'].includes(b.mode))fail(400,'Chọn lịch sử HS hoặc Stock cần xóa.');
        const removed=transaction(db,()=>{
          if(b.all===true){if(!Number.isSafeInteger(b.through_id)||b.through_id<1)fail(400,'Thiếu mốc lịch sử cần xóa.');return db.prepare('DELETE FROM scans WHERE mode=? AND id<=?').run(b.mode,b.through_id).changes;}
          if(!Array.isArray(b.ids)||!b.ids.length||b.ids.length>1000||b.ids.some(id=>!Number.isSafeInteger(id)||id<1))fail(400,'Chọn từ 1 đến 1.000 lượt quét.');
          const ids=[...new Set(b.ids)],marks=ids.map(()=>'?').join(',');
          if(db.prepare(`SELECT COUNT(*) n FROM scans WHERE mode=? AND id IN (${marks})`).get(b.mode,...ids).n!==ids.length)fail(409,'Danh sách đã thay đổi. Tải lại lịch sử rồi chọn lại.');
          return db.prepare(`DELETE FROM scans WHERE mode=? AND id IN (${marks})`).run(b.mode,...ids).changes;
        });return send(res,200,{ok:true,deleted:removed});
      }
      if (req.method === 'POST' && path === '/api/scans') {
        writeAccess(u); const b = await jsonBody(req), id = requestId(b.request_id);
        const previous = db.prepare('SELECT id,user_id,barcode,mode,prior_count FROM scans WHERE request_id=?').get(id);
        if (previous) { if (previous.user_id !== u.id) fail(409, 'Mã yêu cầu đã tồn tại.'); return send(res, 200, { id: previous.id, duplicate: true,is_duplicate:previous.prior_count>0,prior_count:previous.prior_count,barcode_count:scanCount(previous.barcode,previous.mode),stock:previous.mode==='Stock'?stockInfo(previous.id):null }); }
        const rawBarcode=norm(text(b.mode==='HS'?(b.raw_barcode??b.barcode):b.barcode,'Barcode',500)),barcode=b.mode==='HS'?hsCode(rawBarcode):rawBarcode;
        if (!['HS','Stock','Label'].includes(b.mode)) fail(400, 'Loại quét không hợp lệ.');
        const image = imageData(b.image);
        const result=transaction(db,()=>{
          const before=scanCount(barcode,b.mode);
          if (b.mode!=='HS' && b.reject_duplicate === true && before>0) return {blocked:true,count:before};
          const stock=b.mode==='Stock'?stockData(db,barcode):null;
          const saved=db.prepare('INSERT INTO scans(request_id,barcode,mode,user_id,image_type,image,quantity,prior_count,raw_barcode) VALUES (?,?,?,?,?,?,?,?,?)').run(id,barcode,b.mode,u.id,image.mime,image.buffer,stock?.quantity??scanQuantity(barcode,b.mode),before,b.mode==='HS'?rawBarcode:null);
          if(stock)db.prepare('INSERT INTO scan_stock(scan_id,item_code,item_name,maker,vendor,lot_no,quantity_source) VALUES (?,?,?,?,?,?,?)').run(Number(saved.lastInsertRowid),stock.item_code,stock.item_name,stock.maker,stock.vendor,stock.lot_no,stock.quantity_source);
          return {id:Number(saved.lastInsertRowid),barcode_count:before+1,is_duplicate:before>0,prior_count:before};
        });
        if (result.blocked) return send(res,409,{error:`Mã đã có ${result.count} lượt trên server. Chưa lưu thêm.`,code:'DUPLICATE_SCAN',count:result.count});
        return send(res,201,{...result,stock:b.mode==='Stock'?stockInfo(result.id):null});
      }
      if (req.method === 'GET' && /^\/api\/scans\/\d+\/image$/.test(path)) {
        const r = db.prepare('SELECT image_type,image FROM scans WHERE id=?').get(Number(path.split('/')[3]));
        if (!r?.image) fail(404, 'Không có ảnh.');
        res.writeHead(200, { 'Content-Type': r.image_type }); return res.end(Buffer.from(r.image));
      }
      if (req.method === 'DELETE' && /^\/api\/scans\/\d+$/.test(path)) {
        adminAccess(u); const r = db.prepare('DELETE FROM scans WHERE id=?').run(Number(path.split('/')[3]));
        if (!r.changes) fail(404, 'Lượt quét không tồn tại.'); return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && path === '/api/export' && url.searchParams.get('kind')==='holding') {const bytes=holdingReport(db,{},u);res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename=work-area-holding.xlsx'});return res.end(bytes);}
      if (req.method === 'GET' && path === '/api/export') {
        const kind=url.searchParams.get('kind')||'scans';
        if(kind==='scans'){
          const mode=scanMode(),data=db.prepare(`${scanSelect} WHERE (? IS NULL OR s.mode=?) ORDER BY s.id DESC`).all(mode,mode),buffer=scanReport(db,data,mode,u);
          res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="work-area-${mode?mode.toLowerCase():'scans'}-report.xlsx"`});return res.end(buffer);
        }
        if(kind!=='boxes')fail(400,'Loại báo cáo không hợp lệ.');
        const data=db.prepare('SELECT b.*,u.name FROM boxes b JOIN users u ON u.id=b.user_id ORDER BY b.id DESC').all();
        const sheets=[{name:'Tổng quan',title:'TỔNG QUAN XÁC NHẬN BOX',rows:[['Chỉ tiêu','Giá trị'],['Box đã xác nhận',data.length],['Tổng QTY',data.reduce((n,r)=>n+r.qty,0)]]},{name:'Chi tiết',title:'CHI TIẾT XÁC NHẬN BOX',rows:[['STT','Phiếu / lô','Box','ITEM','QTY','Mục tiêu khi xác nhận','Người xác nhận','Thời gian UTC'],...data.map((r,i)=>[i+1,r.delivery,r.box_ref,r.item_code,r.qty,r.target_qty,r.name,r.created_at])]}];
        const buffer=reportWorkbook(sheets,{title:'BÁO CÁO XÁC NHẬN BOX',scope:'Toàn bộ lịch sử xác nhận box',exportedBy:u.name});res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="work-area-boxes-report.xlsx"'});return res.end(buffer);
      }

      function checkBox(b) {
        const labelA = norm(text(b.label_a, 'Nhãn Samsung', 500)), labelB = norm(text(b.label_b, 'Nhãn đối chiếu', 500));
        const itemCode = norm(text(b.item_code, 'ITEM')), delivery = norm(text(b.delivery, 'Phiếu/lô'));
        const m = db.prepare('SELECT * FROM materials WHERE item_code=?').get(itemCode);
        if (!m) return { pass: false, reason: 'ITEM chưa có trong MM. Cần nhập dữ liệu MM trước.' };
        const current = db.prepare('SELECT COUNT(*) boxes,COALESCE(SUM(qty),0) total FROM boxes WHERE delivery=? AND item_code=?').get(delivery, itemCode);
        const qty = positive(b.qty, 'MOQ box'), maker = norm(text(b.maker, 'Maker'));
        const pass = labelA === labelB && labelA === norm(m.samsung) && maker === norm(m.maker);
        const over = current.total + qty > m.selling_qty;
        return { pass, over, reason: pass ? 'Hai nhãn và Maker khớp dữ liệu MM.' : 'Nhãn hoặc Maker không khớp MM. Kiểm tra lại.', material: m, ...current, after: current.total + qty, qty, maker, labelA, labelB, delivery };
      }
      if (req.method === 'POST' && path === '/api/ckd/check') return send(res, 200, checkBox(await jsonBody(req)));
      if (req.method === 'POST' && path === '/api/ckd/confirm') {
        writeAccess(u); const b = await jsonBody(req), id = requestId(b.request_id), box = norm(text(b.box_ref, 'Mã box duy nhất'));
        const result = transaction(db, () => {
          const previous = db.prepare('SELECT * FROM boxes WHERE request_id=?').get(id);
          if (previous) { if (previous.user_id !== u.id) fail(409, 'Mã yêu cầu đã tồn tại.'); return { id: previous.id, duplicate: true }; }
          const check = checkBox(b);
          if (!check.pass) fail(400, check.reason);
          if (check.over) fail(409, 'Vượt Selling Q’ty của phiếu/lô. Chưa xác nhận box.');
          if (db.prepare('SELECT id FROM boxes WHERE delivery=? AND box_ref=?').get(check.delivery, box)) fail(409, 'Box đã được xác nhận trong phiếu/lô này.');
          const saved = db.prepare('INSERT INTO boxes(request_id,delivery,box_ref,item_code,label_a,label_b,maker,qty,target_qty,user_id) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, check.delivery, box, check.material.item_code, check.labelA, check.labelB, check.maker, check.qty, check.material.selling_qty, u.id);
          return { id: Number(saved.lastInsertRowid), total: check.after };
        });
        return send(res, result.duplicate ? 200 : 201, result);
      }
      if (req.method === 'GET' && path === '/api/holding') return send(res, 200, {
        balances: db.prepare('SELECT v.item_code,m.item,v.location,SUM(v.qty) qty FROM movements v JOIN materials m ON m.item_code=v.item_code GROUP BY v.item_code,v.location HAVING SUM(v.qty)<>0 ORDER BY v.item_code,v.location').all(),
        movements: db.prepare('SELECT v.*,u.name FROM movements v JOIN users u ON u.id=v.user_id ORDER BY v.id DESC LIMIT 100').all()
      });
      if(req.method==='POST'&&path==='/api/holding')fail(410,'Holding has been upgraded. Reload the page to use the new Holding room.');
      fail(404, 'Không tìm thấy chức năng.');
    } catch (e) {
      const constraint = e.code?.includes('CONSTRAINT') || (e.errcode && (e.errcode & 255) === 19);
      const status = e.status || (constraint ? 409 : 500);
      if (status === 500) console.error('Request error:', e.code || e.name);
      const message = e.status ? e.message : status === 409 ? 'Dữ liệu trùng hoặc không hợp lệ. Kiểm tra mã ITEM, Samsung hoặc box.' : 'Không thể xử lý yêu cầu. Vui lòng thử lại.';
      if (!res.headersSent) send(res, status, { error: message }); else res.end();
    }
  });
  server.requestTimeout = 300_000; server.headersTimeout = 15_000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createApp();
  const port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`Work Area: http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
