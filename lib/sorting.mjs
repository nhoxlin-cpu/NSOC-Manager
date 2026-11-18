import {createHash} from 'node:crypto';
import {transaction} from './db.mjs';
import {reportWorkbook} from './formats.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const text=(v,label,max,optional=false)=>{if(v==null&&optional)return '';if(typeof v!=='string'||v.trim().length>max||(!optional&&!v.trim()))fail(label+' không hợp lệ.');return v.trim();};
function day(value,label,optional=false){const v=text(value,label,10,optional);if(!v&&optional)return '';const time=Date.parse(v+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||v<'1900-01-01'||!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==v)fail(label+' không hợp lệ.');return v;}
function count(v,label,min=0){if(!['number','string'].includes(typeof v)||String(v).trim()==='')fail(label+' cần là số nguyên.');const n=Number(v);if(!Number.isSafeInteger(n)||n<min||n>1000000000)fail(label+` cần là số nguyên từ ${min} đến 1.000.000.000.`);return n;}
export function initSorting(db){db.exec(`CREATE TABLE IF NOT EXISTS sorting_records(id INTEGER PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,payload_hash TEXT NOT NULL,vendor TEXT NOT NULL,sort_date TEXT NOT NULL,code TEXT NOT NULL,model TEXT NOT NULL,defect_name TEXT NOT NULL,total_sort INTEGER NOT NULL CHECK(total_sort>0),qty_ng INTEGER NOT NULL CHECK(qty_ng>=0 AND qty_ng<=total_sort),note TEXT NOT NULL DEFAULT '',marking TEXT NOT NULL DEFAULT '',user_id INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sorting_images(request_id TEXT PRIMARY KEY REFERENCES sorting_records(request_id),mime TEXT NOT NULL,bytes BLOB NOT NULL);
CREATE INDEX IF NOT EXISTS sorting_vendor_date ON sorting_records(vendor,sort_date,id);`);}
export function sortingInput(b){
 const vendor=text(b.vendor||'YUWON','Vendor',80).toUpperCase();if(vendor!=='YUWON')fail('Bản thử nghiệm hiện hỗ trợ vendor YUWON.');
 const total_sort=count(b.total_sort,'TOTAL SORT',1),qty_ng=count(b.qty_ng,'QTY NG');if(qty_ng>total_sort)fail('QTY NG không được lớn hơn TOTAL SORT.');
 return {vendor,sort_date:day(b.sort_date,'Ngày sort'),code:text(b.code,'Code',100).toUpperCase(),model:text(b.model,'Model',100).toUpperCase(),defect_name:text(b.defect_name,'Tên lỗi',300),total_sort,qty_ng,note:text(b.note,'Ghi chú',2000,true),marking:text(b.marking,'Marking',200,true)};
}
const calculated=r=>({...r,qty_ok:r.total_sort-r.qty_ng,rate_defect:r.qty_ng/r.total_sort});
function markingPhoto(source){
 if(source==null||source==='')return null;
 if(typeof source!=='string'||source.length>4200000)fail('Ảnh Marking tối đa 3 MB.');
 const m=/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);if(!m)fail('Ảnh Marking phải là JPEG hoặc PNG.');
 const bytes=Buffer.from(m[2],'base64'),valid=m[1]==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.subarray(0,3).equals(Buffer.from([255,216,255]));
 if(!valid||bytes.length>3*1024*1024||bytes.toString('base64')!==m[2])fail('Ảnh Marking không hợp lệ hoặc vượt 3 MB.');return {mime:m[1],bytes};
}
export function sortingImage(db,request){const photo=db.prepare('SELECT mime,bytes FROM sorting_images WHERE request_id=?').get(request);if(!photo)fail('Chưa có ảnh Marking.',404);return photo;}
export function saveSorting(db,b,userId){
 const photo=markingPhoto(b.image),value=sortingInput(b),request=text(b.request_id,'Mã yêu cầu',80);if(!/^[a-zA-Z0-9-]{16,80}$/.test(request))fail('Mã yêu cầu không hợp lệ.');const hash=createHash('sha256').update(JSON.stringify(value)+(photo?'|'+photo.mime+'|'+createHash('sha256').update(photo.bytes).digest('hex'):'')).digest('hex');
 return transaction(db,()=>{const old=db.prepare('SELECT * FROM sorting_records WHERE request_id=?').get(request);if(old){if(old.user_id!==userId||old.payload_hash!==hash)fail('Mã yêu cầu đã được dùng cho dữ liệu khác.',409);return {...calculated(old),has_image:!!db.prepare('SELECT 1 FROM sorting_images WHERE request_id=?').get(request),duplicate:true};}
 const keys=Object.keys(value),id=Number(db.prepare(`INSERT INTO sorting_records(request_id,payload_hash,${keys.join(',')},user_id) VALUES(?,?,${keys.map(()=>'?').join(',')},?)`).run(request,hash,...Object.values(value),userId).lastInsertRowid);
 if(photo)db.prepare('INSERT INTO sorting_images(request_id,mime,bytes) VALUES(?,?,?)').run(request,photo.mime,photo.bytes);return {...calculated(db.prepare('SELECT * FROM sorting_records WHERE id=?').get(id)),has_image:!!photo};});
}
function filter(q={}){const vendor=text(q.vendor||'YUWON','Vendor',80).toUpperCase();if(vendor!=='YUWON')fail('Bản thử nghiệm hiện hỗ trợ vendor YUWON.');const from=day(q.from||'','Từ ngày',true),to=day(q.to||'','Đến ngày',true),search=text(q.q||'','Từ khóa',200,true).toUpperCase();if(from&&to&&from>to)fail('Từ ngày không được sau Đến ngày.');return {vendor,from,to,q:search,where:"r.vendor=? AND (?='' OR r.sort_date>=?) AND (?='' OR r.sort_date<=?) AND (?='' OR instr(upper(r.code||' '||r.model||' '||r.defect_name||' '||r.note||' '||r.marking),?)>0)",args:[vendor,from,from,to,to,search,search]};}
const select='SELECT r.*,EXISTS(SELECT 1 FROM sorting_images i WHERE i.request_id=r.request_id) has_image,u.name AS entered_by FROM sorting_records r JOIN users u ON u.id=r.user_id WHERE ';
export function listSorting(db,q={}){const f=filter(q),offset=Math.min(1000000,Math.max(0,Math.floor(Number(q.offset)||0))),totals=db.prepare('SELECT count(*) records,coalesce(sum(total_sort),0) total_sort,coalesce(sum(qty_ng),0) qty_ng FROM sorting_records r WHERE '+f.where).get(...f.args),rows=db.prepare(select+f.where+' ORDER BY r.sort_date DESC,r.id DESC LIMIT 50 OFFSET ?').all(...f.args,offset).map(calculated);return {vendor:f.vendor,rows,totals:{...totals,qty_ok:totals.total_sort-totals.qty_ng,rate_defect:totals.total_sort?totals.qty_ng/totals.total_sort:0},next:offset+rows.length<totals.records?offset+rows.length:null};}
export function sortingReport(db,q={},user={}){
 const f=filter(q),summary=listSorting(db,q).totals;if(summary.records>50000)fail('Báo cáo quá 50.000 dòng. Lọc lại khoảng ngày trước khi xuất.');
 const rows=db.prepare(select+f.where+' ORDER BY r.sort_date,r.id').all(...f.args).map(calculated),scope=['Vendor YUWON',f.from?'Từ '+f.from:'',f.to?'Đến '+f.to:'',f.q?'Từ khóa: '+f.q:''].filter(Boolean).join(' · '),percent=n=>(100*n).toFixed(2)+'%';
 const images=[];let imageBytes=0;for(const [i,r]of rows.entries())if(r.has_image){const photo=sortingImage(db,r.request_id);imageBytes+=photo.bytes.length;if(imageBytes>96*1024*1024)fail('Ảnh báo cáo quá lớn. Lọc theo ngày hoặc code.',413);images.push({row:i+8,col:10,mime:photo.mime,data:photo.bytes,alt:'Marking '+r.code});}
 return reportWorkbook([{name:'Tổng quan',rows:[['STT','Chỉ tiêu','Giá trị'],[1,'Vendor','YUWON'],[2,'Số lượt sort',summary.records],[3,'TOTAL SORT',summary.total_sort],[4,'QTY NG',summary.qty_ng],[5,'QTY OK',summary.qty_ok],[6,'RATE DEFECT tổng',percent(summary.rate_defect)],[7,'Cách tính','QTY OK = TOTAL SORT − QTY NG; RATE DEFECT = tổng NG / tổng đã sort.'],[8,'Phạm vi',scope]]},{name:'YUWON NRT',images,title:'THEO DÕI KẾT QUẢ SORT HÀNG CỦA VENDOR · YUWON',columnWidths:[7,14,21,22,34,15,13,13,16,38,22],columnFormats:{1:'date',8:'percent'},rows:[['STT','DATE','CODE','MODEL','DEFECT NAME','TOTAL SORT','QTY NG','QTY OK','RATE DEFECT','NOTE','marking'],...rows.map((r,i)=>[i+1,r.sort_date,r.code,r.model,r.defect_name,r.total_sort,r.qty_ng,r.qty_ok,r.rate_defect,r.note,r.has_image?'Ảnh Marking':r.marking])]}],{title:'BÁO CÁO SORTING VENDOR · YUWON',scope,exportedBy:user.name||'Work Area'});
}
