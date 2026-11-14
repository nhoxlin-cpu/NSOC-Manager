import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../lib/db.mjs';
import {initHolding,importHolding,holdingLookup,holdingReference,holdingPreferences,receiveHolding,withdrawHolding,editHolding,editHoldingGroup,holdingInventory,holdingEvents,holdingReport} from '../lib/holding.mjs';
import {parseMMWorkbook} from '../lib/mm-workbook.mjs';
import XLSX from '../lib/vendor/sheetjs-0.20.3.cjs';
import {createApp} from '../server.mjs';
import {issueSession} from '../lib/auth.mjs';
const setup=()=>{const db=openDatabase(':memory:');db.prepare("INSERT INTO users(id,username,name,password,role) VALUES (1,'a','User A','unused','admin'),(2,'b','User B','unused','inspector')").run();initHolding(db);return db;};
const row=(extra={})=>({barcode:'R9901010000001',item_code:'000123',item_name:'Part',qty:200,vendor:'Vendor',lot_no:'001122',storage_location:'PBA32',...extra});
const receive=(extra={})=>({request_id:randomUUID(),barcode:'P-BOX-1',item_code:'000123',item_name:'Part',qty:10.5,location:'A-01',vendor:'Vendor',lot_no:'001122',...extra});
test('Stock 32 XLS parser imports independent reference types and preserves text codes and vendor',()=>{
 const db=setup();try{const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Stock 32'],['S/L','LOCATION','ITEM CD','ITEM NM','SPEC','BARCODE_NO','QTY','BP_NM','LOT_NO'],['PBA32','OLD','000123','Part','Spec','R9901010000001',1.25,'Vendor','001122'],['','','','','','',1.25]]),'PBA32');
 const parsed=parseMMWorkbook(XLSX.write(wb,{type:'buffer',bookType:'biff8'}));const batch=importHolding(db,parsed,'pba.xls','PBA32',1);assert.equal(batch.rows,1);assert.equal(holdingLookup(db,'r9901010000001').matches[0].vendor,'Vendor');assert.equal(holdingLookup(db,'R9901010000001').matches[0].lot_no,'001122');
 assert.throws(()=>importHolding(db,parsed,'bad.xls','PMD32',1),/S\/L/);importHolding(db,{rows:[row({storage_location:'PMD32',barcode:'M9901010000001'})]},'pmd.xls','PMD32',1);
 assert.equal(holdingReference(db).barcodes.length,2);assert.equal(holdingInventory(db).totals.boxes,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM mm_inventory').get().n,0);
 }finally{db.close();}
});
test('manual intake, active barcode uniqueness, decimal withdrawal, idempotency and re-entry retain audit',()=>{
 const db=setup();try{const body=receive(),r=receiveHolding(db,body,1);assert.equal(receiveHolding(db,body,1).id,r.id);assert.throws(()=>receiveHolding(db,body,2));assert.throws(()=>receiveHolding(db,receive(),2),/đang có/);
 const out={request_id:randomUUID(),entry_id:r.id,qty:.5,reason:'Production'};assert.equal(withdrawHolding(db,out,2).balance,10);assert.equal(withdrawHolding(db,out,2).balance,10);assert.throws(()=>withdrawHolding(db,{...out,request_id:randomUUID(),qty:11},2),/vượt/);assert.throws(()=>withdrawHolding(db,{...out,request_id:randomUUID(),reason:''},2));
 withdrawHolding(db,{...out,request_id:randomUUID(),qty:10},2);assert.equal(holdingInventory(db).totals.boxes,0);const again=receiveHolding(db,receive(),1);assert.notEqual(again.id,r.id);assert.equal(holdingEvents(db).length,4);assert.equal(holdingEvents(db).find(r=>r.direction==='out').scanner,'User B');
 }finally{db.close();}
});
test('reference replacement does not alter saved boxes; conflicts and stale references are explicit',()=>{
 const db=setup();try{const first=importHolding(db,{rows:[row()]},'old.xls','PBA32',1);receiveHolding(db,receive({barcode:row().barcode,batch_id:first.id}),1);
 importHolding(db,{rows:[row({qty:999,vendor:'Updated'})]},'new.xls','PBA32',1);assert.equal(holdingInventory(db).entries[0].vendor,'Vendor');assert.equal(holdingLookup(db,row().barcode).matches[0].qty,999);assert.throws(()=>receiveHolding(db,receive({barcode:'OTHER',batch_id:first.id}),1),/thay đổi/);
 importHolding(db,{rows:[row({storage_location:'PMD32'})]},'pmd.xls','PMD32',1);assert.equal(holdingLookup(db,row().barcode).matches.length,2);
 }finally{db.close();}
});
test('ITEM totals include all pages; filters, counts and four-sheet report agree',()=>{
 const db=setup();try{for(let i=0;i<105;i++)receiveHolding(db,receive({barcode:'P-BOX-'+i,qty:1.25,location:i%2?'A-01':'B-01'}),1);
 const r=holdingInventory(db);assert.equal(r.entries.length,100);assert.equal(r.items[0].boxes,105);assert.equal(r.items[0].qty,131.25);assert.equal(holdingInventory(db,{offset:r.next}).entries.length,5);assert.equal(holdingInventory(db,{q:'B-01'}).totals.boxes,53);
 const wb=XLSX.read(holdingReport(db,{}, {name:'Boss report'}),{type:'buffer'});assert.deepEqual(wb.SheetNames,['Tổng quan','Theo ITEM','Theo Barcode','Nhật ký']);const rows=XLSX.utils.sheet_to_json(wb.Sheets['Theo ITEM'],{header:1});assert.ok(rows.some(r=>r.includes('000123')&&r.includes(131.25)&&r.includes(105)));assert.ok(wb.Sheets['Theo Barcode']['!autofilter']);
 }finally{db.close();}
});
test('location preferences are per user and persist independently from auto-save',()=>{
 const db=setup();try{holdingPreferences(db,1,{location:'A-01',auto_save:false});assert.deepEqual(holdingPreferences(db,2),{location:'',auto_save:true});receiveHolding(db,receive({location:'B-02'}),1);assert.deepEqual(holdingPreferences(db,1),{location:'B-02',auto_save:false});assert.throws(()=>receiveHolding(db,receive({barcode:'NEW',qty:1e-8}),1));}finally{db.close();}
});
test('Holding edits update current totals and retain immutable before/after and original receipt metadata',()=>{
 const db=setup();try{const received=receiveHolding(db,receive(),1);withdrawHolding(db,{request_id:randomUUID(),entry_id:received.id,qty:.5,reason:'Production'},1);
 const current=holdingInventory(db).entries[0],body={...current,entry_id:current.id,expected_revision:current.revision,request_id:randomUUID(),barcode:'P-BOX-EDIT',item_code:'NEW-ITEM',item_name:'New part',location:'B-02',remaining_qty:12.5,vendor:'New vendor',lot_no:'0009',reason:'Count correction'};
 const updated=editHolding(db,body,2);assert.equal(updated.balance,12.5);assert.equal(editHolding(db,body,2).duplicate,true);
 const inventory=holdingInventory(db);assert.equal(inventory.totals.boxes,1);assert.equal(inventory.items[0].item_code,'NEW-ITEM');assert.equal(inventory.items[0].qty,12.5);assert.equal(inventory.entries[0].initial_qty,10.5);assert.equal(holdingPreferences(db,1).location,'A-01');
 const events=holdingEvents(db),change=events[0];assert.equal(events.length,3);assert.equal(change.direction,'edit');assert.equal(change.qty,2.5);assert.equal(change.scanner,'User B');assert.equal(change.before.remaining_qty,10);assert.equal(change.after.remaining_qty,12.5);assert.match(change.changes,/Barcode: P-BOX-1 → P-BOX-EDIT/);
 assert.equal(events.find(r=>r.direction==='in').barcode,'P-BOX-1');assert.equal(events.find(r=>r.direction==='out').location,'A-01');assert.equal(holdingEvents(db,{q:'P-BOX-1'}).length,2);
 const report=XLSX.read(holdingReport(db,{}, {name:'QA'}),{type:'buffer'}),rows=XLSX.utils.sheet_to_json(report.Sheets['Nhật ký'],{header:1});assert.ok(rows.some(r=>r.includes('Điều chỉnh')&&r.includes('Count correction')&&r.includes(2.5)));assert.ok(rows.some(r=>r.includes('P-BOX-1')&&r.includes('Production')));
 }finally{db.close();}
});
test('Holding edits reject duplicate barcodes and stale versions and allow an audited zero-stock correction',()=>{
 const db=setup();try{const received=receiveHolding(db,receive(),1);receiveHolding(db,receive({barcode:'OTHER-BOX'}),1);const current=holdingInventory(db).entries.find(r=>r.id===received.id),body={...current,entry_id:current.id,expected_revision:current.revision,request_id:randomUUID(),remaining_qty:2,reason:'Count correction'};
 assert.throws(()=>editHolding(db,{...body,barcode:'OTHER-BOX'},2),/box khác/);assert.equal(holdingInventory(db).totals.qty,21);
 withdrawHolding(db,{request_id:randomUUID(),entry_id:current.id,qty:1,reason:'Issue'},1);assert.throws(()=>editHolding(db,body,2),/thay đổi/);assert.throws(()=>withdrawHolding(db,{request_id:randomUUID(),entry_id:current.id,expected_revision:0,qty:1,reason:'Stale issue'},1),/thay đổi/);
 const fresh=holdingInventory(db).entries.find(r=>r.id===received.id),zero={...body,expected_revision:fresh.revision,remaining_qty:0,request_id:randomUUID()};assert.equal(editHolding(db,zero,2).balance,0);assert.equal(holdingInventory(db).totals.boxes,1);assert.equal(editHolding(db,zero,2).duplicate,true);assert.throws(()=>editHolding(db,zero,1));
 assert.throws(()=>editHolding(db,{...zero,request_id:randomUUID()},2),/xuất hết/);assert.notEqual(receiveHolding(db,receive(),1).id,received.id);
 }finally{db.close();}
});
test('Holding migration backfills legacy audit snapshots once without resetting stock',()=>{
 const db=setup();try{const received=receiveHolding(db,receive(),1);withdrawHolding(db,{request_id:randomUUID(),entry_id:received.id,qty:.5,reason:'Old issue'},1);
 db.exec('ALTER TABLE holding_events DROP COLUMN snapshot; ALTER TABLE holding_events DROP COLUMN before_snapshot; ALTER TABLE holding_entries DROP COLUMN revision;');initHolding(db);
 const events=holdingEvents(db);assert.equal(events.length,2);assert.equal(events[0].before.remaining_qty,10.5);assert.equal(events[0].after.remaining_qty,10);assert.equal(events[1].after.remaining_qty,10.5);assert.equal(holdingInventory(db).totals.qty,10);
 const saved=db.prepare('SELECT snapshot FROM holding_events ORDER BY id').all();initHolding(db);assert.deepEqual(db.prepare('SELECT snapshot FROM holding_events ORDER BY id').all(),saved);
 }finally{db.close();}
});
test('Holding ITEM group edits change only selected box metadata and are idempotent across retries',()=>{
 const db=setup();try{for(let i=0;i<3;i++)receiveHolding(db,receive({barcode:'GROUP-'+i}),1);
 const all=holdingInventory(db).entries,body={request_id:randomUUID(),item_code:'000123',rows:all.slice(0,2).map(r=>({id:r.id,expected_revision:r.revision})),changes:{item_code:'NEW-ITEM',location:'b-02'},reason:'Move selected boxes'};
 const result=editHoldingGroup(db,body,2);assert.equal(result.updated,2);assert.equal(result.unchanged,0);assert.equal(holdingInventory(db).totals.qty,31.5);assert.equal(holdingInventory(db).totals.boxes,3);
 const items=holdingInventory(db).items;assert.equal(items.find(r=>r.item_code==='NEW-ITEM').qty,21);assert.equal(items.find(r=>r.item_code==='000123').boxes,1);assert.ok(holdingInventory(db).entries.filter(r=>r.item_code==='NEW-ITEM').every(r=>r.location==='B-02'&&r.initial_qty===10.5&&r.remaining_qty===10.5));
 assert.equal(editHoldingGroup(db,{...body,rows:[...body.rows].reverse()},2).duplicate,true);assert.equal(holdingEvents(db).filter(r=>r.direction==='edit').length,2);assert.throws(()=>editHoldingGroup(db,{...body,reason:'Different request'},2),/lượt sửa khác/);assert.throws(()=>editHoldingGroup(db,body,1));
 assert.equal(holdingEvents(db).filter(r=>r.direction==='in'&&r.item_code==='000123').length,3);
 }finally{db.close();}
});
test('Holding ITEM group edits reject stale/mixed membership and skip already-matching boxes',()=>{
 const db=setup();try{receiveHolding(db,receive({barcode:'GROUP-1',location:'B-02'}),1);receiveHolding(db,receive({barcode:'GROUP-2'}),1);receiveHolding(db,receive({barcode:'OTHER',item_code:'OTHER-ITEM'}),1);const entries=holdingInventory(db).entries.filter(r=>r.item_code==='000123'),body={request_id:randomUUID(),item_code:'000123',rows:entries.map(r=>({id:r.id,expected_revision:r.revision})),changes:{location:'B-02'},reason:'Move bin'};
 const result=editHoldingGroup(db,body,1);assert.equal(result.updated,1);assert.equal(result.unchanged,1);
 assert.throws(()=>editHoldingGroup(db,{...body,request_id:randomUUID()},1),/Một box đã thay đổi/);
 const fresh=holdingInventory(db).entries,original=fresh.filter(r=>r.item_code==='000123'),other=fresh.find(r=>r.item_code==='OTHER-ITEM'),validRows=original.map(r=>({id:r.id,expected_revision:r.revision}));
 assert.throws(()=>editHoldingGroup(db,{...body,request_id:randomUUID(),rows:[validRows[0],{id:other.id,expected_revision:other.revision}]},1),/không còn thuộc ITEM/);
 assert.throws(()=>editHoldingGroup(db,{...body,request_id:randomUUID(),rows:[validRows[0],validRows[0]]},1),/bị trùng/);
 assert.throws(()=>editHoldingGroup(db,{...body,request_id:randomUUID(),rows:validRows,changes:{remaining_qty:0}},1),/Chỉ sửa chung/);
 const noop=editHoldingGroup(db,{...body,request_id:randomUUID(),rows:validRows},1);assert.equal(noop.updated,0);assert.equal(noop.unchanged,2);assert.equal(holdingEvents(db).filter(r=>r.direction==='edit').length,1);
 }finally{db.close();}
});
test('Holding ITEM group transaction rolls back earlier changes if a later box update fails',()=>{
 const db=setup();try{receiveHolding(db,receive({barcode:'GROUP-1'}),1);receiveHolding(db,receive({barcode:'GROUP-2'}),1);const entries=holdingInventory(db).entries.sort((a,b)=>a.id-b.id),body={request_id:randomUUID(),item_code:'000123',rows:entries.map(r=>({id:r.id,expected_revision:r.revision})),changes:{location:'B-02'},reason:'Atomic move'};
 db.exec(`CREATE TRIGGER reject_group_update BEFORE UPDATE ON holding_entries WHEN OLD.id=${entries[1].id} BEGIN SELECT RAISE(ABORT,'test failure'); END;`);assert.throws(()=>editHoldingGroup(db,body,1));assert.ok(holdingInventory(db).entries.every(r=>r.location==='A-01'&&r.revision===0));assert.equal(holdingEvents(db).length,2);assert.equal(db.prepare('SELECT COUNT(*) n FROM holding_group_edits').get().n,0);
 db.exec('DROP TRIGGER reject_group_update');assert.equal(editHoldingGroup(db,body,1).updated,2);assert.equal(holdingEvents(db).length,4);
 }finally{db.close();}
});
test('Holding HTTP upload is admin-only and CSRF protected; lookup, images, exports and preferences remain authenticated',async()=>{
 const db=setup();db.prepare("INSERT INTO users(id,username,name,password,role) VALUES(3,'v','Viewer','unused','viewer')").run();const server=await createApp({db});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const sessions=[null,...[1,2,3].map(id=>issueSession(db,id))];const request=(path,user=1,method='GET',body,extra={})=>fetch(base+'/api/holding/v2/'+path,{method,headers:{...(user?{Cookie:'wa_session='+sessions[user].token,'X-CSRF-Token':sessions[user].csrf}:{}),...(body?{'Content-Type':'application/json'}:{}),...extra},body:body?JSON.stringify(body):undefined});
 try{const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['S/L','LOCATION','ITEM CD','ITEM NM','SPEC','BARCODE_NO','QTY','BP_NM','LOT_NO'],['PBA32','','000123','Part','Spec','R9901010000001',12.5,'V','001']]),'Stock');const bytes=XLSX.write(wb,{type:'buffer',bookType:'biff8'});
 const upload=(user,csrf=sessions[user].csrf)=>fetch(base+'/api/holding/v2/import?kind=PBA32',{method:'POST',headers:{Cookie:'wa_session='+sessions[user].token,'X-CSRF-Token':csrf,'Content-Type':'application/octet-stream','X-MM-File-Name':'stock.xls'},body:bytes});
 assert.equal((await request('inventory',0)).status,401);assert.equal((await upload(2)).status,403);assert.equal((await upload(3)).status,403);assert.equal((await upload(1,'wrong')).status,403);assert.equal((await upload(1)).status,200);
 const looked=await (await request('lookup?barcode=R9901010000001',3)).json();assert.equal(looked.matches[0].item_code,'000123');
 const received=await request('receive',2,'POST',{...receive({barcode:row().barcode,batch_id:looked.matches[0].batch_id}),image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1kAAAAASUVORK5CYII='});assert.equal(received.status,201);const saved=await received.json();
 assert.equal((await request('entries/'+saved.id+'/image',3)).status,200);assert.equal((await request('export',3)).status,200);assert.equal((await request('preferences',3,'POST',{location:'A-99'})).status,403);
 await request('preferences',2,'POST',{location:'B-01',auto_save:false});assert.deepEqual(await (await request('preferences',2)).json(),{location:'B-01',auto_save:false});assert.equal((await (await request('preferences',1)).json()).location,'');
 assert.equal((await request('withdraw',3,'POST',{request_id:randomUUID(),entry_id:saved.id,qty:1,reason:'No access'})).status,403);
 const current=(await (await request('inventory')).json()).entries[0],edit={...current,entry_id:saved.id,request_id:randomUUID(),expected_revision:current.revision,location:'C-03',remaining_qty:9,reason:'Correction'};
 assert.equal((await request('edit',3,'POST',edit)).status,403);assert.equal((await request('edit',2,'POST',edit,{'X-CSRF-Token':'wrong'})).status,403);assert.equal((await request('edit',2,'POST',edit)).status,200);assert.equal((await (await request('events',3)).json()).events[0].direction,'edit');
 const latest=(await (await request('inventory')).json()).entries[0],group={request_id:randomUUID(),item_code:latest.item_code,rows:[{id:latest.id,expected_revision:latest.revision}],changes:{location:'D-04'},reason:'Group move'};
 assert.equal((await request('edit-group',0,'POST',group)).status,401);assert.equal((await request('edit-group',3,'POST',group)).status,403);assert.equal((await request('edit-group',2,'POST',group,{'X-CSRF-Token':'wrong'})).status,403);assert.equal((await request('edit-group',2,'POST',group)).status,200);assert.equal((await (await request('inventory')).json()).entries[0].remaining_qty,9);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
});
