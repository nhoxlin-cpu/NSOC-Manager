import { readWorkbook } from './xlsx-read.mjs';
import { transaction } from './db.mjs';
export const normalize = v => String(v??'').trim().toUpperCase();
const tokens = v => normalize(v).split(/\s*[/;,\n]\s*/).filter(Boolean);
const quantity = v => {const n=Number(String(v??'').replace(/,/g,''));return Number.isSafeInteger(n)&&n>0&&n<=1e9?n:null;};
const intersect = (a,b) => tokens(a).some(t=>tokens(b).includes(t));
export function initCkd(db){db.exec(`
  CREATE TABLE IF NOT EXISTS ckd_workbooks(id INTEGER PRIMARY KEY,name TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS ckd_models(id INTEGER PRIMARY KEY,workbook_id INTEGER NOT NULL REFERENCES ckd_workbooks(id),samsung TEXT NOT NULL,items TEXT NOT NULL,item TEXT NOT NULL,description TEXT NOT NULL,maker TEXT NOT NULL,moq_text TEXT NOT NULL,moq INTEGER);
  CREATE INDEX IF NOT EXISTS ckd_models_lookup ON ckd_models(workbook_id,samsung);
  CREATE TABLE IF NOT EXISTS ckd_orders(id INTEGER PRIMARY KEY,workbook_id INTEGER NOT NULL REFERENCES ckd_workbooks(id),samsung TEXT NOT NULL,so_no TEXT NOT NULL,items TEXT NOT NULL,selling_code TEXT NOT NULL,selling_qty INTEGER NOT NULL,so_maker TEXT NOT NULL,maker TEXT NOT NULL,vendor TEXT NOT NULL,type TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS ckd_orders_lookup ON ckd_orders(workbook_id,samsung);
  CREATE TABLE IF NOT EXISTS ckd_checks(id INTEGER PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,workbook_id INTEGER NOT NULL REFERENCES ckd_workbooks(id),box_ref TEXT NOT NULL,samsung TEXT NOT NULL,item_code TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('PASS','NG')),qty INTEGER NOT NULL DEFAULT 0,counted INTEGER NOT NULL DEFAULT 0,snapshot TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(workbook_id,box_ref));
  CREATE INDEX IF NOT EXISTS ckd_checks_totals ON ckd_checks(workbook_id,samsung,counted);
`);}
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
  const match=eligible.find(o=>model&&intersect(model.maker,o.so_maker)&&(!o.maker||(intersect(model.maker,o.maker)&&intersect(o.maker,o.so_maker))));
  const errors=[];
  if(!models.length)errors.push('Mã Samsung không có trong CKD model list.');
  else if(!model)errors.push('ITEM vừa quét không khớp HS Code của mã Samsung trong model list.');
  if(!orders.length)errors.push('Mã Samsung không có trong SO đang chọn.');
  else if(!eligible.length)errors.push('ITEM không thuộc Selling Code cần bán của SO.');
  else if(model&&!match)errors.push('Vendor/Maker trong model list không khớp SO Maker hoặc Maker được bán.');
  const chosen=model||models[0]||null,order=match||eligible[0]||orders[0]||null;
  const qty=b.qty!==undefined&&String(b.qty).trim()!==''?quantity(b.qty):chosen?.moq||null;
  if(b.qty!==undefined&&String(b.qty).trim()!==''&&!qty)throw Error('Số lượng box phải là số nguyên dương, tối đa 1 tỷ.');
  const current=db.prepare('SELECT COUNT(*) boxes,COALESCE(SUM(qty),0) total FROM ckd_checks WHERE workbook_id=? AND samsung=? AND counted=1').get(workbook,code);
  const target=orders.reduce((sum,o)=>sum+o.selling_qty,0),after=current.total+(qty||0);
  const effective=errors.length?current.total:after;
  return {workbook_id:workbook,samsung:code,raw_samsung:raw,item_code:itemCode,pass:errors.length===0,status:errors.length?'NG':'PASS',quantity_status:!target?'Chưa có SO':effective>target?'Dư':effective===target?'Đủ':'Thiếu',reason:errors.join(' ')||'Samsung và ITEM khớp model list; Maker phù hợp SO.',model:chosen,order,orders,target,qty,needs_qty:!qty,...current,after,over:target>0&&after>target,remaining:Math.max(0,target-current.total)};
}
export function saveCkd(db,b,userId){
  if(typeof b.request_id!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(b.request_id))throw Error('Mã yêu cầu không hợp lệ.');
  const box=normalize(b.box_ref);if(!box||box.length>200)throw Error('Cần mã box duy nhất, tối đa 200 ký tự.');
  return transaction(db,()=>{
    const old=db.prepare('SELECT id,user_id,snapshot FROM ckd_checks WHERE request_id=?').get(b.request_id);
    if(old){if(old.user_id!==userId)throw Error('Mã yêu cầu đã tồn tại.');return {id:old.id,duplicate:true,check:JSON.parse(old.snapshot)};}
    const check=checkCkd(db,b);
    if(db.prepare('SELECT id FROM ckd_checks WHERE workbook_id=? AND box_ref=?').get(check.workbook_id,box))throw Error('Mã box đã được lưu trong file SO này.');
    if(!check.pass&&b.accept_ng!==true)throw Error('NG: cần chọn rõ Lưu NG để lưu lịch sử.');
    if(check.pass&&!check.qty)throw Error('MOQ chưa rõ. Nhập số lượng box thực tế.');
    if(check.pass&&check.over&&b.accept_over!==true)throw Error('Vượt Selling Qty. Cần xác nhận cảnh báo vượt trước khi lưu.');
    const saved=db.prepare('INSERT INTO ckd_checks(request_id,workbook_id,box_ref,samsung,item_code,status,qty,counted,snapshot,user_id) VALUES (?,?,?,?,?,?,?,?,?,?)').run(b.request_id,check.workbook_id,box,check.samsung,check.item_code,check.status,check.qty||0,check.pass?1:0,JSON.stringify(check),userId);
    return {id:Number(saved.lastInsertRowid),duplicate:false,check};
  });
}
