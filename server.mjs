import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { openDatabase, transaction } from './lib/db.mjs';
import { digest, hashPassword, verifyPassword, publicUser, issueSession, sessionUser, roles } from './lib/auth.mjs';
import { parseCSV, excel } from './lib/formats.mjs';

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
async function jsonBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Yêu cầu phải dùng JSON.');
  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 5 * 1024 * 1024) fail(413, 'Dữ liệu quá lớn; ảnh tối đa 3 MB.');
    chunks.push(chunk);
  }
  try { const value = JSON.parse(Buffer.concat(chunks)); if (!value || Array.isArray(value) || typeof value !== 'object') throw Error(); return value; }
  catch { fail(400, 'Dữ liệu JSON không hợp lệ.'); }
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

export async function createApp({ db = openDatabase(), origin = process.env.APP_ORIGIN || '', production = process.env.NODE_ENV === 'production' } = {}) {
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
        const files = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/icon.svg': ['icon.svg', 'image/svg+xml'], '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'] };
        Object.assign(files,{'/scanner.js':['scanner.js','text/javascript'],'/scanner-tools.js':['scanner-tools.js','text/javascript'],'/scanner.css':['scanner.css','text/css'],'/vendor/zxing-0.21.3.min.js':['vendor/zxing-0.21.3.min.js','text/javascript'],'/vendor/zxing-LICENSE':['vendor/zxing-LICENSE','text/plain']});
        const asset = files[path]; if (!asset) fail(404, 'Không tìm thấy trang.');
        const buffer = await readFile(resolve(publicDir, asset[0]));
        res.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8', 'Cache-Control': path.startsWith('/vendor/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : buffer);
      }
      res.setHeader('Cache-Control', 'no-store');
      if (req.method === 'GET' && path === '/api/health') return send(res, 200, { ok: true, app: 'work-area',build:'workspace-ui-20261113-2' });
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
      if (req.method === 'GET' && path === '/api/preferences') {
        const row=db.prepare('SELECT navigation,updated_at FROM user_preferences WHERE user_id=?').get(u.id);
        return send(res,200,{navigation:row ? JSON.parse(row.navigation) : ['home','scan','assistant','account'],updated_at:row?.updated_at || null});
      }
      if (req.method === 'POST' && path === '/api/preferences') {
        const body=await jsonBody(req),navigation=body.navigation;
        const allowed=['home','scan','ckd','cut','holding','mm','assistant','account'];
        if (!Array.isArray(navigation) || navigation.length<3 || navigation.length>5 || new Set(navigation).size!==navigation.length || navigation.some(x=>typeof x!=='string' || !allowed.includes(x))) fail(400,'Chọn từ 3 đến 5 phím tắt khác nhau trong danh sách.');
        db.prepare('INSERT INTO user_preferences(user_id,navigation) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET navigation=excluded.navigation,updated_at=CURRENT_TIMESTAMP').run(u.id,JSON.stringify(navigation));
        return send(res,200,{navigation});
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
        materials: db.prepare('SELECT COUNT(*) n FROM materials').get().n,
        boxes: db.prepare('SELECT COUNT(*) n FROM boxes').get().n,
        holding: db.prepare('SELECT COALESCE(SUM(qty),0) n FROM movements').get().n
      });
      if (req.method === 'GET' && path === '/api/materials') {
        const q = (url.searchParams.get('q') || '').slice(0, 200);
        return send(res, 200, { materials: db.prepare('SELECT * FROM materials WHERE instr(lower(item_code || samsung || item || maker || location), lower(?)) > 0 ORDER BY item_code LIMIT 200').all(q), total: db.prepare('SELECT COUNT(*) n FROM materials').get().n });
      }
      if (req.method === 'POST' && path === '/api/materials/import') {
        adminAccess(u); const b = await jsonBody(req);
        if (typeof b.csv !== 'string' || b.csv.length > 2_000_000) fail(400, 'CSV tối đa 2 MB.');
        let rows;
        try { rows = parseCSV(b.csv); } catch (e) { fail(400, e.message); }
        const headers = rows.shift();
        const keys = ['item_code', 'samsung', 'item', 'description', 'maker', 'vendor', 'location', 'selling_qty', 'moq'];
        if (!headers || headers.length !== keys.length || keys.some(k => !headers.includes(k))) fail(400, `Cột CSV cần đủ và không trùng: ${keys.join(', ')}`);
        if (!rows.length || rows.length > 10000) fail(400, 'CSV cần có từ 1 đến 10.000 dòng.');
        const checked = rows.map((row, i) => {
          if (row.length !== headers.length) fail(400, `Dòng ${i + 2}: số cột không đúng.`);
          const r = Object.fromEntries(headers.map((k, j) => [k, row[j]]));
          r.item_code = norm(text(r.item_code, `Dòng ${i + 2}: ITEM`));
          r.samsung = norm(text(r.samsung, `Dòng ${i + 2}: Samsung`));
          r.item = text(r.item, `Dòng ${i + 2}: tên hàng`);
          r.maker = norm(text(r.maker, `Dòng ${i + 2}: maker`));
          for (const k of ['description','vendor','location']) if (r[k].length > 1000) fail(400, `Dòng ${i + 2}: ${k} quá dài.`);
          r.selling_qty = positive(r.selling_qty, `Dòng ${i + 2}: Selling Q’ty`); r.moq = positive(r.moq, `Dòng ${i + 2}: MOQ`);
          return r;
        });
        if (new Set(checked.map(r => r.item_code)).size !== checked.length || new Set(checked.map(r => r.samsung)).size !== checked.length) fail(400, 'CSV chứa ITEM hoặc mã Samsung trùng.');
        transaction(db, () => {
          const save = db.prepare('INSERT INTO materials VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(item_code) DO UPDATE SET samsung=excluded.samsung,item=excluded.item,description=excluded.description,maker=excluded.maker,vendor=excluded.vendor,location=excluded.location,selling_qty=excluded.selling_qty,moq=excluded.moq');
          for (const row of checked) save.run(...keys.map(k => row[k]));
        });
        return send(res, 200, { count: checked.length });
      }
      const scanSelect = `SELECT s.id,s.barcode,s.mode,s.created_at,u.name AS scanner,m.item_code,CASE WHEN s.image IS NULL THEN 0 ELSE 1 END has_image FROM scans s JOIN users u ON u.id=s.user_id LEFT JOIN materials m ON m.samsung=s.barcode OR m.item_code=s.barcode`;
      const scanCount=(barcode,mode)=>db.prepare('SELECT COUNT(*) n FROM scans WHERE barcode=? AND mode=?').get(barcode,mode).n;
      if (req.method === 'GET' && path === '/api/scans/check') {
        const barcode=norm(text(url.searchParams.get('barcode'),'Barcode',500)),mode=url.searchParams.get('mode');
        if (!['HS','Stock','Label'].includes(mode)) fail(400,'Loại quét không hợp lệ.');
        return send(res,200,{barcode,mode,count:scanCount(barcode,mode),scope:'server'});
      }
      if (req.method === 'GET' && path === '/api/scans') {
        const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
        const rows = db.prepare(`${scanSelect} WHERE s.id < ? ORDER BY s.id DESC LIMIT 100`).all(before);
        return send(res, 200, { scans: rows, next: rows.length === 100 ? rows.at(-1).id : null, total: db.prepare('SELECT COUNT(*) n FROM scans').get().n });
      }
      if (req.method === 'POST' && path === '/api/scans') {
        writeAccess(u); const b = await jsonBody(req), id = requestId(b.request_id);
        const previous = db.prepare('SELECT id,user_id,barcode,mode FROM scans WHERE request_id=?').get(id);
        if (previous) { if (previous.user_id !== u.id) fail(409, 'Mã yêu cầu đã tồn tại.'); return send(res, 200, { id: previous.id, duplicate: true,barcode_count:scanCount(previous.barcode,previous.mode) }); }
        const barcode = norm(text(b.barcode, 'Barcode', 500));
        if (!['HS','Stock','Label'].includes(b.mode)) fail(400, 'Loại quét không hợp lệ.');
        const image = imageData(b.image);
        const result=transaction(db,()=>{
          const before=scanCount(barcode,b.mode);
          if (b.reject_duplicate === true && before>0) return {blocked:true,count:before};
          const saved=db.prepare('INSERT INTO scans(request_id,barcode,mode,user_id,image_type,image) VALUES (?,?,?,?,?,?)').run(id,barcode,b.mode,u.id,image.mime,image.buffer);
          return {id:Number(saved.lastInsertRowid),barcode_count:before+1};
        });
        if (result.blocked) return send(res,409,{error:`Mã đã có ${result.count} lượt trên server. Chưa lưu thêm.`,code:'DUPLICATE_SCAN',count:result.count});
        return send(res,201,result);
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
      if (req.method === 'GET' && path === '/api/export') {
        const kind = url.searchParams.get('kind') || 'scans'; let rows;
        if (kind === 'scans') rows = [['ID','Barcode','Loại quét','Người quét','Thời gian UTC','ITEM'], ...db.prepare(`${scanSelect} ORDER BY s.id DESC`).all().map(r => [r.id,r.barcode,r.mode,r.scanner,r.created_at,r.item_code || 'Chưa có trong MM'])];
        else if (kind === 'boxes') rows = [['Phiếu/lô','Box','ITEM','Số lượng','Mục tiêu khi xác nhận','Người xác nhận','Thời gian UTC'], ...db.prepare('SELECT b.*,u.name FROM boxes b JOIN users u ON u.id=b.user_id ORDER BY b.id DESC').all().map(r => [r.delivery,r.box_ref,r.item_code,r.qty,r.target_qty,r.name,r.created_at])];
        else if (kind === 'holding') rows = [['ITEM','Location','Số lượng thay đổi','Ghi chú','Người thao tác','Thời gian UTC'], ...db.prepare('SELECT m.*,u.name FROM movements m JOIN users u ON u.id=m.user_id ORDER BY m.id DESC').all().map(r => [r.item_code,r.location,r.qty,r.note,r.name,r.created_at])];
        else fail(400, 'Loại báo cáo không hợp lệ.');
        const buffer = excel(rows);
        res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="work-area-${kind}.xlsx"` }); return res.end(buffer);
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
      if (req.method === 'POST' && path === '/api/holding') {
        writeAccess(u); const b = await jsonBody(req), id = requestId(b.request_id);
        const item = norm(text(b.item_code, 'ITEM')), location = norm(text(b.location, 'Location')), amount = positive(b.qty, 'Số lượng');
        if (!['in','out'].includes(b.direction)) fail(400, 'Cần chọn Nhập hoặc Xuất.');
        const note = typeof b.note === 'string' ? b.note.slice(0, 500) : '';
        const result = transaction(db, () => {
          const previous = db.prepare('SELECT id,user_id FROM movements WHERE request_id=?').get(id);
          if (previous) { if (previous.user_id !== u.id) fail(409, 'Mã yêu cầu đã tồn tại.'); return { id: previous.id, duplicate: true }; }
          if (!db.prepare('SELECT item_code FROM materials WHERE item_code=?').get(item)) fail(400, 'ITEM chưa có trong MM.');
          const current = db.prepare('SELECT COALESCE(SUM(qty),0) qty FROM movements WHERE item_code=? AND location=?').get(item, location).qty;
          const qty = b.direction === 'out' ? -amount : amount;
          if (current + qty < 0) fail(409, 'Số lượng xuất lớn hơn tồn kho tại Location này.');
          const saved = db.prepare('INSERT INTO movements(request_id,item_code,location,qty,note,user_id) VALUES (?,?,?,?,?,?)').run(id, item, location, qty, note, u.id);
          return { id: Number(saved.lastInsertRowid), balance: current + qty };
        });
        return send(res, result.duplicate ? 200 : 201, result);
      }
      fail(404, 'Không tìm thấy chức năng.');
    } catch (e) {
      const constraint = e.code?.includes('CONSTRAINT') || (e.errcode && (e.errcode & 255) === 19);
      const status = e.status || (constraint ? 409 : 500);
      if (status === 500) console.error('Request error:', e.code || e.name);
      const message = e.status ? e.message : status === 409 ? 'Dữ liệu trùng hoặc không hợp lệ. Kiểm tra mã ITEM, Samsung hoặc box.' : 'Không thể xử lý yêu cầu. Vui lòng thử lại.';
      if (!res.headersSent) send(res, status, { error: message }); else res.end();
    }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 15_000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createApp();
  const port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`Work Area: http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
