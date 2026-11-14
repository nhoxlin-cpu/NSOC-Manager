import { test } from 'node:test';
import assert from 'node:assert/strict';
import XLSX from '../lib/vendor/sheetjs-0.20.3.cjs';
import { parseMMWorkbook,parseMMInWorker,MAX_MM_BYTES } from '../lib/mm-workbook.mjs';
import { importMMRows,listMM,lookupAndSaveMM } from '../lib/mm-data.mjs';
import { openDatabase } from '../lib/db.mjs';
import { stockData } from '../lib/stock-data.mjs';

const headers=['S/L','LOCATION','ITEM CD','ITEM NM','SPEC','BARCODE_NO','QTY','Receipt DT','BP_CD','BP_NM','CUST_LBL_NO','LOT_NO','MAKER','LABEL_STS'];
const row=(barcode,qty=2.125)=>['STORE','A-01','ITEM-TEST','Test item','10K 1608',barcode,qty,'2026-11-11','V001','Vendor','CUSTOMER','LOT-A','Maker','READY'];
test('Spec deduplicates ITEM across boxes, sums decimal quantities, keeps locations and paginates unique items',()=>{
 const db=openDatabase(':memory:');try{
 const rows=Array.from({length:202},(_,i)=>({barcode:'SPEC-'+i,item_code:i<2?'DUP':'ITEM-'+String(i).padStart(4,'0'),item_name:'Part',spec:'120uF',location:i?'A2':'A1',qty:1.125,lot_no:'L'+i,source_sheet:'QA',source_row:i+1}));
 importMMRows(db,{rows,sheets:['QA']},'Synthetic');const first=listMM(db,{q:'120uf',field:'spec'});assert.equal(first.matched,201);assert.equal(first.materials.length,200);assert.equal(first.next,200);const dup=first.materials.find(x=>x.item_code==='DUP');assert.equal(dup.qty,2.25);assert.equal(dup.box_count,2);assert.match(dup.location,/A1/);assert.match(dup.location,/A2/);const last=listMM(db,{q:'120uf',field:'spec',offset:200});assert.equal(last.materials.length,1);assert.equal(last.next,null);assert.equal(new Set([...first.materials,...last.materials].map(x=>x.item_code)).size,201);assert.equal(listMM(db,{q:'DUP',field:'item_code'}).matched,2);
 }finally{db.close();}
});
test('saved MM lookups survive MM removal without treating old QTY as current inventory',()=>{
 const db=openDatabase(':memory:');try{
 db.prepare('INSERT INTO users(username,name,password,role) VALUES (?,?,?,?)').run('qa','QA','unused','viewer');importMMRows(db,{rows:[{barcode:'KEEP-BAR',item_code:'KEEP',item_name:'Part',spec:'120uF',location:'A1',qty:2.125,source_sheet:'QA',source_row:1}],sheets:['QA']},'Synthetic');const result=lookupAndSaveMM(db,{q:'120uF',field:'spec',offset:0},1);assert.ok(result.saved_id);db.exec('DELETE FROM mm_inventory');assert.equal(lookupAndSaveMM(db,{q:'120uF',field:'spec',offset:0},1).matched,0);const saved=JSON.parse(db.prepare('SELECT snapshot FROM mm_lookup_saved WHERE id=?').get(result.saved_id).snapshot);assert.equal(saved.materials[0].qty,2.125);assert.equal(saved.materials[0].item_code,'KEEP');assert.equal(listMM(db,{q:'KEEP',field:'item_code'}).matched,0);
 }finally{db.close();}
});
test('saved MM lookup versions preserve earlier values when later nonempty MM results change',()=>{
 const db=openDatabase(':memory:');try{
 db.prepare('INSERT INTO users(username,name,password,role) VALUES (?,?,?,?)').run('qa','QA','unused','viewer');
 importMMRows(db,{rows:[{barcode:'VERSION-BAR',item_code:'VERSION',item_name:'Part',spec:'120uF',location:'A1',qty:1.25,source_sheet:'QA',source_row:1}],sheets:['QA']},'Synthetic');
 const a=lookupAndSaveMM(db,{q:'120uF',field:'spec',offset:0},1);assert.equal(lookupAndSaveMM(db,{q:'120uF',field:'spec',offset:0},1).saved_id,a.saved_id);
 db.prepare("UPDATE mm_inventory SET qty=8.5,location='A2'").run();const b=lookupAndSaveMM(db,{q:'120uF',field:'spec',offset:0},1);assert.notEqual(a.saved_id,b.saved_id);assert.equal(JSON.parse(db.prepare('SELECT snapshot FROM mm_lookup_saved WHERE id=?').get(a.saved_id).snapshot).materials[0].qty,1.25);assert.equal(JSON.parse(db.prepare('SELECT snapshot FROM mm_lookup_saved WHERE id=?').get(b.saved_id).snapshot).materials[0].qty,8.5);
 }finally{db.close();}
});
function workbook(type='biff8',sheets=[['First',[row('BAR-1')]],['Second',[row('BAR-2')]],['Third',[row('BAR-3')]]]){
  const wb=XLSX.utils.book_new();
  for(const [name,rows]of sheets)XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Report'],[],[],[],[],[],[],headers,...rows]),name);
  return XLSX.write(wb,{type:'buffer',bookType:type});
}
test('real XLS and XLSX formats read every sheet, find report headers and preserve decimal quantities',()=>{
  for(const type of ['biff8','xlsx']){
    const total=Array(14).fill('');total[6]=9;
    const parsed=parseMMWorkbook(workbook(type,[['First',[row('BAR-1')]],['Second',[row('BAR-2')]],['Third',[row('BAR-3'),total]]]));
    assert.equal(parsed.rows.length,3);assert.deepEqual(parsed.sheets.map(s=>s.rows),[1,1,1]);assert.ok(parsed.sheets.every(s=>s.headerRow===8));assert.equal(parsed.sheets[2].totalRows,1);
    assert.equal(parsed.rows[2].qty,2.125);assert.equal(parsed.rows[2].vendor_code,'V001');assert.equal(parsed.rows[2].customer_label,'CUSTOMER');assert.equal(parsed.rows[2].label_status,'READY');assert.equal(parsed.rows[2].source_sheet,'Third');
  }
});
test('worker parser reads all sheets without blocking the main process',async()=>{
  const parsed=await parseMMInWorker(workbook());assert.equal(parsed.rows.length,3);assert.equal(parsed.sheets.length,3);
});
test('invalid nonempty sheets, duplicate barcodes and invalid input fail instead of importing a partial workbook',()=>{
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([headers,row('GOOD')]),'Good');XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Unexpected data']]),'Bad');
  assert.throws(()=>parseMMWorkbook(XLSX.write(wb,{type:'buffer',bookType:'xlsx'})),/Bad/);
  assert.throws(()=>parseMMWorkbook(workbook('biff8',[['First',[row('SAME')]],['Second',[row('SAME')]]])),/trùng/);
  assert.throws(()=>parseMMWorkbook(Buffer.from('not Excel')),/hợp lệ/);assert.throws(()=>parseMMWorkbook(Buffer.alloc(MAX_MM_BYTES+1)),/32 MB/);
});
test('import retains separate barcode rows for one ITEM, updates by barcode and exposes every page',()=>{
  const db=openDatabase(':memory:');
  try{
    const rows=Array.from({length:205},(_,i)=>row('BAR-'+String(i).padStart(4,'0')));
    const parsed=parseMMWorkbook(workbook('xlsx',[['First',rows.slice(0,70)],['Second',rows.slice(70,140)],['Third',rows.slice(140)]]));
    const result=importMMRows(db,parsed,'synthetic.xlsx');assert.equal(result.count,205);assert.equal(result.inserted,205);
    const first=listMM(db,{field:'item_code',q:'ITEM-TEST'});assert.equal(first.total,205);assert.equal(first.materials.length,200);assert.equal(first.next,200);
    const last=listMM(db,{field:'item_code',q:'ITEM-TEST',offset:200});assert.equal(last.materials.length,5);assert.equal(last.next,null);
    assert.equal(stockData(db,'BAR-0204').quantity,2.125);assert.equal(stockData(db,'BAR-0204').lot_no,'LOT-A');
    parsed.rows[0].qty=8.5;const again=importMMRows(db,parsed,'updated.xlsx');assert.equal(again.updated,205);assert.equal(db.prepare('SELECT COUNT(*) n FROM mm_inventory').get().n,205);assert.equal(stockData(db,'BAR-0000').quantity,8.5);
    assert.equal(db.prepare('SELECT COUNT(DISTINCT source_sheet) n FROM mm_inventory').get().n,3);
  }finally{db.close();}
});
