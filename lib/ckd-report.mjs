import { excelWorkbook } from './formats.mjs';
import { ckdOverview } from './ckd.mjs';
const imageName=i=>`images/SO-${i.workbook_id}/check-${i.check_id}-${i.slot}.${i.mime==='image/png'?'png':i.mime==='image/webp'?'webp':'jpg'}`;
export function ckdReport(db,workbook){
  const overview=ckdOverview(db,workbook),maxId=overview.checks[0]?.id||0;
  const filter=`c.id<=?${workbook?' AND c.workbook_id=?':''}`,args=workbook?[maxId,workbook]:[maxId];
  const imageMeta=db.prepare(`SELECT i.check_id,i.slot,i.mime,c.workbook_id,LENGTH(i.image) bytes FROM ckd_check_images i JOIN ckd_checks c ON c.id=i.check_id WHERE ${filter} ORDER BY i.check_id,i.slot`).all(...args);
  const paths=new Map(imageMeta.map(i=>[i.check_id+'|'+i.slot,imageName(i)]));
  const workbookBytes=excelWorkbook([
    {name:'Luot scan',rows:[['ID','Đơn hàng','Phiên quét','Box','Samsung','ITEM','Kết quả','Nhãn số lượng','MOQ','Cộng SO','Description','Maker bán (MM)','SO Maker','Maker khớp','Selling Qty','Tổng sau box','Ảnh Samsung','Ảnh ITEM','Người quét','Thời gian UTC'],...overview.checks.map(c=>[c.id,c.workbook_name,c.check.session_name||'',c.box_ref,c.samsung,c.item_code,c.status,c.check.quantity_status||'',c.qty,c.counted?'Có':'Không',c.check.model?.description||'',c.check.selling_maker||'',c.check.order?.so_maker||'',c.check.maker_match===undefined?'Chưa ghi':c.check.maker_match?'Khớp':'Sai',c.check.target,c.counted?c.check.after:c.check.total,paths.get(c.id+'|samsung')||'',paths.get(c.id+'|item')||'',c.scanner,c.created_at])]},
    {name:'Theo Samsung',rows:[['Đơn hàng','Samsung','ITEM bán','Lượt scan','Box PASS','NG','Selling Qty','Đã bán','Còn thiếu','Trạng thái'],...overview.summary.map(g=>[g.workbook_name,g.samsung,g.items.join(' / '),g.scans,g.boxes,g.ng,g.target,g.total,g.remaining,g.quantity_status])]},
    {name:'SO chua scan',rows:[['Đơn hàng','Samsung','ITEM bán','SO Maker','Selling Qty'],...overview.unsold.map(g=>[g.workbook_name,g.samsung,g.items.join(' / '),g.so_makers.join(' / '),g.target])]}
  ]);
  if(imageMeta.length+1>65535||imageMeta.reduce((sum,i)=>sum+i.bytes,workbookBytes.length)+imageMeta.length*200+1000>0xffffffff)throw Error('Báo cáo quá lớn. Chọn từng đơn hàng để tải.');
  function* entries(){yield {name:'report.xlsx',data:workbookBytes};for(const image of db.prepare(`SELECT i.check_id,i.slot,i.mime,i.image,c.workbook_id FROM ckd_check_images i JOIN ckd_checks c ON c.id=i.check_id WHERE ${filter} ORDER BY i.check_id,i.slot`).iterate(...args))yield {name:imageName(image),data:image.image};}
  return {workbookBytes,entries,images:imageMeta.length};
}
