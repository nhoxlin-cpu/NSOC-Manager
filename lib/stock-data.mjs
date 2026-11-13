import { scanQuantity } from './scan-quantity.mjs';

// Explicit fields only; do not guess positions in an unknown supplier format.
export function stockField(barcode,names){
  const fields=[...String(barcode).matchAll(/(?:^|[;|\n])\s*([A-Z_ ]+)\s*[:=]\s*([^;|\n]+)(?=$|[;|\n])/gi)]
    .filter(m=>names.includes(m[1].trim().replace(/\s+/g,'_').toUpperCase()));
  return fields.length===1?fields[0][2].trim().toUpperCase():null;
}
export function stockData(db,barcode){
  const inventory=db.prepare('SELECT * FROM mm_inventory WHERE barcode=?').get(barcode);
  if(inventory)return {item_code:inventory.item_code,item_name:inventory.item_name,maker:inventory.maker,vendor:inventory.vendor,quantity:inventory.qty,quantity_source:'MM',lot_no:inventory.lot_no||null};
  const lookup=code=>db.prepare('SELECT m.*,st.qty AS stock_qty,st.lot_no FROM materials m LEFT JOIN material_stock st ON st.item_code=m.item_code WHERE m.samsung=? OR m.item_code=? ORDER BY CASE WHEN m.samsung=? THEN 0 ELSE 1 END LIMIT 1').get(code,code,code);
  const m=lookup(barcode)||lookup(stockField(barcode,['ITEM','ITEM_CODE','SAMSUNG','BARCODE'])||barcode);
  const fromCode=scanQuantity(barcode,'Stock');
  return {item_code:m?.item_code??null,item_name:m?.item??null,maker:m?.maker??null,vendor:m?.vendor??null,quantity:fromCode??m?.stock_qty??null,quantity_source:fromCode!==null?'barcode':m?.stock_qty!=null?'MM':null,lot_no:stockField(barcode,['LOT','LOT_NO'])||m?.lot_no||null};
}
