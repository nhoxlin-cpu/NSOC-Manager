import { readWorkbook } from './xlsx-read.mjs';
import { transaction } from './db.mjs';
export const normalize = v => String(v??'').trim().toUpperCase();
const tokens = v => normalize(v).split(/\s*[/;,\n]\s*/).filter(Boolean);
const quantity = v => {const n=Number(String(v??'').replace(/,/g,''));return Number.isSafeInteger(n)&&n>0&&n<=1e9?n:null;};
export function makerMatches(a,b){
  const words=v=>normalize(v).normalize('NFKD').replace(/\p{M}/gu,'').replace(/[^\p{L}\p{N}]+/gu,' ').split(/\s+/).filter(w=>w.length>=2&&!['CO','LTD','LIMITED','INC','CORP','CORPORATION','COMPANY','THE'].includes(w));
  const parts=v=>String(v??'').split(/[/;,]/).map(x=>words(x).join('')).filter(x=>x.length>=2);
  return parts(a).some(x=>parts(b).some(y=>x.includes(y)||y.includes(x)))||words(a).some(x=>words(b).includes(x)&&x.length>=3);
}
export function initCkd(db){db.exec(`
  CREATE TABLE IF NOT EXISTS ckd_workbooks(id INTEGER PRIMARY KEY,name TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS ckd_models(id INTEGER PRIMARY KEY,workbook_id INTEGER NOT NULL REFERENCES ckd_workbooks(id),samsung TEXT NOT NULL,items TEXT NOT NULL,item TEXT NOT NULL,description TEXT NOT NULL,maker TEXT NOT NULL,moq_text TEXT NOT NULL,moq INTEGER);
  CREATE INDEX IF NOT EXISTS ckd_models_lookup ON ckd_models(workbook_id,samsung);
  CREATE TABLE IF NOT EXISTS ckd_orders(id INTEGER PRIMARY KEY,workbook_id INTEGER NOT NULL REFERENCES ckd_workbooks(id),samsung TEXT NOT NULL,so_no TEXT NOT NULL,items TEXT NOT NULL,selling_code TEXT NOT NULL,selling_qty INTEGER NOT NULL,so_maker TEXT NOT NULL,maker TEXT NOT NULL,vendor TEXT NOT NULL,type TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS ckd_orders_lookup ON ckd_orders(workbook_id,samsung);
  CREATE TABLE IF NOT EXISTS ckd_checks(id INTEGER PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,workbook_id INTEGER NOT NULL REFERENCES ckd_workbooks(id),box_ref TEXT NOT NULL,samsung TEXT NOT NULL,item_code TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('PASS','NG')),qty INTEGER NOT NULL DEFAULT 0,counted INTEGER NOT NULL DEFAULT 0,snapshot TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(workbook_id,box_ref));
  CREATE INDEX IF NOT EXISTS ckd_checks_totals ON ckd_checks(workbook_id,samsung,counted);
  CREATE TABLE IF NOT EXISTS ckd_check_images(check_id INTEGER NOT NULL REFERENCES ckd_checks(id) ON DELETE CASCADE,slot TEXT NOT NULL CHECK(slot IN ('samsung','item')),mime TEXT NOT NULL,image BLOB NOT NULL,PRIMARY KEY(check_id,slot));
  CREATE TABLE IF NOT EXISTS ckd_deleted_requests(request_id TEXT PRIMARY KEY,check_id INTEGER NOT NULL,workbook_id INTEGER NOT NULL REFERENCES ckd_workbooks(id),user_id INTEGER NOT NULL REFERENCES users(id),deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE INDEX IF NOT EXISTS ckd_deleted_ids ON ckd_deleted_requests(check_id);
`);if(!db.prepare('PRAGMA table_info(ckd_check_images)').all().some(c=>c.name==='thumbnail'))db.exec('ALTER TABLE ckd_check_images ADD COLUMN thumbnail BLOB');}
export function parseCkdWorkbook(buffer){
  const sheets=readWorkbook(buffer);if(sheets.length<2)throw Error('Cần Sheet1 (SO) và Sheet2 (CKD model list).');
  const soHeader=sheets[0].rows.findIndex(r=>normalize(r.B)==='BN CODE'&&normalize(r.H)==='SELLING CODE');
  const modelHeader=sheets[1].rows.findIndex(r=>normalize(r.A)==='MATERIAL CODE'&&normalize(r.B)==='HS CODE');
  if(soHeader<0||modelHeader<0)throw Error('Không tìm thấy cột SO hoặc CKD model list đúng mẫu.');
  const models=sheets[1].rows.slice(modelHeader+1).filter(r=>r.A&&r.B).map(r=>({samsung:normalize(r.A),items:normalize(r.B),item:r.D||'',description:r.E||'',maker:r.F||'',moq_text:r.G||'',moq:quantity(r.G)}));
  const orders=sheets[0].rows.slice(soHeader+1).filter(r=>r.B&&r.H&&quantity(r.I)).map(r=>({samsung:normalize(r.B),so_no:r.C||'',items:normalize(r.D),selling_code:normalize(r.H),selling_qty:quantity(r.I),so_maker:r.G||'',maker:r.Q||'',vendor:r.P||'',type:r.R||''}));
  if(!models.length||!orders.length)throw Error('File chưa có model hoặc dòng SO có Selling Qty hợp lệ.');
  if(models.length>20000||orders.length>20000)throw Error('File quá nhiều dòng.');
  return {models,orders,model_sheet:sheets[1].name,so_sheet:sheets[0].name,missing_moq:models.filter(m=>!m.moq).length};
}
export function importCkdWorkbook(db,parsed,name,userId){return transaction(db,()=>{
  const id=Number(db.prepare('INSERT INTO ckd_workbooks(name,user_id) VALUES (?,?)').run(name,userId).lastInsertRowid);
  const model=db.prepare('INSERT INTO ckd_models(workbook_id,samsung,items,item,description,maker,moq_text,moq) VALUES (?,?,?,?,?,?,?,?)');
  for(const m of parsed.models)model.run(id,m.samsung,m.items,m.item,m.description,m.maker,m.moq_text,m.moq);
  const order=db.prepare('INSERT INTO ckd_orders(workbook_id,samsung,so_no,items,selling_code,selling_qty,so_maker,maker,vendor,type) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for(const r of parsed.orders)order.run(id,r.samsung,r.so_no,r.items,r.selling_code,r.selling_qty,r.so_maker,r.maker,r.vendor,r.type);
  return {id,name,models:parsed.models.length,orders:parsed.orders.length,missing_moq:parsed.missing_moq};
});}
export function checkCkd(db,b){
  const workbook=Number(b.workbook_id);if(!Number.isSafeInteger(workbook)||!db.prepare('SELECT id FROM ckd_workbooks WHERE id=?').get(workbook))throw Error('Chọn file SO / CKD trước khi quét.');
  const raw=normalize(b.samsung),itemCode=normalize(b.item_code);if(!raw||!itemCode||raw.length>500||itemCode.length>500)throw Error('Cần quét đủ mã Samsung và ITEM code, tối đa 500 ký tự.');
  // Samsung labels may append lot/quantity after the complete material code.
  const all=db.prepare('SELECT DISTINCT samsung FROM ckd_models WHERE workbook_id=?').all(workbook);
  const code=all.map(r=>r.samsung).sort((a,b)=>b.length-a.length).find(c=>raw===c||(raw.startsWith(c)&&/^(?:BN|AH|\d)/.test(raw.slice(c.length))))||raw;
  const models=db.prepare('SELECT * FROM ckd_models WHERE workbook_id=? AND samsung=?').all(workbook,code);
  const model=models.find(m=>tokens(m.items).includes(itemCode));
  const orders=db.prepare('SELECT * FROM ckd_orders WHERE workbook_id=? AND samsung=?').all(workbook,code);
  const eligible=orders.filter(o=>tokens(o.selling_code).includes(itemCode));
  const inventory=db.prepare('SELECT DISTINCT maker,vendor FROM mm_inventory WHERE item_code=? ORDER BY maker,vendor').all(itemCode);
  const legacy=db.prepare('SELECT item_code,maker,vendor FROM materials WHERE item_code=? COLLATE NOCASE').get(itemCode);
  const mm=inventory.length?inventory:legacy?[legacy]:[];
  const candidates=[...new Set(mm.map(m=>m.maker?.trim()).filter(Boolean))];
  const sellingMaker=candidates.find(m=>eligible.some(o=>makerMatches(m,o.so_maker)))||candidates.join(' / ');
  const match=eligible.find(o=>makerMatches(sellingMaker,o.so_maker));
  const errors=[];
  if(!models.length)errors.push('Mã Samsung không có trong CKD model list.');
  else if(!model)errors.push('ITEM vừa quét không khớp HS Code của mã Samsung trong model list.');
  if(!orders.length)errors.push('Mã Samsung không có trong SO đang chọn.');
  else if(!eligible.length)errors.push('ITEM không thuộc Selling Code cần bán của SO.');
  if(!mm.length)errors.push('ITEM chưa có trong MM.');
  else if(!sellingMaker)errors.push('ITEM trong MM chưa có Maker.');
  else if(eligible.length&&!match)errors.push('Maker bán từ MM không khớp SO Maker.');
  const chosen=model||models[0]||null,order=match||eligible[0]||orders[0]||null;
  const sellingVendor=mm.find(m=>m.maker?.trim()===sellingMaker)?.vendor||order?.vendor||'';
  const qty=b.qty!==undefined&&String(b.qty).trim()!==''?quantity(b.qty):chosen?.moq||null;
  if(b.qty!==undefined&&String(b.qty).trim()!==''&&!qty)throw Error('Số lượng box phải là số nguyên dương, tối đa 1 tỷ.');
  const current=db.prepare('SELECT COUNT(*) boxes,COALESCE(SUM(qty),0) total FROM ckd_checks WHERE workbook_id=? AND samsung=? AND counted=1').get(workbook,code);
  const target=orders.reduce((sum,o)=>sum+o.selling_qty,0),after=current.total+(qty||0);
  const effective=errors.length?current.total:after;
  return {workbook_id:workbook,session_name:String(b.session_name||'').trim().slice(0,80),samsung:code,raw_samsung:raw,item_code:itemCode,selling_maker:sellingMaker,selling_vendor:sellingVendor,maker_source:'MM',maker_match:Boolean(match),pass:errors.length===0,status:errors.length?'NG':'PASS',quantity_status:!target?'Chưa có SO':effective>target?'Dư':effective===target?'Đủ':'Thiếu',reason:errors.join(' ')||'Hai mã khớp; Maker MM phù hợp SO.',model:chosen,order,orders,target,qty,needs_qty:!qty,...current,after,over:target>0&&after>target,remaining:Math.max(0,target-current.total)};
}
export function ckdOverview(db,workbook){
  const where=workbook?'workbook_id=?':'1=1',args=workbook?[workbook]:[];
  const checks=db.prepare(`SELECT c.id,c.workbook_id,w.name workbook_name,c.box_ref,c.samsung,c.item_code,c.status,c.qty,c.counted,c.snapshot,c.created_at,u.name scanner,EXISTS(SELECT 1 FROM ckd_check_images i WHERE i.check_id=c.id AND i.slot='samsung') samsung_image,EXISTS(SELECT 1 FROM ckd_check_images i WHERE i.check_id=c.id AND i.slot='item') item_image FROM ckd_checks c JOIN users u ON u.id=c.user_id JOIN ckd_workbooks w ON w.id=c.workbook_id WHERE ${workbook?'c.workbook_id=?':'1=1'} ORDER BY c.id DESC`).all(...args).map(r=>({...r,check:JSON.parse(r.snapshot),snapshot:undefined}));
  const orders=db.prepare(`SELECT o.*,w.name workbook_name FROM ckd_orders o JOIN ckd_workbooks w ON w.id=o.workbook_id WHERE ${workbook?'o.workbook_id=?':'1=1'}`).all(...args);
  const grouped=new Map();
  for(const o of orders){const key=o.workbook_id+'|'+o.samsung;let g=grouped.get(key);if(!g){g={workbook_id:o.workbook_id,workbook_name:o.workbook_name,samsung:o.samsung,target:0,scans:0,boxes:0,ng:0,total:0,items:new Set(),makers:new Set()};grouped.set(key,g);}g.target+=o.selling_qty;for(const item of tokens(o.selling_code))g.items.add(item);if(o.so_maker)g.makers.add(o.so_maker);}
  for(const c of checks){const key=c.workbook_id+'|'+c.samsung;let g=grouped.get(key);if(!g){g={workbook_id:c.workbook_id,workbook_name:c.workbook_name,samsung:c.samsung,target:0,scans:0,boxes:0,ng:0,total:0,items:new Set(),makers:new Set()};grouped.set(key,g);}g.scans++;if(c.counted){g.boxes++;g.total+=c.qty;}else g.ng++;}
  const rows=[...grouped.values()].map(g=>({...g,items:[...g.items],so_makers:[...g.makers],makers:undefined,remaining:Math.max(0,g.target-g.total),quantity_status:!g.target?'Ngoài SO':g.total>g.target?'Dư':g.total===g.target?'Đủ':'Thiếu'}));
  return {checks,summary:rows.filter(g=>g.scans>0),unsold:rows.filter(g=>g.scans===0)};
}
export function saveCkd(db,b,userId,images=[]){
  if(typeof b.request_id!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(b.request_id))throw Error('Mã yêu cầu không hợp lệ.');
  const box=b.box_ref?normalize(b.box_ref):'BOX-'+b.request_id;if(box.length>200)throw Error('Mã lượt lưu quá dài.');
  return transaction(db,()=>{
    if(db.prepare('SELECT 1 FROM ckd_deleted_requests WHERE request_id=?').get(b.request_id))throw Error('Lượt quét này đã bị xóa. Hãy quét lại để tạo lượt mới.');
    const old=db.prepare('SELECT id,user_id,snapshot FROM ckd_checks WHERE request_id=?').get(b.request_id);
    if(old){if(old.user_id!==userId)throw Error('Mã yêu cầu đã tồn tại.');return {id:old.id,duplicate:true,check:JSON.parse(old.snapshot)};}
    const check=checkCkd(db,b);
    if(db.prepare('SELECT id FROM ckd_checks WHERE workbook_id=? AND box_ref=?').get(check.workbook_id,box))throw Error('Mã box đã được lưu trong file SO này.');
    if(!check.pass&&b.accept_ng!==true)throw Error('NG: cần chọn rõ Lưu NG để lưu lịch sử.');
    if(check.pass&&!check.qty)throw Error('MOQ chưa rõ. Nhập số lượng box thực tế.');
    if(check.pass&&check.over&&b.accept_over!==true)throw Error('Vượt Selling Qty. Cần xác nhận cảnh báo vượt trước khi lưu.');
    const nextId=db.prepare('SELECT COALESCE(MAX(n),0)+1 id FROM (SELECT MAX(id) n FROM ckd_checks UNION ALL SELECT MAX(check_id) n FROM ckd_deleted_requests)').get().id;
    const saved=db.prepare('INSERT INTO ckd_checks(id,request_id,workbook_id,box_ref,samsung,item_code,status,qty,counted,snapshot,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(nextId,b.request_id,check.workbook_id,box,check.samsung,check.item_code,check.status,check.qty||0,check.pass?1:0,JSON.stringify(check),userId);
    for(const image of images)db.prepare('INSERT INTO ckd_check_images(check_id,slot,mime,image,thumbnail) VALUES (?,?,?,?,?)').run(saved.lastInsertRowid,image.slot,image.mime,image.buffer,image.thumbnail||null);
    return {id:Number(saved.lastInsertRowid),duplicate:false,check};
  });
}
export function deleteCkdHistory(db,b,userId){return transaction(db,()=>{
  const invalid=(message,status=400)=>{const error=new Error(message);error.status=status;throw error;};
  const workbook=Number(b.workbook_id);
  if(!['string','number'].includes(typeof b.workbook_id)||!Number.isSafeInteger(workbook)||workbook<1||!db.prepare('SELECT 1 FROM ckd_workbooks WHERE id=?').get(workbook))invalid('Chọn SO cần xóa lịch sử.');
  let where='workbook_id=?',params=[workbook];
  if(b.all===true){if(!Number.isSafeInteger(b.through_id)||b.through_id<1)invalid('Thiếu mốc lịch sử cần xóa.');where+=' AND id<=?';params.push(b.through_id);}
  else{if(!Array.isArray(b.ids)||!b.ids.length||b.ids.length>1000||b.ids.some(id=>!Number.isSafeInteger(id)||id<1))invalid('Chọn từ 1 đến 1.000 lượt CKD.');const ids=[...new Set(b.ids)];where+=' AND id IN ('+ids.map(()=>'?').join(',')+')';params.push(...ids);if(db.prepare('SELECT COUNT(*) n FROM ckd_checks WHERE '+where).get(...params).n!==ids.length)invalid('Lịch sử đã thay đổi hoặc có lượt thuộc SO khác. Tải lại rồi chọn lại.',409);}
  const rows=db.prepare('SELECT id,request_id FROM ckd_checks WHERE '+where).all(...params),record=db.prepare('INSERT OR IGNORE INTO ckd_deleted_requests(request_id,check_id,workbook_id,user_id) VALUES (?,?,?,?)');
  for(const row of rows)record.run(row.request_id,row.id,workbook,userId);
  const result=db.prepare('DELETE FROM ckd_checks WHERE '+where).run(...params);return {ok:true,deleted:result.changes,workbook_id:workbook};
});}
