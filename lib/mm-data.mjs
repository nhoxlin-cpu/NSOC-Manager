import { transaction } from './db.mjs';

export function importMMRows(db,parsed,name){
  return transaction(db,()=>{
    const id=Number(db.prepare('INSERT INTO mm_imports(name,sheets,row_count) VALUES (?,?,?)').run(name,JSON.stringify(parsed.sheets),parsed.rows.length).lastInsertRowid);
    const keys=['barcode','item_code','item_name','spec','location','qty','lot_no','maker','vendor_code','vendor','storage_location','receipt_date','customer_label','label_status','source_sheet','source_row'];
    const save=db.prepare(`INSERT INTO mm_inventory(${keys.join(',')},import_id) VALUES (${keys.map(()=>'?').join(',')},?) ON CONFLICT(barcode) DO UPDATE SET ${keys.filter(k=>k!=='barcode').map(k=>`${k}=excluded.${k}`).join(',')},import_id=excluded.import_id`);
    let updated=0;const exists=db.prepare('SELECT 1 FROM mm_inventory WHERE barcode=?');
    for(const row of parsed.rows){if(exists.get(row.barcode))updated++;save.run(...keys.map(k=>row[k]??''),id);}
    return {count:parsed.rows.length,inserted:parsed.rows.length-updated,updated,sheets:parsed.sheets,import_id:id};
  });
}

export function listMM(db,{q='',field='all',offset=0}){
  const source=`(
    SELECT i.item_code,i.barcode AS samsung,i.item_name AS item,i.spec AS description,i.maker,i.vendor,i.location,m.selling_qty,m.moq,i.qty,i.lot_no,i.storage_location,i.receipt_date,i.vendor_code,i.customer_label,i.label_status,i.source_sheet,i.source_row
    FROM mm_inventory i LEFT JOIN materials m ON m.item_code=i.item_code
    UNION ALL
    SELECT m.item_code,m.samsung,m.item,m.description,m.maker,m.vendor,m.location,m.selling_qty,m.moq,st.qty,st.lot_no,'','','','','','',NULL
    FROM materials m LEFT JOIN material_stock st ON st.item_code=m.item_code WHERE NOT EXISTS(SELECT 1 FROM mm_inventory i WHERE i.item_code=m.item_code)
  )`;
  const fields={all:'item_code || samsung || item || description || maker || location || vendor',location:'location',item_code:'item_code',spec:'description'};
  if(!Object.hasOwn(fields,field))throw Error('Chọn Location, Item code hoặc Spec.');
  const where=`instr(lower(${fields[field]}),lower(?))>0`,order=field==='location'?'location,item_code,samsung':field==='spec'?'description,item_code,samsung':'item_code,samsung';
  if(field==='spec'){
    const grouped=`(SELECT item_code,MIN(samsung) samsung,MIN(item) item,MIN(description) description,GROUP_CONCAT(DISTINCT maker) maker,GROUP_CONCAT(DISTINCT vendor) vendor,GROUP_CONCAT(DISTINCT NULLIF(location,'')) location,MAX(selling_qty) selling_qty,MAX(moq) moq,SUM(qty) qty,GROUP_CONCAT(DISTINCT NULLIF(lot_no,'')) lot_no,COUNT(*) box_count,'' source_sheet,NULL source_row FROM ${source} WHERE ${where} GROUP BY upper(trim(item_code)))`;
    const matched=db.prepare(`SELECT COUNT(*) n FROM ${grouped}`).get(q).n;
    return {materials:db.prepare(`SELECT * FROM ${grouped} ORDER BY description,item_code LIMIT 200 OFFSET ?`).all(q,offset),total:db.prepare(`SELECT COUNT(*) n FROM ${source}`).get().n,total_items:db.prepare(`SELECT COUNT(DISTINCT upper(trim(item_code))) n FROM ${source}`).get().n,matched,field,next:offset+200<matched?offset+200:null};
  }
  const matched=db.prepare(`SELECT COUNT(*) n FROM ${source} WHERE ${where}`).get(q).n;
  return {materials:db.prepare(`SELECT * FROM ${source} WHERE ${where} ORDER BY ${order} LIMIT 200 OFFSET ?`).all(q,offset),total:db.prepare(`SELECT COUNT(*) n FROM ${source}`).get().n,matched,field,next:offset+200<matched?offset+200:null};
}

export function lookupAndSaveMM(db,options,userId){return transaction(db,()=>{
  const result=listMM(db,options),q=options.q.trim();
  if(!q||!result.materials.length)return result;
  let rows=result.materials,previous=null;
  if(options.offset&&options.saved_id){previous=db.prepare('SELECT id,snapshot FROM mm_lookup_saved WHERE id=? AND user_id=? AND field=? AND query=?').get(options.saved_id,userId,options.field,q);if(previous){const seen=new Map();for(const row of [...JSON.parse(previous.snapshot).materials,...rows])seen.set(options.field==='spec'?row.item_code.toUpperCase().trim():row.item_code+'|'+row.samsung,row);rows=[...seen.values()];}}
  const saved={...result,materials:rows.slice(0,1000),next:null};
  if(previous){db.prepare('UPDATE mm_lookup_saved SET snapshot=? WHERE id=? AND user_id=?').run(JSON.stringify(saved),previous.id,userId);return {...result,saved_id:previous.id};}
  const last=db.prepare('SELECT id,snapshot FROM mm_lookup_saved WHERE user_id=? AND field=? AND query=? ORDER BY id DESC LIMIT 1').get(userId,options.field,q);
  if(last&&last.snapshot===JSON.stringify(saved))return {...result,saved_id:last.id};
  const row=db.prepare('INSERT INTO mm_lookup_saved(user_id,field,query,snapshot) VALUES (?,?,?,?) RETURNING id').get(userId,options.field,q,JSON.stringify(saved));
  return {...result,saved_id:row.id};
});}
