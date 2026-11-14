import {reportWorkbook} from './formats.mjs';
const sum=rows=>Number(rows.reduce((s,r)=>s+(r.quantity??0),0).toFixed(9));
export function scanReport(db,data,mode,user){
 const title=mode==='HS'?'BÁO CÁO QUÉT HS':mode==='Stock'?'BÁO CÁO KIỂM KÊ STOCK':mode==='Label'?'BÁO CÁO THU THẬP LABEL':'BÁO CÁO QUÉT MÃ';
 const scope=mode||'Tất cả loại quét',stock=data.filter(r=>r.mode==='Stock'),images=[],imageColumn=mode==='HS'?7:11;
 const maxId=data[0]?.id||0,bytes=db.prepare('SELECT COALESCE(SUM(LENGTH(image)),0) bytes FROM scans WHERE id<=? AND (? IS NULL OR mode=?)').get(maxId,mode,mode).bytes;
 if(bytes>96*1024*1024){const error=new Error('Ảnh báo cáo quá lớn. Chọn từng loại HS / Stock / Label để xuất.');error.status=413;throw error;}
 const photo=db.prepare('SELECT image_type,image FROM scans WHERE id=?');
 data.forEach((r,i)=>{if(r.has_image){const image=photo.get(r.id);if(image?.image)images.push({row:i+8,col:imageColumn,mime:image.image_type,data:image.image,alt:'Lượt quét #'+r.id});}});
 const overview=[['Chỉ tiêu','Giá trị'],['Loại báo cáo',scope],['Tổng lượt quét',data.length],['Số barcode khác nhau',new Set(data.map(r=>r.barcode)).size],['Số ITEM đã nhận diện',new Set(data.map(r=>r.item_code).filter(Boolean)).size],['Lượt có ảnh đối chiếu',images.length],['Lượt HS trùng',data.filter(r=>r.mode==='HS'&&r.prior_count>0).length],['Lượt HS không trùng',data.filter(r=>r.mode==='HS'&&!r.prior_count).length]];
 if(mode==='Stock'||stock.length)overview.push(['Total QTY Stock',stock.some(r=>r.quantity!=null)?sum(stock):'Chưa có QTY'],['Lượt Stock có QTY',stock.filter(r=>r.quantity!=null).length],['Lượt Stock chưa có QTY',stock.filter(r=>r.quantity==null).length],['Lượt Stock chưa có ITEM',stock.filter(r=>!r.item_code).length]);
 if(!mode)for(const type of ['HS','Stock','Label'])overview.push(['Lượt '+type,data.filter(r=>r.mode===type).length]);
 overview.push(['Ghi chú',mode==='HS'?'Mỗi dòng là một lượt quét đã lưu. Trạng thái trùng giữ theo thời điểm quét.':'Mỗi dòng là một lượt quét đã lưu. QTY trống là chưa xác định, không phải 0.']);
 const sheets=[{name:'Tổng quan',title,rows:overview}];
 if(mode==='Stock'){
   const groups=new Map();for(const r of stock){if(!r.item_code)continue;const item=r.item_code.trim().toUpperCase();let group=groups.get(item);if(!group){group={item_code:item,item_name:r.item_name||'',rows:[]};groups.set(item,group);}group.rows.push(r);}
   sheets.push({name:'Total theo ITEM',title:'TỔNG QTY STOCK THEO ITEM',rows:[['STT','ITEM code','Item NM','Số lượt quét','Lượt có QTY','Lượt chưa có QTY','Total QTY'],...[...groups.values()].sort((a,b)=>a.item_code.localeCompare(b.item_code)).map((r,i)=>[i+1,r.item_code,r.item_name,r.rows.length,r.rows.filter(r=>r.quantity!=null).length,r.rows.filter(r=>r.quantity==null).length,r.rows.some(r=>r.quantity!=null)?sum(r.rows):''])]});
 }
 const rows=mode==='HS'?[['STT','ITEM','Barcode','Kết quả','Người quét','Thời gian UTC','Item NM','Ảnh đối chiếu'],...data.map((r,i)=>[i+1,r.item_code||r.barcode,r.barcode,r.prior_count>0?'Trùng':'Không trùng',r.scanner,r.created_at,r.item_name||'',r.has_image?'Ảnh lượt #'+r.id:'Chưa có ảnh'])]:[['STT','Barcode','Loại quét','Người quét','Thời gian UTC','ITEM code','Item NM','Số lượng (QTY)','Maker','Vendor','Lot No','Ảnh đối chiếu'],...data.map((r,i)=>[i+1,r.barcode,r.mode,r.scanner,r.created_at,r.item_code||'Chưa có trong MM',r.item_name||'',r.quantity??'',r.maker||'',r.vendor||'',r.lot_no||'',r.has_image?'Ảnh lượt #'+r.id:'Chưa có ảnh'])];
 sheets.push({name:'Chi tiết',title:'CHI TIẾT LƯỢT QUÉT '+scope.toUpperCase(),images,rows});
 return reportWorkbook(sheets,{title,scope,exportedBy:user.name});
}
