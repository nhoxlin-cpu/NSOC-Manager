import {createHash} from 'node:crypto';
import {reportWorkbook} from './formats.mjs';
import {transaction} from './db.mjs';
export const errorFields=['date','line','code','stage','product_line','defect','quantity','cause','result','status','action','pic'];
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export function initErrorHistory(db){db.exec(`CREATE TABLE IF NOT EXISTS error_history(id INTEGER PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,payload_hash TEXT NOT NULL,payload TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),image_type TEXT,image BLOB,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE IF NOT EXISTS error_history_edits(request_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,payload TEXT NOT NULL,result TEXT NOT NULL);`);const cols=db.prepare('PRAGMA table_info(error_history)').all();if(!cols.some(c=>c.name==='revision'))db.exec('ALTER TABLE error_history ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');}
function validateErrorHistory(b){
 const value={};for(const key of errorFields){if(key==='quantity')continue;if(typeof b[key]!=='string'||b[key].trim().length>2000)fail('Thông tin không hợp lệ: '+key);value[key]=b[key].trim();}
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value.date)||!Number.isFinite(Date.parse(value.date+'T00:00:00Z'))||new Date(value.date+'T00:00:00Z').toISOString().slice(0,10)!==value.date)fail('Ngày không hợp lệ.');
 if(!['MI','AI','SMD','INPUT'].includes(value.stage)||!value.status||!value.defect||!value.code)fail('Kiểm tra Code, công đoạn, lỗi và trạng thái.');
 if(!['number','string'].includes(typeof b.quantity)||String(b.quantity).trim()===''||!Number.isSafeInteger(Number(b.quantity))||Number(b.quantity)<0||Number(b.quantity)>1000000000)fail('Số lượng lỗi phải là số nguyên từ 0 đến 1.000.000.000.');value.quantity=Number(b.quantity);
 return value;
}
export function saveErrorHistory(db,b,user){
 const value=validateErrorHistory(b);
 if(typeof b.request_id!=='string'||! /^[a-zA-Z0-9-]{16,80}$/.test(b.request_id))fail('Mã yêu cầu không hợp lệ.');
 let mime=null,bytes=null;if(b.image){const m=typeof b.image==='string'&&b.image.length<=4200000&&/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(b.image);if(!m)fail('Ảnh phải là PNG/JPEG, tối đa 3 MB.');mime=m[1];bytes=Buffer.from(m[2],'base64');if(bytes.length>3*1024*1024||bytes.toString('base64')!==m[2]||!(mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.subarray(0,3).equals(Buffer.from([255,216,255]))))fail('Ảnh không hợp lệ.');}
 const payload=JSON.stringify(value),hash=createHash('sha256').update(payload).update(bytes||'').digest('hex');const old=db.prepare('SELECT id,user_id,payload_hash FROM error_history WHERE request_id=?').get(b.request_id);if(old){if(old.user_id!==user||old.payload_hash!==hash)fail('Mã yêu cầu đã được sử dụng.',409);return {id:old.id,duplicate:true};}
 return {id:Number(db.prepare('INSERT INTO error_history(request_id,payload_hash,payload,user_id,image_type,image) VALUES(?,?,?,?,?,?)').run(b.request_id,hash,payload,user,mime,bytes).lastInsertRowid)};
}
export function listErrorHistory(db,offset=0){if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)fail('Trang không hợp lệ.');const total=db.prepare('SELECT count(*) n FROM error_history').get().n;return {total,rows:db.prepare('SELECT e.id,e.payload,e.revision,e.created_at,u.name entered_by,e.image IS NOT NULL has_image FROM error_history e JOIN users u ON u.id=e.user_id ORDER BY e.id DESC LIMIT 100 OFFSET ?').all(offset).map(({payload,...r})=>({...r,...JSON.parse(payload)})),next:offset+100<total?offset+100:null};}

export function editErrorHistory(db,b,user){
 const id=Number(b.id),revision=Number(b.revision),request=b.request_id,value=validateErrorHistory(b);
 if(!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(revision)||revision<0||typeof request!=='string'||! /^[a-zA-Z0-9-]{16,80}$/.test(request))fail('Yêu cầu sửa không hợp lệ.');
 const payload=JSON.stringify({id,revision,value});return transaction(db,()=>{const old=db.prepare('SELECT * FROM error_history_edits WHERE request_id=?').get(request);if(old){if(old.user_id!==user||old.payload!==payload)fail('Mã yêu cầu đã được sử dụng.',409);return JSON.parse(old.result);}const current=db.prepare('SELECT revision FROM error_history WHERE id=?').get(id);if(!current)fail('Không tìm thấy lịch sử lỗi.',404);if(current.revision!==revision)fail('Bản ghi đã thay đổi. Vui lòng tải lại.',409);db.prepare('UPDATE error_history SET payload=?,revision=revision+1 WHERE id=? AND revision=?').run(JSON.stringify(value),id,revision);const result={id,revision:revision+1};db.prepare('INSERT INTO error_history_edits VALUES (?,?,?,?)').run(request,user,payload,JSON.stringify(result));return result;});
}
export function errorHistoryReport(db,user={}){
 const count=db.prepare('SELECT count(*) n FROM error_history').get().n;if(count>50000)fail('Báo cáo quá 50.000 dòng.',413);
 const rows=db.prepare('SELECT e.id,e.payload,e.created_at,e.image_type,e.image,u.name entered_by FROM error_history e JOIN users u ON u.id=e.user_id ORDER BY e.id').all(), images=[];let imageBytes=0;
 const labels=['Ngày','Line sản xuất','Code','Công đoạn','Nhóm sản phẩm','Lỗi','Số lượng lỗi','Nguyên nhân','Kết quả','Trạng thái','Hành động','PIC'];
 const data=rows.map((row,i)=>{const v=JSON.parse(row.payload);if(row.image){imageBytes+=row.image.length;if(imageBytes>96*1024*1024)fail('Ảnh báo cáo quá lớn.',413);images.push({row:i+8,col:15,mime:row.image_type,data:row.image,alt:'Ảnh lỗi '+v.code});}return [i+1,...errorFields.map(k=>v[k]),row.entered_by,row.created_at,row.image?'Ảnh lỗi':''];});
 return reportWorkbook([{name:'Tổng quan',rows:[['STT','Chỉ tiêu','Giá trị'],[1,'Số bản ghi',count],[2,'Tổng số lượng lỗi',data.reduce((sum,r)=>sum+Number(r[7]||0),0)],[3,'Phạm vi','Toàn bộ lịch sử lỗi']]},{name:'Lịch sử lỗi',images,title:'LỊCH SỬ LỖI',columnFormats:{1:'date'},columnWidths:[7,14,18,22,16,20,26,16,32,32,22,32,18,22,22,22],rows:[['STT',...labels,'Người nhập','Thời gian nhập','Hình ảnh'],...data]}],{title:'BÁO CÁO LỊCH SỬ LỖI',scope:'Toàn bộ lịch sử lỗi',exportedBy:user.name||'Work Area'});
}
