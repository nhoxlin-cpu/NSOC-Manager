import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../lib/db.mjs';
import {initHolding,importHolding,holdingLookup,holdingReference,holdingPreferences,receiveHolding,withdrawHolding,holdingInventory,holdingEvents,holdingReport} from '../lib/holding.mjs';
import {parseMMWorkbook} from '../lib/mm-workbook.mjs';
import XLSX from '../lib/vendor/sheetjs-0.20.3.cjs';
import {createApp} from '../server.mjs';
import {issueSession} from '../lib/auth.mjs';
const setup=()=>{const db=openDatabase(':memory:');db.prepare("INSERT INTO users(id,username,name,password,role) VALUES (1,'a','User A','unused','admin'),(2,'b','User B','unused','inspector')").run();initHolding(db);return db;};
const row=(extra={})=>({barcode:'R2608070021616',item_code:'000123',item_name:'Part',qty:200,vendor:'Vendor',lot_no:'001122',storage_location:'PBA32',...extra});
const receive=(extra={})=>({request_id:randomUUID(),barcode:'P-BOX-1',item_code:'000123',item_name:'Part',qty:10.5,location:'A-01',vendor:'Vendor',lot_no:'001122',...extra});
test('Stock 32 XLS parser imports independent reference types and preserves text codes and vendor',()=>{
 const db=setup();try{const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Stock 32'],['S/L','LOCATION','ITEM CD','ITEM NM','SPEC','BARCODE_NO','QTY','BP_NM','LOT_NO'],['PBA32','OLD','000123','Part','Spec','R2608070021616',1.25,'Vendor','001122'],['','','','','','',1.25]]),'PBA32');
 const parsed=parseMMWorkbook(XLSX.write(wb,{type:'buffer',bookType:'biff8'}));const batch=importHolding(db,parsed,'pba.xls','PBA32',1);assert.equal(batch.rows,1);assert.equal(holdingLookup(db,'r2608070021616').matches[0].vendor,'Vendor');assert.equal(holdingLookup(db,'R2608070021616').matches[0].lot_no,'001122');
 assert.throws(()=>importHolding(db,parsed,'bad.xls','PMD32',1),/S\/L/);importHolding(db,{rows:[row({storage_location:'PMD32',barcode:'M2608070021616'})]},'pmd.xls','PMD32',1);
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
test('Holding HTTP upload is admin-only and CSRF protected; lookup, images, exports and preferences remain authenticated',async()=>{
 const db=setup();db.prepare("INSERT INTO users(id,username,name,password,role) VALUES(3,'v','Viewer','unused','viewer')").run();const server=await createApp({db});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const sessions=[null,...[1,2,3].map(id=>issueSession(db,id))];const request=(path,user=1,method='GET',body,extra={})=>fetch(base+'/api/holding/v2/'+path,{method,headers:{...(user?{Cookie:'wa_session='+sessions[user].token,'X-CSRF-Token':sessions[user].csrf}:{}),...(body?{'Content-Type':'application/json'}:{}),...extra},body:body?JSON.stringify(body):undefined});
 try{const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['S/L','LOCATION','ITEM CD','ITEM NM','SPEC','BARCODE_NO','QTY','BP_NM','LOT_NO'],['PBA32','','000123','Part','Spec','R2608070021616',12.5,'V','001']]),'Stock');const bytes=XLSX.write(wb,{type:'buffer',bookType:'biff8'});
 const upload=(user,csrf=sessions[user].csrf)=>fetch(base+'/api/holding/v2/import?kind=PBA32',{method:'POST',headers:{Cookie:'wa_session='+sessions[user].token,'X-CSRF-Token':csrf,'Content-Type':'application/octet-stream','X-MM-File-Name':'stock.xls'},body:bytes});
 assert.equal((await request('inventory',0)).status,401);assert.equal((await upload(2)).status,403);assert.equal((await upload(3)).status,403);assert.equal((await upload(1,'wrong')).status,403);assert.equal((await upload(1)).status,200);
 const looked=await (await request('lookup?barcode=R2608070021616',3)).json();assert.equal(looked.matches[0].item_code,'000123');
 const received=await request('receive',2,'POST',{...receive({barcode:row().barcode,batch_id:looked.matches[0].batch_id}),image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1kAAAAASUVORK5CYII='});assert.equal(received.status,201);const saved=await received.json();
 assert.equal((await request('entries/'+saved.id+'/image',3)).status,200);assert.equal((await request('export',3)).status,200);assert.equal((await request('preferences',3,'POST',{location:'A-99'})).status,403);
 await request('preferences',2,'POST',{location:'B-01',auto_save:false});assert.deepEqual(await (await request('preferences',2)).json(),{location:'B-01',auto_save:false});assert.equal((await (await request('preferences',1)).json()).location,'');
 assert.equal((await request('withdraw',3,'POST',{request_id:randomUUID(),entry_id:saved.id,qty:1,reason:'No access'})).status,403);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
});
