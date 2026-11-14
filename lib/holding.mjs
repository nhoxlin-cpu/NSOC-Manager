import {transaction} from './db.mjs';
import {reportWorkbook} from './formats.mjs';

const error=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const str=(v,label,required=true,max=200)=>{if(typeof v!=='string'||v.trim().length>max||(required&&!v.trim()))error(`${label}: cần nhập tối đa ${max} ký tự.`);return v.trim();};
const code=v=>str(v,'Mã').toUpperCase();
const qty=v=>{if(!['number','string'].includes(typeof v)||!String(v).trim()||!Number.isFinite(Number(v))||Number(v)<=0||Number(v)>1e9||Number(v)!==Number(Number(v).toFixed(6)))error('QTY phải lớn hơn 0, tối đa 1 tỷ và tối đa 6 chữ số thập phân.');return Number(v);};
const rid=v=>{if(typeof v!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(v))error('Mã yêu cầu không hợp lệ.');return v;};
const activeRefs=`SELECT r.*,b.kind,b.name file_name FROM holding_refs r JOIN holding_ref_batches b ON b.id=r.batch_id WHERE b.id IN (SELECT MAX(id) FROM holding_ref_batches GROUP BY kind)`;
export function initHolding(db){db.exec(`
 CREATE TABLE IF NOT EXISTS holding_ref_batches(id INTEGER PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('PBA32','PMD32')),name TEXT NOT NULL,rows INTEGER NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS holding_refs(batch_id INTEGER NOT NULL REFERENCES holding_ref_batches(id),barcode TEXT NOT NULL,item_code TEXT NOT NULL,item_name TEXT NOT NULL,qty REAL NOT NULL,vendor TEXT NOT NULL,lot_no TEXT NOT NULL,PRIMARY KEY(batch_id,barcode));
 CREATE INDEX IF NOT EXISTS holding_refs_barcode ON holding_refs(barcode);
 CREATE TABLE IF NOT EXISTS holding_preferences(user_id INTEGER PRIMARY KEY REFERENCES users(id),location TEXT NOT NULL DEFAULT '',auto_save INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS holding_entries(id INTEGER PRIMARY KEY,barcode TEXT NOT NULL,item_code TEXT NOT NULL,item_name TEXT NOT NULL,location TEXT NOT NULL,initial_qty REAL NOT NULL CHECK(initial_qty>0),remaining_qty REAL NOT NULL CHECK(remaining_qty>=0),vendor TEXT NOT NULL,lot_no TEXT NOT NULL,source TEXT NOT NULL,batch_id INTEGER REFERENCES holding_ref_batches(id),user_id INTEGER NOT NULL REFERENCES users(id),image_type TEXT,image BLOB,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE UNIQUE INDEX IF NOT EXISTS holding_active_barcode ON holding_entries(barcode) WHERE remaining_qty>0;
 CREATE INDEX IF NOT EXISTS holding_item ON holding_entries(item_code,location);
 CREATE TABLE IF NOT EXISTS holding_events(id INTEGER PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,entry_id INTEGER NOT NULL REFERENCES holding_entries(id),user_id INTEGER NOT NULL REFERENCES users(id),direction TEXT NOT NULL,qty REAL NOT NULL,balance REAL NOT NULL,reason TEXT NOT NULL,response TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 `);}
export function holdingReference(db){return {batches:db.prepare('SELECT * FROM holding_ref_batches WHERE id IN (SELECT MAX(id) FROM holding_ref_batches GROUP BY kind) ORDER BY kind').all(),barcodes:db.prepare(`SELECT DISTINCT barcode FROM (${activeRefs})`).all().map(r=>r.barcode)};}
export function importHolding(db,parsed,name,kind,userId){
 if(!['PBA32','PMD32'].includes(kind))error('Chọn PBA32 hoặc PMD32.');
 if(!parsed.rows.length||parsed.rows.some(r=>r.storage_location?.trim().toUpperCase()!==kind))error('S/L trong file không khớp loại kho đã chọn.');
 return transaction(db,()=>{const id=Number(db.prepare('INSERT INTO holding_ref_batches(kind,name,rows,user_id) VALUES (?,?,?,?)').run(kind,name,parsed.rows.length,userId).lastInsertRowid);
 const insert=db.prepare('INSERT INTO holding_refs VALUES (?,?,?,?,?,?,?)');for(const r of parsed.rows)insert.run(id,r.barcode,r.item_code,r.item_name,r.qty,r.vendor||'',r.lot_no||'');return {id,kind,rows:parsed.rows.length};});
}
export function holdingLookup(db,barcode){barcode=code(barcode);return {barcode,matches:db.prepare(`SELECT * FROM (${activeRefs}) WHERE barcode=? ORDER BY kind`).all(barcode),existing:db.prepare('SELECT id,location,remaining_qty FROM holding_entries WHERE barcode=? AND remaining_qty>0').get(barcode)||null};}
export function holdingPreferences(db,userId,body){
 if(body){const previous=holdingPreferences(db,userId);const location=Object.hasOwn(body,'location')?str(body.location,'Location',false):previous.location;
 const auto=Object.hasOwn(body,'auto_save')?body.auto_save:previous.auto_save;if(typeof auto!=='boolean')error('Chế độ tự lưu không hợp lệ.');db.prepare('INSERT INTO holding_preferences VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET location=excluded.location,auto_save=excluded.auto_save').run(userId,location,Number(auto));}
 const r=db.prepare('SELECT location,auto_save FROM holding_preferences WHERE user_id=?').get(userId);return {location:r?.location||'',auto_save:r?Boolean(r.auto_save):true};
}
const prior=(db,id,userId,direction)=>{const row=db.prepare('SELECT * FROM holding_events WHERE request_id=?').get(id);if(!row)return null;if(row.user_id!==userId||row.direction!==direction)error('Mã yêu cầu đã được dùng cho thao tác khác.',409);return JSON.parse(row.response);};
export function receiveHolding(db,b,userId,image={mime:null,buffer:null}){return transaction(db,()=>{
 const request=rid(b.request_id),previous=prior(db,request,userId,'in');if(previous)return {...previous,duplicate:true};
 const barcode=code(b.barcode),item=code(b.item_code),location=str(b.location,'Location').toUpperCase(),quantity=qty(b.qty),vendor=str(b.vendor,'Vendor'),lot=str(b.lot_no??'','Lot No',false),name=str(b.item_name??'','Tên hàng',false);
 if(db.prepare('SELECT id FROM holding_entries WHERE barcode=? AND remaining_qty>0').get(barcode))error('Barcode đang có trong tủ Holding. Chưa nhập thêm.',409);
 let source='Nhập tay',batch=null;
 if(b.batch_id!=null){if(!Number.isSafeInteger(b.batch_id))error('Nguồn file không hợp lệ.');const ref=db.prepare(`SELECT * FROM (${activeRefs}) WHERE batch_id=? AND barcode=?`).get(b.batch_id,barcode);if(!ref)error('Bảng tra đã thay đổi. Quét lại mã.',409);source=ref.kind;batch=ref.batch_id;}
 const id=Number(db.prepare('INSERT INTO holding_entries(barcode,item_code,item_name,location,initial_qty,remaining_qty,vendor,lot_no,source,batch_id,user_id,image_type,image) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(barcode,item,name,location,quantity,quantity,vendor,lot,source,batch,userId,image.mime,image.buffer).lastInsertRowid);
 const response={id,barcode,balance:quantity};db.prepare("INSERT INTO holding_events(request_id,entry_id,user_id,direction,qty,balance,reason,response) VALUES (?,?,?,'in',?,?,?,?)").run(request,id,userId,quantity,quantity,'Nhập Holding',JSON.stringify(response));
 db.prepare('INSERT INTO holding_preferences(user_id,location) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET location=excluded.location').run(userId,location);return response;
 });}
export function withdrawHolding(db,b,userId){return transaction(db,()=>{
 const request=rid(b.request_id),previous=prior(db,request,userId,'out');if(previous)return {...previous,duplicate:true};
 if(!Number.isSafeInteger(b.entry_id))error('Box không hợp lệ.');const row=db.prepare('SELECT * FROM holding_entries WHERE id=?').get(b.entry_id);if(!row)error('Không tìm thấy box.',404);
 const amount=qty(b.qty),reason=str(b.reason,'Lý do xuất',true,500);if(amount>row.remaining_qty)error('QTY xuất vượt tồn hiện tại. Tải lại để kiểm tra.',409);
 const balance=Number((row.remaining_qty-amount).toFixed(6));db.prepare('UPDATE holding_entries SET remaining_qty=? WHERE id=?').run(balance,row.id);const response={id:row.id,barcode:row.barcode,balance};
 db.prepare("INSERT INTO holding_events(request_id,entry_id,user_id,direction,qty,balance,reason,response) VALUES (?,?,?,'out',?,?,?,?)").run(request,row.id,userId,amount,balance,reason,JSON.stringify(response));return response;
 });}
function filter(query={}){const q=typeof query.q==='string'?query.q.trim().slice(0,200):'',source=query.source||'',item=query.item?code(query.item):'';if(source&&!['PBA32','PMD32','Nhập tay'].includes(source))error('Nguồn không hợp lệ.');return {sql:`(?='' OR instr(lower(e.barcode||' '||e.item_code||' '||e.item_name||' '||e.location||' '||e.vendor),lower(?))>0) AND (?='' OR e.source=?) AND (?='' OR e.item_code=?)`,params:[q,q,source,source,item,item],q,source};}
export function holdingInventory(db,query={},all=false){
 const f=filter(query),offset=Number(query.offset||0);if(!Number.isSafeInteger(offset)||offset<0)error('Trang không hợp lệ.');
 const base=`FROM holding_entries e WHERE e.remaining_qty>0 AND ${f.sql}`;
 const totals=db.prepare(`SELECT COUNT(*) boxes,COUNT(DISTINCT e.item_code) items,COALESCE(SUM(e.remaining_qty),0) qty ${base}`).get(...f.params);
 const entries=db.prepare(`SELECT e.id,e.barcode,e.item_code,e.item_name,e.location,e.initial_qty,e.remaining_qty,e.vendor,e.lot_no,e.source,e.created_at,u.name scanner,CASE WHEN e.image IS NULL THEN 0 ELSE 1 END has_image FROM holding_entries e JOIN users u ON u.id=e.user_id WHERE e.remaining_qty>0 AND ${f.sql} ORDER BY e.id DESC ${all?'':'LIMIT 100 OFFSET ?'}`).all(...f.params,...(all?[]:[offset]));
 const items=db.prepare(`SELECT e.item_code,MAX(e.item_name) item_name,SUM(e.remaining_qty) qty,COUNT(*) boxes,GROUP_CONCAT(DISTINCT e.location) locations ${base} GROUP BY e.item_code ORDER BY e.item_code`).all(...f.params);
 const sources=db.prepare(`SELECT e.source,COUNT(*) boxes,SUM(e.remaining_qty) qty ${base} GROUP BY e.source`).all(...f.params);
 return {entries,items,sources,totals,next:!all&&offset+entries.length<totals.boxes?offset+entries.length:null,offset};
}
export function holdingEvents(db,query={},all=false){const f=filter(query),before=Number(query.before||Number.MAX_SAFE_INTEGER);if(!Number.isSafeInteger(before)||before<1)error('Mốc nhật ký không hợp lệ.');return db.prepare(`SELECT h.id,h.entry_id,h.direction,h.qty,h.balance,h.reason,h.created_at,u.name scanner,e.barcode,e.item_code,e.location,e.source FROM holding_events h JOIN holding_entries e ON e.id=h.entry_id JOIN users u ON u.id=h.user_id WHERE h.id<? AND ${f.sql} ORDER BY h.id DESC ${all?'':'LIMIT 100'}`).all(before,...f.params);}
export function holdingReport(db,query,user){
 const data=holdingInventory(db,query,true),events=holdingEvents(db,query,true),images=[];
 const photo=db.prepare('SELECT image_type,image,LENGTH(image) bytes FROM holding_entries WHERE id=?');let imageBytes=0;
 data.entries.forEach((r,i)=>{if(!r.has_image)return;const image=photo.get(r.id);if(!image?.image)return;imageBytes+=image.bytes;if(imageBytes>96*1024*1024)error('Ảnh báo cáo quá lớn. Lọc theo Location hoặc nguồn để giảm dữ liệu.',413);images.push({row:i+8,col:12,data:image.image,mime:image.image_type,alt:'Nhập Holding #'+r.id});});
 const sheets=[
 {name:'Tổng quan',title:'TỔNG QUAN TỦ HOLDING',rows:[['Chỉ tiêu','Giá trị'],['Tổng ITEM',data.totals.items],['Tổng box còn hàng',data.totals.boxes],['Tổng QTY còn lại',data.totals.qty],...data.sources.flatMap(r=>[[r.source+' · Box',r.boxes],[r.source+' · QTY',r.qty]])]},
 {name:'Theo ITEM',title:'TỒN HOLDING THEO ITEM',rows:[['STT','ITEM code','Tên hàng','Total QTY','Count box','Location'],...data.items.map((r,i)=>[i+1,r.item_code,r.item_name,r.qty,r.boxes,r.locations])]},
 {name:'Theo Barcode',title:'TỒN HOLDING THEO BARCODE',images,rows:[['STT','Barcode-no','ITEM code','Tên hàng','Location','QTY nhập','QTY còn lại','Vendor','Lot No','Nguồn','Người nhập','Thời gian UTC','Ảnh đối chiếu'],...data.entries.map((r,i)=>[i+1,r.barcode,r.item_code,r.item_name,r.location,r.initial_qty,r.remaining_qty,r.vendor,r.lot_no,r.source,r.scanner,r.created_at,r.has_image?'Ảnh box #'+r.id:'Chưa có ảnh'])]},
 {name:'Nhật ký',title:'NHẬT KÝ NHẬP XUẤT HOLDING',rows:[['STT','Barcode-no','ITEM code','Nhập / Xuất','QTY thay đổi','QTY còn sau giao dịch','Location','Nguồn','Người thao tác','Thời gian','Lý do'],...events.map((r,i)=>[i+1,r.barcode,r.item_code,r.direction==='in'?'Nhập':'Xuất',r.direction==='in'?r.qty:-r.qty,r.balance,r.location,r.source,r.scanner,r.created_at,r.reason])]}];
 return reportWorkbook(sheets,{title:'BÁO CÁO TỦ HOLDING',scope:[query.q?'Tìm: '+query.q:'Toàn bộ',query.source||'Tất cả nguồn'].join(' · '),exportedBy:user.name});
}
