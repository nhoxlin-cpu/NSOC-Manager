// Shared business rules for the device workspace and authoritative replay.
import {checkCkd,saveCkd,ckdOverview,deleteCkdHistory} from './ckd.mjs';
import {deleteHolding,holdingReference,holdingLookup,holdingPreferences,receiveHolding,withdrawHolding,editHolding,editHoldingGroup,holdingInventory,holdingEvents,holdingReport} from './holding.mjs';
import {createHash} from 'node:crypto';
import {cuttingStatus,lookupCutting,saveCuttingScan} from './cutting-data.mjs';
import {listMM,lookupAndSaveMM} from './mm-data.mjs';
import {hsCode} from '../public/hs-code.js';
import {stockData} from './stock-data.mjs';
import {scanQuantity} from './scan-quantity.mjs';
import {scanReport} from './scan-report.mjs';
import {ckdReport} from './ckd-report.mjs';
import {reportWorkbook} from './formats.mjs';
export const queuePaths=new Set(['/scans','/scans/delete','/ckd/pair/save','/ckd/history/delete','/cutting/scans','/holding/v2/receive','/holding/v2/withdraw','/holding/v2/edit','/holding/v2/edit-group','/holding/v2/delete','/holding/v2/preferences','/preferences','/materials/lookup']);
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const text=(value,label,max=500)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail(label+' không hợp lệ.');return value.trim();};
const requestId=value=>{if(typeof value!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(value))fail('Mã giao dịch không hợp lệ.');return value;};
export function offlineImage(source){
 if(!source)return {mime:null,buffer:null};const m=typeof source==='string'&&/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(source);if(!m)fail('Ảnh không hợp lệ.');const buffer=Buffer.from(m[2],'base64'),mime=m[1];
 const valid=mime==='image/jpeg'?buffer.subarray(0,3).equals(Buffer.from([255,216,255])):mime==='image/png'?buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP';if(!valid||buffer.length>3*1024*1024)fail('Ảnh sai định dạng hoặc vượt 3 MB.');return {mime,buffer};
}
export const scanSelect=`SELECT s.id,s.barcode,s.raw_barcode,s.mode,s.quantity,s.prior_count,s.created_at,u.name scanner,COALESCE(ss.item_code,m.item_code) item_code,COALESCE(ss.item_name,m.item) item_name,COALESCE(ss.maker,m.maker) maker,COALESCE(ss.vendor,m.vendor) vendor,ss.lot_no,ss.quantity_source,s.image IS NOT NULL has_image FROM scans s JOIN users u ON u.id=s.user_id LEFT JOIN scan_stock ss ON ss.scan_id=s.id LEFT JOIN materials m ON m.item_code=COALESCE((SELECT item_code FROM materials WHERE samsung=s.barcode),s.barcode)`;
const binary=(bytes,mime,name)=>({binary:true,bytes,mime,name});
export function businessApi(db,user,path,{method='GET',data:b={}}={},historical=false){
 const url=new URL(path,'https://workarea.invalid'),p=url.pathname,q=Object.fromEntries(url.searchParams),write=()=>{if(!['admin','inspector'].includes(user.role))fail('Tài khoản chỉ được xem.',403);},admin=()=>{if(user.role!=='admin')fail('Chỉ quản trị viên được thực hiện.',403);};
 if(method==='POST'&&!queuePaths.has(p)&&p!=='/ckd/pair/check')fail('Thao tác này cần kết nối máy chủ.',503);
 if(p==='/health')return {ok:true,app:'work-area',offline:true};
 if(p==='/me')return {user,csrf:'device-workspace',needsSetup:false};
 if(p==='/users'&&method==='GET'){admin();return {users:[user]};}
 if(p==='/preferences'){
  if(method==='POST'){const old=db.prepare('SELECT * FROM user_preferences WHERE user_id=?').get(user.id),navigation=b.navigation??(old?JSON.parse(old.navigation):['home','scan','assistant','account']),continuous=b.continuous_scan??(old?Boolean(old.continuous_scan):true);if(!Array.isArray(navigation)||navigation.length<3||navigation.length>5||new Set(navigation).size!==navigation.length||navigation.some(v=>!['home','scan','ckd','cut','holding','mm','assistant','account'].includes(v))||typeof continuous!=='boolean')fail('Phím tắt không hợp lệ.');db.prepare('INSERT INTO user_preferences(user_id,navigation,continuous_scan) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET navigation=excluded.navigation,continuous_scan=excluded.continuous_scan').run(user.id,JSON.stringify(navigation),continuous?1:0);}
  const r=db.prepare('SELECT * FROM user_preferences WHERE user_id=?').get(user.id);return {navigation:r?JSON.parse(r.navigation):['home','scan','assistant','account'],continuous_scan:r?!!r.continuous_scan:true,updated_at:r?.updated_at||null};
 }
 if(p==='/stats')return {scans:db.prepare('SELECT COUNT(*) n FROM scans').get().n,materials:db.prepare('SELECT COUNT(*) n FROM (SELECT item_code FROM materials UNION SELECT item_code FROM mm_inventory)').get().n,boxes:db.prepare('SELECT COUNT(*) n FROM boxes').get().n,holding:db.prepare('SELECT COALESCE(SUM(remaining_qty),0) n FROM holding_entries').get().n};
 if(p==='/materials'||p==='/materials/lookup'){
  const v=method==='POST'?b:q,field=v.field||'all',query=typeof v.q==='string'?v.q.slice(0,200):'',offset=Number(v.offset||0);if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)fail('Trang không hợp lệ.');
  if(method==='POST'&&historical&&b._offline_saved){const saved=b._offline_saved;if(!['spec','location','item_code'].includes(field)||!query.trim()||!saved||!Array.isArray(saved.materials)||saved.materials.length>1000||JSON.stringify(saved).length>2*1024*1024||saved.materials.some(r=>!r||typeof r.item_code!=='string'))fail('Bản tra cứu offline không hợp lệ.');const id=db.prepare('INSERT INTO mm_lookup_saved(user_id,field,query,snapshot) VALUES (?,?,?,?)').run(user.id,field,query,JSON.stringify(saved)).lastInsertRowid;return {...saved,saved_id:Number(id)};}
  return method==='POST'?lookupAndSaveMM(db,{q:query,field,offset,saved_id:v.saved_id},user.id):listMM(db,{q:query,field,offset});
 }
 if(p==='/materials/saved'){
  if(q.id){const r=db.prepare('SELECT * FROM mm_lookup_saved WHERE id=? AND user_id=?').get(Number(q.id),user.id);if(!r)fail('Không tìm thấy tra cứu đã lưu.',404);return {...JSON.parse(r.snapshot),saved_at:r.updated_at,query:r.query};}
  return {saved:db.prepare('SELECT id,field,query,updated_at FROM mm_lookup_saved WHERE user_id=? AND field=? AND instr(lower(query),lower(?))>0 ORDER BY updated_at DESC,id DESC LIMIT 100').all(user.id,q.field||'spec',q.q||'')};
 }
 if(p==='/scans/check')return {count:db.prepare('SELECT COUNT(*) n FROM scans WHERE barcode=? AND mode=?').get(q.mode==='HS'?hsCode(q.barcode):q.barcode,q.mode).n,scope:'device',offline:true};
 if(p==='/scans'&&method==='POST'){
  write();const id=requestId(b.request_id);if(!['HS','Stock','Label'].includes(b.mode))fail('Loại scan không hợp lệ.');const old=db.prepare('SELECT * FROM scans WHERE request_id=?').get(id);if(old){if(old.user_id!==user.id)fail('Mã giao dịch thuộc tài khoản khác.',409);return {id:old.id,duplicate:true,is_duplicate:old.prior_count>0,prior_count:old.prior_count,barcode_count:old.prior_count+1};}
  const raw=text(b.mode==='HS'?(b.raw_barcode??b.barcode):b.barcode,'Barcode').toUpperCase(),barcode=b.mode==='HS'?hsCode(raw):raw,image=offlineImage(b.image),prior=db.prepare('SELECT COUNT(*) n FROM scans WHERE barcode=? AND mode=?').get(barcode,b.mode).n;if(b.mode!=='HS'&&b.reject_duplicate&&prior)throw Object.assign(Error('Barcode đã tồn tại.'),{status:409,code:'DUPLICATE_SCAN',count:prior});const stock=b.mode==='Stock'?stockData(db,barcode):null;
  const result=db.prepare('INSERT INTO scans(request_id,barcode,mode,user_id,image_type,image,quantity,prior_count,raw_barcode) VALUES (?,?,?,?,?,?,?,?,?)').run(id,barcode,b.mode,user.id,image.mime,image.buffer,stock?.quantity??scanQuantity(barcode,b.mode),prior,b.mode==='HS'?raw:null),scanId=Number(result.lastInsertRowid);
  if(stock)db.prepare('INSERT INTO scan_stock(scan_id,item_code,item_name,maker,vendor,lot_no,quantity_source) VALUES (?,?,?,?,?,?,?)').run(scanId,stock.item_code,stock.item_name,stock.maker,stock.vendor,stock.lot_no,stock.quantity_source);return {id:scanId,prior_count:prior,is_duplicate:prior>0,barcode_count:prior+1,stock};
 }
 if(p==='/scans'&&method==='GET'){
  const mode=q.mode||null,rows=db.prepare(scanSelect+' WHERE s.id<? AND (? IS NULL OR s.mode=?) ORDER BY s.id DESC LIMIT 100').all(Number(q.before)||Number.MAX_SAFE_INTEGER,mode,mode),totals=db.prepare('SELECT COUNT(*) total,SUM(quantity) total_quantity,COUNT(quantity) quantity_count,COALESCE(MAX(id),0) max_id FROM scans WHERE (? IS NULL OR mode=?)').get(mode,mode);
  return {scans:rows,next:rows.length===100?rows.at(-1).id:null,mode,...totals,...(mode==='Stock'?{stock_summary:db.prepare(`SELECT upper(trim(item_code)) item_code,MAX(item_name) item_name,COUNT(*) scans,COUNT(quantity) quantity_count,SUM(quantity) total_quantity FROM (${scanSelect} WHERE s.mode='Stock') WHERE trim(COALESCE(item_code,''))<>'' GROUP BY upper(trim(item_code))`).all()}:{} )};
 }
 if(p==='/scans/delete'){admin();if(!['HS','Stock','Label'].includes(b.mode)||!Array.isArray(b.ids)||!b.ids.length||b.ids.length>1000||b.ids.some(id=>!Number.isSafeInteger(id)||id<1))fail('Chọn tối đa 1.000 lượt scan.');const ids=[...new Set(b.ids)];if(historical){if(!Array.isArray(b.expected)||b.expected.length!==ids.length)fail('Thiếu mã giao dịch gốc.');for(const id of ids){const row=db.prepare('SELECT request_id FROM scans WHERE id=?').get(id);if(row&&row.request_id!==b.expected.find(v=>v.id===id)?.request_id)fail('Lịch sử đã thay đổi. Không xóa bản ghi mới.',409);}}const result=db.prepare('DELETE FROM scans WHERE mode=? AND id IN ('+ids.map(()=>'?').join(',')+')').run(b.mode,...ids);return {ok:true,deleted:result.changes};}
 const scanImage=/^\/scans\/(\d+)\/image$/.exec(p);if(scanImage){const r=db.prepare('SELECT image_type mime,image bytes FROM scans WHERE id=?').get(Number(scanImage[1]));if(!r?.bytes)fail('Chưa có ảnh.',404);return binary(r.bytes,r.mime);}
 if(p==='/ckd/workbooks')return {workbooks:db.prepare('SELECT w.*,(SELECT COUNT(*) FROM ckd_models WHERE workbook_id=w.id) models,(SELECT COUNT(*) FROM ckd_orders WHERE workbook_id=w.id) orders FROM ckd_workbooks w ORDER BY id DESC').all()};
 if(p==='/ckd/pair/check')return checkCkd(db,b);
 if(p==='/ckd/pair/save'){write();const images=[];if(b.images&&(typeof b.images!=='object'||Array.isArray(b.images)||Object.keys(b.images).some(k=>!['samsung','item'].includes(k))))fail('Ảnh CKD không hợp lệ.');for(const slot of ['samsung','item'])if(b.images?.[slot]){const v=b.images[slot],image=offlineImage(typeof v==='string'?v:v.source);let thumbnail;if(v.thumbnail){const t=offlineImage(v.thumbnail);if(t.mime!=='image/jpeg'||t.buffer.length>65536)fail('Ảnh xem trước không hợp lệ.');thumbnail=t.buffer;}images.push({slot,...image,...(thumbnail?{thumbnail}:{})});}return saveCkd(db,b,user.id,images);}
 if(p==='/ckd/history/delete'){admin();if(historical){if(!Array.isArray(b.ids)||!Array.isArray(b.expected)||b.ids.length!==b.expected.length)fail('Thiếu mã giao dịch CKD gốc.');for(const id of b.ids){const row=db.prepare('SELECT request_id FROM ckd_checks WHERE id=?').get(id);if(row&&row.request_id!==b.expected.find(v=>v.id===id)?.request_id)fail('Lịch sử CKD đã thay đổi.',409);}b={...b,all:false,ids:b.ids.filter(id=>db.prepare('SELECT id FROM ckd_checks WHERE id=?').get(id))};if(!b.ids.length)return {ok:true,deleted:0};}return deleteCkdHistory(db,b,user.id);}
 if(p==='/ckd/history'){
  const r=ckdOverview(db,q.scope==='all'?0:Number(q.workbook_id)),rows=r.checks.filter(c=>!q.before||c.id<Number(q.before)),checks=rows.slice(0,200);return {...r,checks,next:rows.length>200?checks.at(-1).id:null,count:r.checks.length,max_id:r.checks[0]?.id||0,totals:r.summary.filter(g=>g.boxes>0)};
 }
 const ckdImage=/^\/ckd\/checks\/(\d+)\/image\/(samsung|item)$/.exec(p);if(ckdImage){const r=db.prepare('SELECT mime,image bytes FROM ckd_check_images WHERE check_id=? AND slot=?').get(Number(ckdImage[1]),ckdImage[2]);if(!r)fail('Chưa có ảnh.',404);return binary(r.bytes,r.mime);}
 if(p.startsWith('/holding/v2/')){
  const a=p.slice('/holding/v2/'.length);if(method==='POST')write();
  if(a==='delete-preview'){admin();const rows=db.prepare('SELECT id,revision expected_revision FROM holding_entries WHERE remaining_qty>0 ORDER BY id LIMIT 10001').all();if(rows.length>10000)fail('Có hơn 10.000 box; hãy xóa theo từng nhóm.');return {rows};}
  if(a==='delete'){admin();return deleteHolding(db,b,user.id);}
  if(a==='item-mm'){const code=text(q.code,'ITEM',200).toUpperCase();let rows=db.prepare('SELECT barcode,item_code,item_name,vendor,lot_no FROM mm_inventory WHERE barcode=? ORDER BY barcode LIMIT 201').all(code);if(!rows.length)rows=db.prepare('SELECT barcode,item_code,item_name,vendor,lot_no FROM mm_inventory WHERE item_code=? ORDER BY barcode LIMIT 201').all(code);if(rows.length>200)fail('ITEM có hơn 200 dòng MM. Quét đúng barcode của lô.');if(!rows.length)rows=db.prepare("SELECT m.samsung barcode,m.item_code,m.item item_name,m.vendor,COALESCE(st.lot_no,'') lot_no FROM materials m LEFT JOIN material_stock st ON st.item_code=m.item_code WHERE m.item_code=? OR m.samsung=?").all(code,code);return {rows};}
  if(a==='reference')return holdingReference(db);if(a==='lookup')return holdingLookup(db,q.barcode);if(a==='preferences')return holdingPreferences(db,user.id,method==='POST'?b:undefined);if(a==='inventory')return holdingInventory(db,q);if(a==='events'){const events=holdingEvents(db,q);return {events,next:events.length===100?events.at(-1).id:null};}
  if(a==='receive')return receiveHolding(db,b,user.id,offlineImage(b.image));if(a==='withdraw')return withdrawHolding(db,b,user.id);if(a==='edit')return editHolding(db,b,user.id);if(a==='edit-group')return editHoldingGroup(db,b,user.id);
  const image=/^entries\/(\d+)\/image$/.exec(a);if(image){const r=db.prepare('SELECT image_type mime,image bytes FROM holding_entries WHERE id=?').get(Number(image[1]));if(!r?.bytes)fail('Chưa có ảnh.',404);return binary(r.bytes,r.mime);}
  if(a==='export')return binary(holdingReport(db,q,{...user,name:user.name+' · OFFLINE / TẠM TÍNH'}),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Holding-Offline.xlsx');
 }
 if(p==='/cutting/status')return cuttingStatus(db);
 if(p==='/cutting/lookup')return lookupCutting(db,{code:q.code,model:q.model,direction:q.direction||'auto'});
 if(p==='/cutting/scans'&&method==='POST'){write();return saveCuttingScan(db,{...b,user_id:user.id,request_id:requestId(b.request_id),image:offlineImage(b.image)});}
 if(p==='/cutting/scans'){
  const rows=db.prepare('SELECT s.id,s.code,s.snapshot,s.created_at,u.name scanner,s.image IS NOT NULL has_image FROM cutting_scans s JOIN users u ON u.id=s.user_id WHERE s.id<? ORDER BY s.id DESC LIMIT 50').all(Number(q.before)||Number.MAX_SAFE_INTEGER);return {scans:rows.map(({snapshot,...r})=>{const v=JSON.parse(snapshot);return {...r,count:v.count,targets:[...new Set(v.matches.map(m=>m.target_code))],model:v.model,direction:v.direction};}),next:rows.length===50?rows.at(-1).id:null,total:db.prepare('SELECT COUNT(*) n FROM cutting_scans').get().n};
 }
 const cutImage=/^\/cutting\/scans\/(\d+)\/image$/.exec(p);if(cutImage){const r=db.prepare('SELECT image_type mime,image bytes FROM cutting_scans WHERE id=?').get(Number(cutImage[1]));if(!r?.bytes)fail('Chưa có ảnh.',404);return binary(r.bytes,r.mime);}
 const cutDetail=/^\/cutting\/scans\/(\d+)$/.exec(p);if(cutDetail){const r=db.prepare('SELECT s.*,u.name scanner,s.image IS NOT NULL has_image FROM cutting_scans s JOIN users u ON u.id=s.user_id WHERE s.id=?').get(Number(cutDetail[1]));if(!r)fail('Không tìm thấy lượt quét.',404);return {...JSON.parse(r.snapshot),id:r.id,scanner:r.scanner,created_at:r.created_at,has_image:r.has_image};}
 if(p==='/export/scans'){const mode=q.mode||null,rows=db.prepare(scanSelect+' WHERE (? IS NULL OR s.mode=?) ORDER BY s.id DESC').all(mode,mode);return binary(scanReport(db,rows,mode,{...user,name:user.name+' · OFFLINE / TẠM TÍNH'}),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Scan-Offline.xlsx');}
 if(p==='/ckd/export'||p==='/ckd/report.zip'){const report=ckdReport(db,q.scope==='all'?0:Number(q.workbook_id),{exportedBy:user.name+' · OFFLINE / TẠM TÍNH',imageLinks:p.endsWith('.zip')});return p.endsWith('.zip')?{binary:true,zip:report.entries,mime:'application/zip',name:'CKD-Offline.zip'}:binary(report.workbookBytes,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','CKD-Offline.xlsx');}
 if(p==='/cutting/export'){const rows=db.prepare('SELECT s.*,u.name scanner FROM cutting_scans s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC').all();return binary(reportWorkbook([{name:'Lịch sử',rows:[['STT','Mã quét','Model','Kết quả','Người scan','Giờ scan'],...rows.map((r,i)=>{const s=JSON.parse(r.snapshot);return [i+1,r.code,s.model,s.matches.map(m=>m.target_code).join(' / '),r.scanner,r.created_at];})]}],{title:'BÁO CÁO CẮT CHÂN · OFFLINE / TẠM TÍNH',exportedBy:user.name}),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Cutting-Offline.xlsx');}
 fail('Tính năng quản trị / nhập file này cần máy chủ online.',503);
}
export function stampOfflineTime(db,path,body,result,iso,userId){
 const at=iso.replace('T',' ').replace('Z',''),tables={'/scans':'scans','/ckd/pair/save':'ckd_checks','/cutting/scans':'cutting_scans'};
 if(tables[path])db.prepare('UPDATE '+tables[path]+' SET created_at=? WHERE request_id=? AND user_id=?').run(at,body.request_id,userId);
 if(path.startsWith('/holding/v2/')&&body.request_id){db.prepare('UPDATE holding_events SET created_at=? WHERE request_id=? AND user_id=?').run(at,body.request_id,userId);if(path.endsWith('/receive'))db.prepare('UPDATE holding_entries SET created_at=? WHERE id=? AND user_id=?').run(at,result.id,userId);}
 if(path==='/holding/v2/edit-group')db.prepare("UPDATE holding_events SET created_at=? WHERE user_id=? AND json_extract(response,'$.group_request_id')=?").run(at,userId,body.request_id);
 if(path==='/holding/v2/delete')for(const row of body.rows||[])db.prepare('UPDATE holding_events SET created_at=? WHERE user_id=? AND request_id=?').run(at,userId,createHash('sha256').update(body.request_id+':delete:'+row.id).digest('hex'));
 if(path==='/materials/lookup'&&result.saved_id)db.prepare('UPDATE mm_lookup_saved SET updated_at=? WHERE id=? AND user_id=?').run(at,result.saved_id,userId);
}
