import { importCkdWorkbook } from '../lib/ckd.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../lib/db.mjs';
import { hashPassword } from '../lib/auth.mjs';
import { createApp } from '../server.mjs';
import { parseCSV, excel } from '../lib/formats.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import XLSX from '../lib/vendor/sheetjs-0.20.3.cjs';
import { request as httpRequest } from 'node:http';

let db, server, base, admin, inspector, viewer;
const password = 'only-a-test-password-2026';
const header = 'item_code,samsung,item,description,maker,vendor,location,selling_qty,moq';
const mm = header + '\nITEM-1,BN83-TEST,RES-CHIP,"1M ohm, 1608",YAGEO,S-PARTS,A-01,10000,5000';
async function request(path, session, method = 'GET', body, extra = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(session ? { Cookie:session.cookie, 'X-CSRF-Token':session.csrf } : {}), ...(body ? { 'Content-Type':'application/json' } : {}), ...extra },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : await res.text();
  return { status:res.status, data, headers:res.headers };
}
async function login(username) {
  const r = await request('/api/login', null, 'POST', { username, password });
  assert.equal(r.status,200);
  return { cookie:r.headers.get('set-cookie').split(';')[0], csrf:r.data.csrf };
}
const box = overrides => ({ request_id:randomUUID(), delivery:'PN-001', box_ref:randomUUID(), item_code:'ITEM-1', label_a:'bn83-test', label_b:' BN83-TEST ', maker:'yageo', qty:5000, ...overrides });
test('Stock bulk deletion is scoped, authorized and atomic; ITEM totals cover all pages and preserve missing QTY',async()=>{
  const item='BULK-TOTAL-ITEM';
  const insert=db.prepare("INSERT INTO scans(request_id,barcode,mode,user_id,quantity) VALUES (?,?,'Stock',1,?)");
  const ids=[];for(let i=0;i<105;i++){const id=Number(insert.run(randomUUID(),'BULK-'+i,i===0?null:.5).lastInsertRowid);ids.push(id);db.prepare('INSERT INTO scan_stock(scan_id,item_code,item_name,quantity_source) VALUES (?,?,?,?)').run(id,item,'Test total','MM');}
  const list=await request('/api/scans?mode=Stock',admin);assert.equal(list.data.scans.length,100);
  const group=list.data.stock_summary.find(r=>r.item_code===item);assert.equal(group.scans,105);assert.equal(group.quantity_count,104);assert.equal(group.total_quantity,52);
  const endpoint='/api/scans/delete',body={mode:'Stock',ids:[ids[0],ids[1]]};
  assert.equal((await request(endpoint,null,'POST',body)).status,401);
  for(const session of [inspector,viewer])assert.equal((await request(endpoint,session,'POST',body)).status,403);
  assert.equal((await request(endpoint,admin,'POST',body,{'X-CSRF-Token':'wrong'})).status,403);
  const hs=Number(db.prepare("INSERT INTO scans(request_id,barcode,mode,user_id) VALUES (?,?,'HS',1)").run(randomUUID(),'BULK-HS-KEEP').lastInsertRowid);
  assert.equal((await request(endpoint,admin,'POST',{mode:'Stock',ids:[ids[0],hs]})).status,409);assert.ok(db.prepare('SELECT id FROM scans WHERE id=?').get(ids[0]));
  assert.equal((await request(endpoint,admin,'POST',{mode:'HS',all:true,through_id:hs})).status,400);
  const deleted=await request(endpoint,admin,'POST',body);assert.equal(deleted.data.deleted,2);assert.equal(db.prepare('SELECT COUNT(*) n FROM scan_stock WHERE scan_id IN (?,?)').get(...body.ids).n,0);
  const after=(await request('/api/scans?mode=Stock',admin)).data;assert.equal(after.stock_summary.find(r=>r.item_code===item).total_quantity,51.5);
  const newer=Number(insert.run(randomUUID(),'BULK-NEWER',7).lastInsertRowid);
  assert.equal((await request(endpoint,admin,'POST',{mode:'Stock',all:true,through_id:after.max_id})).status,200);
  assert.ok(db.prepare('SELECT id FROM scans WHERE id=?').get(newer));assert.ok(db.prepare('SELECT id FROM scans WHERE id=?').get(hs));
  db.prepare('DELETE FROM scans WHERE id IN (?,?)').run(newer,hs);
});
before(async () => {
  db = openDatabase(':memory:'); const hash = await hashPassword(password);
  for (const role of ['admin','inspector','viewer']) db.prepare('INSERT INTO users(username,name,password,role) VALUES (?,?,?,?)').run(role, role, hash, role);
  server = await createApp({ db, origin:'http://work-area.test', production:false });
  server.connectionsCheckingInterval=50;
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  admin = await login('admin'); inspector = await login('inspector'); viewer = await login('viewer');
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });

test('serves the home UI and protects internal files and anonymous records', async () => {
  const home = await request('/'); assert.equal(home.status,200); assert.match(home.data,/WORK AREA/);
  assert.match(home.headers.get('content-security-policy'),/default-src 'self'/);
  for (const path of ['/server.mjs','/.env','/data/work-area.sqlite','/../server.mjs']) assert.equal((await request(path)).status,404);
  assert.equal((await request('/api/scans')).status,401);
  assert.equal((await request('/api/export?kind=scans')).status,401);
});

test('uses HttpOnly session cookies and checks origin, CSRF and server roles', async () => {
  const r = await request('/api/login',null,'POST',{ username:'viewer', password });
  assert.match(r.headers.get('set-cookie'),/HttpOnly/); assert.match(r.headers.get('set-cookie'),/SameSite=Strict/);
  assert.equal((await request('/api/login',null,'POST',{ username:'admin',password },{ Origin:'https://evil.example' })).status,403);
  const data = { request_id:randomUUID(), barcode:'BN83-TEST', mode:'Label' };
  assert.equal((await request('/api/scans',inspector,'POST',data,{ 'X-CSRF-Token':'wrong' })).status,403);
  assert.equal((await request('/api/scans',viewer,'POST',data)).status,403);
  assert.equal((await request('/api/materials/import',inspector,'POST',{ csv:mm })).status,403);
  assert.equal((await request('/api/users',viewer)).status,403);
});

test('imports UTF-8 CSV with quoted commas, preserves text and rolls back a conflicting batch', async () => {
  assert.equal((await request('/api/materials/import',admin,'POST',{ csv:'\uFEFF' + mm })).status,200);
  const search = await request('/api/materials?q=bn83',viewer);
  assert.equal(search.data.materials[0].description,'1M ohm, 1608');
  const conflict = header + '\nITEM-2,BN83-SECOND,CAP,Test,MAKER,Vendor,A-02,100,10\nITEM-3,BN83-TEST,CAP,Test,MAKER,Vendor,A-03,100,10';
  const r = await request('/api/materials/import',admin,'POST',{ csv:conflict });
  assert.equal(r.status,409);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM materials').get().n,1);
  assert.equal((await request('/api/materials/import',admin,'POST',{ csv:mm.replace('10000,5000','-1,5000') })).status,400);
});

test('scans are shared between users, image validation rejects non-image content and repeat submission is idempotent', async () => {
  const payload = { request_id:randomUUID(), barcode:'BN83-TEST', mode:'Label' };
  const first = await request('/api/scans',inspector,'POST',payload); assert.equal(first.status,201);
  const repeated = await request('/api/scans',inspector,'POST',payload); assert.equal(repeated.status,200); assert.equal(repeated.data.id,first.data.id);
  const listed = await request('/api/scans',viewer); assert.equal(listed.data.total,1); assert.equal(listed.data.scans[0].item_code,'ITEM-1');
  assert.equal((await request('/api/scans',inspector,'POST',{ ...payload, request_id:randomUUID(),image:'data:image/png;base64,PHNjcmlwdD4=' })).status,400);
  assert.equal((await request('/api/scans/' + first.data.id,inspector,'DELETE')).status,403);
});

test('CKD never passes missing MM, different labels or wrong maker; checking alone saves no boxes', async () => {
  for (const changed of [{ item_code:'UNKNOWN' },{ label_b:'OTHER' },{ maker:'WRONG' }]) {
    const r = await request('/api/ckd/check',inspector,'POST',box(changed)); assert.equal(r.status,200); assert.equal(r.data.pass,false);
    assert.equal((await request('/api/ckd/confirm',inspector,'POST',box(changed))).status,400);
  }
  const r = await request('/api/ckd/check',viewer,'POST',box()); assert.equal(r.data.pass,true); assert.equal(r.data.after,5000);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM boxes').get().n,0);
});

test('CKD duplicate box and duplicate network retries cannot increment quantity twice', async () => {
  const payload = box({ box_ref:'BOX-001' });
  assert.equal((await request('/api/ckd/confirm',inspector,'POST',payload)).status,201);
  assert.equal((await request('/api/ckd/confirm',inspector,'POST',payload)).data.duplicate,true);
  assert.equal((await request('/api/ckd/confirm',inspector,'POST',{ ...payload, request_id:randomUUID() })).status,409);
  assert.equal(db.prepare('SELECT SUM(qty) qty FROM boxes WHERE delivery=?').get('PN-001').qty,5000);
});

test('simultaneous confirmations recheck totals and keep different deliveries independent', async () => {
  const payloads = [box({ box_ref:'BOX-002' }),box({ box_ref:'BOX-003' })];
  const results = await Promise.all(payloads.map(b => request('/api/ckd/confirm',inspector,'POST',b)));
  assert.deepEqual(results.map(r => r.status).sort(),[201,409]);
  assert.equal(db.prepare('SELECT SUM(qty) qty FROM boxes WHERE delivery=?').get('PN-001').qty,10000);
  assert.equal((await request('/api/ckd/confirm',inspector,'POST',box({ delivery:'PN-002',box_ref:'BOX-001' }))).status,201);
  assert.equal((await request('/api/ckd/confirm',viewer,'POST',box())).status,403);
});

test('Holding transactions prevent negative stock under concurrent requests and preserve locations', async () => {
  const payload = { request_id:randomUUID(),item_code:'ITEM-1',location:'A-01',direction:'in',qty:100,note:'Nhập kiểm tra' };
  assert.equal((await request('/api/holding',inspector,'POST',payload)).status,201);
  assert.equal((await request('/api/holding',inspector,'POST',payload)).data.duplicate,true);
  const withdrawals = await Promise.all([1,2].map(() => request('/api/holding',inspector,'POST',{ ...payload,request_id:randomUUID(),direction:'out',qty:80 })));
  assert.deepEqual(withdrawals.map(r => r.status).sort(),[201,409]);
  const r = await request('/api/holding',viewer); assert.equal(r.data.balances[0].qty,20);
  assert.equal((await request('/api/holding',inspector,'POST',{ ...payload,request_id:randomUUID(),direction:'out',location:'A-02',qty:1 })).status,409);
});

test('shortcut preferences are authenticated, validated, private per account and editable by viewers', async () => {
  assert.equal((await request('/api/preferences')).status,401);
  assert.deepEqual((await request('/api/preferences',viewer)).data.navigation,['home','scan','assistant','account']);
  const navigation=['home','ckd','mm','account'];
  assert.equal((await request('/api/preferences',viewer,'POST',{navigation})).status,200);
  assert.deepEqual((await request('/api/preferences',viewer)).data.navigation,navigation);
  assert.deepEqual((await request('/api/preferences',inspector)).data.navigation,['home','scan','assistant','account']);
  const other=db.prepare('SELECT id FROM users WHERE username=?').get('viewer').id;
  await request('/api/preferences',admin,'POST',{navigation:['scan','home','account'],user_id:other});
  assert.deepEqual((await request('/api/preferences',viewer)).data.navigation,navigation,'Caller cannot overwrite another account by passing its ID');
  for(const invalid of [[],['home','scan'],['home','scan','scan'],['home','scan','<script>'],['home','scan','ckd','mm','account','assistant']])assert.equal((await request('/api/preferences',viewer,'POST',{navigation:invalid})).status,400);
  assert.equal((await request('/api/preferences',viewer,'POST',{navigation},{'X-CSRF-Token':'wrong'})).status,403);
});

test('continuous scanning defaults on and partial updates preserve shortcuts and account isolation', async () => {
  assert.equal((await request('/api/preferences',viewer)).data.continuous_scan,true);
  const navigation=(await request('/api/preferences',viewer)).data.navigation;
  const disabled=await request('/api/preferences',viewer,'POST',{continuous_scan:false});
  assert.equal(disabled.status,200);assert.equal(disabled.data.continuous_scan,false);
  assert.deepEqual(disabled.data.navigation,navigation);
  assert.equal((await request('/api/preferences',inspector)).data.continuous_scan,true);
  await request('/api/preferences',viewer,'POST',{navigation});
  assert.equal((await request('/api/preferences',viewer)).data.continuous_scan,false);
  for(const invalid of [0,1,'false',null])assert.equal((await request('/api/preferences',viewer,'POST',{continuous_scan:invalid})).status,400);
  assert.equal((await request('/api/preferences',viewer,'POST',{})).status,400);
  assert.equal((await request('/api/preferences',viewer,'POST',{continuous_scan:true})).data.continuous_scan,true);
});

test('phone scan duplicate checks use all history and recheck atomically before automatic saves', async () => {
  const inspectorId=db.prepare('SELECT id FROM users WHERE username=?').get('inspector').id;
  const insert=db.prepare('INSERT INTO scans(request_id,barcode,mode,user_id) VALUES (?,?,?,?)');
  for (let i=0;i<105;i++) insert.run(randomUUID(),'PHONE-HISTORY','HS',inspectorId);
  const all=await request('/api/scans/check?barcode=phone-history&mode=HS',viewer);
  assert.equal(all.status,200); assert.equal(all.data.count,105); assert.equal(all.data.scope,'server');
  assert.equal((await request('/api/scans/check?barcode=PHONE-HISTORY&mode=Label',viewer)).data.count,0);
  assert.equal((await request('/api/scans/check?barcode=PHONE-HISTORY&mode=HS')).status,401);
  const payload={request_id:randomUUID(),barcode:'PHONE-NEW',mode:'Label',reject_duplicate:true};
  const results=await Promise.all([request('/api/scans',inspector,'POST',payload),request('/api/scans',admin,'POST',{...payload,request_id:randomUUID()})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  assert.equal(results.find(r=>r.status === 409).data.code,'DUPLICATE_SCAN');
  assert.equal(results.find(r=>r.status === 409).data.count,1);
  const forced={...payload,request_id:randomUUID(),reject_duplicate:false};
  const saved=await request('/api/scans',inspector,'POST',forced);
  assert.equal(saved.status,201); assert.equal(saved.data.barcode_count,2);
  const retry=await request('/api/scans',inspector,'POST',forced);
  assert.equal(retry.status,200); assert.equal(retry.data.barcode_count,2);
  assert.equal((await request('/api/scans/check?barcode=PHONE-NEW&mode=wrong',viewer)).status,400);
});

test('export is a real XLSX package and user input is stored as text, not a formula', async () => {
  const res = await fetch(base + '/api/export?kind=scans',{ headers:{ Cookie:viewer.cookie } });
  assert.equal(res.status,200); assert.match(res.headers.get('content-type'),/spreadsheetml/);
  const data = Buffer.from(await res.arrayBuffer()); assert.equal(data.readUInt32LE(0),0x04034b50);
  assert.match(data.toString(),/xl\/worksheets\/sheet1.xml/); assert.match(data.toString(),/BN83-TEST/);
  const hostile = excel([['=HYPERLINK("https://example.com")','<script>&\u0000']]).toString();
  assert.match(hostile,/t="inlineStr"/); assert.doesNotMatch(hostile,/<f>/); assert.match(hostile,/&lt;script&gt;&amp;/); assert.ok(!hostile.includes('\u0000</t>'));
});

test('Stock quantities are shared totals across pages, retries and deletion; HS and Label do not contribute',async()=>{
  const before=(await request('/api/scans',admin)).data;
  const image='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,0,0]).toString('base64');
  const body={request_id:randomUUID(),barcode:'ITEM=A;QTY=40',mode:'Stock',image};
  const created=await request('/api/scans',inspector,'POST',body);assert.equal(created.status,201);
  assert.equal((await request('/api/scans',inspector,'POST',body)).status,200);
  for(const mode of ['HS','Label'])assert.equal((await request('/api/scans',inspector,'POST',{...body,request_id:randomUUID(),mode})).status,201);
  const result=(await request('/api/scans',admin)).data;
  assert.equal(result.total,before.total+3);assert.equal(result.total_quantity,(before.total_quantity??0)+40);assert.equal(result.quantity_count,before.quantity_count+1);
  const row=result.scans.find(r=>r.id===created.data.id);assert.equal(row.quantity,40);assert.equal(row.has_image,1);
  const older=(await request('/api/scans?before='+created.data.id,viewer)).data;assert.equal(older.total_quantity,result.total_quantity);
  const evidence=await request('/api/scans/'+created.data.id+'/image',viewer);assert.equal(evidence.status,200);assert.equal(evidence.headers.get('content-type'),'image/jpeg');
  assert.equal((await request('/api/scans/'+created.data.id,admin,'DELETE')).status,200);
  const after=(await request('/api/scans',admin)).data;assert.equal(after.total_quantity,before.total_quantity);assert.equal(after.quantity_count,before.quantity_count);
});

test('history returns one row when a barcode matches one Samsung code and another ITEM code',async()=>{
  const insert=db.prepare('INSERT INTO materials VALUES (?,?,?,?,?,?,?,?,?)');
  insert.run('CROSS-ITEM-A','CROSS-CODE','Part A','','Maker','','',100,10);
  insert.run('CROSS-CODE','CROSS-SAMSUNG-B','Part B','','Maker','','',100,10);
  const saved=await request('/api/scans',inspector,'POST',{request_id:randomUUID(),barcode:'CROSS-CODE',mode:'HS'});assert.equal(saved.status,201);
  const rows=(await request('/api/scans',viewer)).data.scans.filter(r=>r.id===saved.data.id);
  assert.equal(rows.length,1);assert.equal(rows[0].item_code,'CROSS-ITEM-A');
});

test('mode histories, totals and exports stay separate and reject invalid modes',async()=>{
  for(const mode of ['HS','Stock','Label'])assert.equal((await request('/api/scans',inspector,'POST',{request_id:randomUUID(),barcode:'MODE-ONLY-'+mode.toUpperCase(),mode})).status,201);
  for(const mode of ['HS','Stock','Label']){
    const result=await request('/api/scans?mode='+mode,viewer);assert.equal(result.status,200);assert.ok(result.data.scans.every(r=>r.mode===mode));
    assert.equal(result.data.total,db.prepare('SELECT COUNT(*) n FROM scans WHERE mode=?').get(mode).n);
    const page=await request('/api/scans?mode='+mode+'&before=3',viewer);assert.ok(page.data.scans.every(r=>r.mode===mode&&r.id<3));assert.equal(page.data.total,result.data.total);
    if(mode!=='Stock')assert.equal(result.data.total_quantity,null);
    const file=await fetch(base+'/api/export?kind=scans&mode='+mode,{headers:{Cookie:viewer.cookie}});assert.equal(file.status,200);
    const contents=Buffer.from(await file.arrayBuffer()).toString();assert.ok(contents.includes('MODE-ONLY-'+mode.toUpperCase()));
    for(const other of ['HS','Stock','Label'].filter(m=>m!==mode))assert.ok(!contents.includes('MODE-ONLY-'+other.toUpperCase()));
  }
  assert.equal((await request('/api/scans?mode=wrong',viewer)).status,400);assert.equal((await request('/api/export?kind=scans&mode=wrong',viewer)).status,400);
});

test('HS saves duplicate occurrences with stable results, simultaneous devices and idempotent retry',async()=>{
  const image='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,0,0]).toString('base64');
  const bodies=[{request_id:randomUUID(),barcode:'HS-SAVE-ONE',mode:'HS',reject_duplicate:true,image},{request_id:randomUUID(),barcode:' hs-save-one ',mode:'HS',reject_duplicate:true,image}];
  const results=await Promise.all(bodies.map(body=>request('/api/scans',inspector,'POST',body)));
  assert.deepEqual(results.map(r=>r.status),[201,201]);assert.deepEqual(results.map(r=>r.data.prior_count).sort(),[0,1]);
  for(let i=0;i<2;i++){const retry=await request('/api/scans',inspector,'POST',bodies[i]);assert.equal(retry.status,200);assert.equal(retry.data.id,results[i].data.id);assert.equal(retry.data.is_duplicate,results[i].data.is_duplicate);}
  const third=await request('/api/scans',admin,'POST',{...bodies[0],request_id:randomUUID()});assert.equal(third.status,201);assert.equal(third.data.is_duplicate,true);assert.equal(third.data.prior_count,2);
  const label=await request('/api/scans',inspector,'POST',{...bodies[0],request_id:randomUUID(),mode:'Label'});assert.equal(label.status,201);assert.equal(label.data.is_duplicate,false);
  const history=(await request('/api/scans?mode=HS',viewer)).data.scans.filter(r=>r.barcode==='HS-SAVE-ONE');assert.equal(history.length,3);assert.ok(history.every(r=>r.has_image));
  const original=results.find(r=>r.data.prior_count===0);assert.equal((await request('/api/scans/'+original.data.id,admin,'DELETE')).status,200);
  const remaining=(await request('/api/scans?mode=HS',viewer)).data.scans.filter(r=>r.barcode==='HS-SAVE-ONE');assert.ok(remaining.every(r=>r.prior_count>0));
  const file=await fetch(base+'/api/export?kind=scans&mode=HS',{headers:{Cookie:viewer.cookie}});const bytes=Buffer.from(await file.arrayBuffer());assert.ok(bytes.toString().includes('HS-SAVE-ONE'));
  const report=XLSX.read(bytes,{type:'buffer'}),rows=XLSX.utils.sheet_to_json(report.Sheets[report.SheetNames[0]],{header:1}),head=rows.find(r=>r.includes('STT / ID'));
  assert.ok(head.indexOf('ITEM')<head.indexOf('Barcode'));assert.ok(head.indexOf('Barcode')<head.indexOf('Người quét'));
});

test('Stock resolves MM metadata, snapshots QTY and Lot No, and legacy imports preserve optional columns',async()=>{
  const csv=header+',qty,lot_no\nSTOCK-MATERIAL,MM-STOCK-CODE,Original item,,MAKER-X,VENDOR-X,A1,10000,500,250,LOT-MM';
  assert.equal((await request('/api/materials/import',admin,'POST',{csv})).status,200);
  assert.equal((await request('/api/materials/import',viewer,'POST',{csv})).status,403);
  const body={request_id:randomUUID(),barcode:'MM-STOCK-CODE',mode:'Stock'};
  const created=await request('/api/scans',inspector,'POST',body);assert.equal(created.status,201);
  for(const [key,value] of Object.entries({item_code:'STOCK-MATERIAL',item_name:'Original item',maker:'MAKER-X',vendor:'VENDOR-X',quantity:250,quantity_source:'MM',lot_no:'LOT-MM'}))assert.equal(created.data.stock[key],value,key);
  const legacy=header+'\nSTOCK-MATERIAL,MM-STOCK-CODE,Updated item,,MAKER-Y,VENDOR-Y,A2,9000,400';
  assert.equal((await request('/api/materials/import',admin,'POST',{csv:legacy})).status,200);
  const material=(await request('/api/materials?q=STOCK-MATERIAL',viewer)).data.materials[0];assert.equal(material.qty,250);assert.equal(material.lot_no,'LOT-MM');
  const previous=(await request('/api/scans?mode=Stock',viewer)).data.scans.find(r=>r.id===created.data.id);assert.equal(previous.item_name,'Original item');assert.equal(previous.maker,'MAKER-X');assert.equal(previous.quantity,250);
  const label=await request('/api/scans',inspector,'POST',{request_id:randomUUID(),barcode:'ITEM=STOCK-MATERIAL;QTY=12;LOT_NO=LOT-LABEL',mode:'Stock'});assert.equal(label.status,201);assert.equal(label.data.stock.quantity,12);assert.equal(label.data.stock.quantity_source,'barcode');assert.equal(label.data.stock.item_name,'Updated item');assert.equal(label.data.stock.lot_no,'LOT-LABEL');
  const noMM=await request('/api/scans',inspector,'POST',{request_id:randomUUID(),barcode:'UNKNOWN-MM-STOCK',mode:'Stock'});assert.equal(noMM.data.stock.item_code,null);assert.equal(noMM.data.stock.quantity,null);
  assert.equal((await request('/api/materials/import',admin,'POST',{csv:csv.replace(',250,LOT-MM',',-5,LOT-MM')})).status,400);
  assert.equal((await request('/api/materials?q=STOCK-MATERIAL',viewer)).data.materials[0].qty,250);
});

test('MM recognizes Item NM and Mark headings and permits Vendor when Maker is absent',async()=>{
  const csv='Item Code,Barcode,Item NM,Description,Mark,Vendor,Location,Selling_Qty,MOQ,QTY,Lot No\nALIAS-ITEM,ALIAS-BARCODE,Alias name,,,Vendor only,A1,1000,100,20,ALIAS-LOT';
  assert.equal((await request('/api/materials/import',admin,'POST',{csv})).status,200);
  const scan=await request('/api/scans',inspector,'POST',{request_id:randomUUID(),barcode:'ALIAS-BARCODE',mode:'Stock'});
  assert.equal(scan.status,201);assert.equal(scan.data.stock.item_name,'Alias name');assert.equal(scan.data.stock.vendor,'Vendor only');assert.equal(scan.data.stock.maker,'');assert.equal(scan.data.stock.quantity,20);assert.equal(scan.data.stock.lot_no,'ALIAS-LOT');
});

test('MM Location, Item code and Spec filters search only the selected field',async()=>{
  const save=db.prepare('INSERT INTO materials VALUES (?,?,?,?,?,?,?,?,?)');
  save.run('SCOPED-MM-TOKEN','SCOPE-BAR-A','Item A','Description A','Maker','','Shelf A',1000,100);
  save.run('SCOPE-LOCATION','SCOPE-BAR-B','Item B','Description B','Maker','','SCOPED-MM-TOKEN',1000,100);
  save.run('SCOPE-SPEC','SCOPE-BAR-C','Item C','SCOPED-MM-TOKEN','Maker','','Shelf C',1000,100);
  for(const [field,item] of [['location','SCOPE-LOCATION'],['item_code','SCOPED-MM-TOKEN'],['spec','SCOPE-SPEC']]){
    const result=await request('/api/materials?field='+field+'&q=scoped-mm-token',viewer);assert.equal(result.status,200);assert.equal(result.data.field,field);assert.equal(result.data.matched,1);assert.deepEqual(result.data.materials.map(m=>m.item_code),[item]);
    const all=await request('/api/materials?field='+field,viewer);assert.equal(all.data.matched,all.data.total);
  }
  assert.equal((await request('/api/materials?q=scoped-mm-token',viewer)).data.matched,3);
  for(const field of ['wrong','constructor','__proto__','location) OR 1=1 --'])assert.equal((await request('/api/materials?field='+encodeURIComponent(field),viewer)).status,400);
});

test('MM CSV Spec header maps to description and remains available to Spec lookup',async()=>{
  const csv=header.replace('description','Spec')+'\nSPEC-ALIAS,SPEC-BAR,Resistor,10K 1% 1608,Maker,Vendor,A1,1000,100';
  assert.equal((await request('/api/materials/import',admin,'POST',{csv})).status,200);
  const result=await request('/api/materials?field=spec&q='+encodeURIComponent('10k 1% 1608'),viewer);assert.equal(result.data.materials[0].item_code,'SPEC-ALIAS');assert.equal(result.data.materials[0].description,'10K 1% 1608');
});

test('CKD pair routes enforce authentication, CSRF and roles; history and export retain Description and quantity state',async()=>{
  db.prepare('INSERT INTO materials VALUES (?,?,?,?,?,?,?,?,?)').run('ITEM-PAIR','MM-PAIR','CAP','MM desc','MAKER','V','A1',100,100);
  const w=importCkdWorkbook(db,{models:[{samsung:'BN83-90000A',items:'ITEM-PAIR',item:'CAP',description:'Test description',maker:'MAKER',moq_text:'100',moq:100}],orders:[{samsung:'BN83-90000A',so_no:'1',items:'ITEM-PAIR',selling_code:'ITEM-PAIR',selling_qty:100,so_maker:'MAKER',maker:'MAKER',vendor:'V',type:'Local'}],missing_moq:0},'API test order',1);
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOuIAAAAASUVORK5CYII=';
  const pair={workbook_id:w.id,samsung:'BN83-90000A',item_code:'ITEM-PAIR',request_id:randomUUID(),box_ref:'PAIR-BOX',session_name:'Pair session',images:{samsung:image,item:image}};
  assert.equal((await request('/api/ckd/workbooks')).status,401);
  assert.equal((await request('/api/ckd/pair/check',viewer,'POST',pair)).data.pass,true);
  assert.equal((await request('/api/ckd/pair/save',viewer,'POST',pair)).status,403);
  assert.equal((await request('/api/ckd/pair/save',inspector,'POST',pair,{'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await request('/api/ckd/pair/save',inspector,'POST',pair)).status,201);
  assert.equal((await request('/api/ckd/pair/save',inspector,'POST',pair)).status,200);
  const history=await request('/api/ckd/history?workbook_id='+w.id,viewer);assert.equal(history.data.checks[0].check.quantity_status,'Đủ');assert.equal(history.data.totals[0].total,100);assert.equal(history.data.totals[0].target,100);
  assert.equal(history.data.checks[0].samsung_image,1);assert.equal(history.data.checks[0].item_image,1);assert.equal(history.data.checks[0].check.session_name,'Pair session');
  const photo='/api/ckd/checks/'+history.data.checks[0].id+'/image/samsung';assert.equal((await request(photo)).status,401);
  const photoResponse=await fetch(base+photo,{headers:{Cookie:viewer.cookie}});assert.equal(photoResponse.status,200);assert.equal(photoResponse.headers.get('content-type'),'image/png');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ckd_check_images').get().n,2,'Retry must not duplicate image attachments');
  assert.equal((await request('/api/ckd/pair/save',inspector,'POST',{...pair,request_id:randomUUID(),box_ref:'BAD-IMAGE',images:{samsung:'data:text/html;base64,PHNjcmlwdD4='}})).status,400);
  const exported=await fetch(base+'/api/ckd/export?workbook_id='+w.id,{headers:{Cookie:viewer.cookie}});assert.equal(exported.status,200);const reportBytes=Buffer.from(await exported.arrayBuffer());assert.match(reportBytes.toString(),/Test description/);
  const report=XLSX.read(reportBytes,{type:'buffer',cellDates:true}),detail=report.Sheets['Luot scan'],head=XLSX.utils.sheet_to_json(detail,{header:1})[6];
  for(const column of ['STT','Samsung','ITEM','QTY','Bán đủ / dư / thiếu','Vendor','Ảnh Samsung','Ảnh ITEM','Người scan','Giờ scan (GMT+7)'])assert.ok(head.includes(column),column);
  assert.equal(detail.A8.v,1);assert.equal(detail.D8.v,100);assert.equal(detail.E8.v,'Đủ');assert.equal(detail.F8.v,'V');assert.ok(detail.J8.v instanceof Date);assert.match(reportBytes.toString(),/xl\/media\/report-2-1.png/);assert.ok(!head.includes('Box'));
  const archive=await fetch(base+'/api/ckd/report.zip?workbook_id='+w.id,{headers:{Cookie:viewer.cookie}});assert.equal(archive.status,200);assert.equal(archive.headers.get('content-type'),'application/zip');const zipped=Buffer.from(await archive.arrayBuffer());assert.equal(zipped.readUInt32LE(0),0x04034b50);assert.match(zipped.toString(),/report.xlsx/);assert.match(zipped.toString(),/check-\d+-samsung.png/);assert.match(zipped.toString(),/check-\d+-item.png/);assert.match(zipped.toString(),/SO chua scan/);
  assert.equal((await request('/api/ckd/report.zip?scope=all')).status,401);
  assert.equal((await request('/api/ckd/import',viewer,'POST',{name:'bad.xlsx',file:'invalid'})).status,403);
  assert.equal((await request('/api/ckd/import',inspector,'POST',{name:'bad.xlsx',file:'data:application/octet-stream;base64,YmFk'})).status,400);
});

test('CKD occurrence history paginates without losing or repeating scan rows',async()=>{
  const w=importCkdWorkbook(db,{models:[],orders:[],missing_moq:0},'Pagination fixture',1);
  const insert=db.prepare('INSERT INTO ckd_checks(request_id,workbook_id,box_ref,samsung,item_code,status,qty,counted,snapshot,user_id) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for(let i=0;i<205;i++)insert.run(randomUUID(),w.id,'PAGE-'+i,'SAMSUNG-PAGE','ITEM-PAGE','NG',0,0,JSON.stringify({status:'NG',target:0,total:0}),1);
  const first=(await request('/api/ckd/history?workbook_id='+w.id,viewer)).data;assert.equal(first.checks.length,200);assert.equal(first.count,205);assert.ok(first.next);
  const second=(await request('/api/ckd/history?workbook_id='+w.id+'&before='+first.next,viewer)).data;assert.equal(second.checks.length,5);assert.equal(second.next,null);assert.equal(new Set([...first.checks,...second.checks].map(c=>c.id)).size,205);
});

test('Excel MM import authorizes uploads, imports every sheet atomically and shares decimal Stock quantities',async()=>{
  const wb=XLSX.utils.book_new(),columns=['LOCATION','ITEM CD','ITEM NM','SPEC','BARCODE_NO','QTY','LOT_NO','BP_NM'];
  for(let i=1;i<=3;i++)XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([columns,['SHELF-'+i,'EXCEL-WORKBOOK-ITEM','Excel item '+i,'SPEC-X','EXCEL-BAR-'+i,i+.75,'LOT-'+i,'Vendor']]),'Sheet '+i);
  const body=()=>({name:'synthetic.xlsx',file:'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,'+Buffer.from(XLSX.write(wb,{type:'buffer',bookType:'xlsx'})).toString('base64')});
  assert.equal((await request('/api/materials/import',viewer,'POST',body())).status,403);
  assert.equal((await request('/api/materials/import',admin,'POST',body(),{'X-CSRF-Token':'wrong'})).status,403);
  const result=await request('/api/materials/import',admin,'POST',body());assert.equal(result.status,200);assert.equal(result.data.count,3);assert.deepEqual(result.data.sheets.map(s=>s.rows),[1,1,1]);
  const rows=await request('/api/materials?field=item_code&q=EXCEL-WORKBOOK-ITEM',viewer);assert.equal(rows.data.matched,3);assert.equal(new Set(rows.data.materials.map(r=>r.source_sheet)).size,3);
  assert.equal((await request('/api/stats',viewer)).data.materials,db.prepare('SELECT COUNT(*) n FROM (SELECT item_code FROM materials UNION SELECT item_code FROM mm_inventory)').get().n);
  const scanned=await request('/api/scans',inspector,'POST',{request_id:randomUUID(),barcode:'EXCEL-BAR-3',mode:'Stock'});assert.equal(scanned.status,201);assert.equal(scanned.data.stock.quantity,3.75);assert.equal(scanned.data.stock.lot_no,'LOT-3');assert.equal(scanned.data.stock.vendor,'Vendor');
  const before=db.prepare('SELECT COUNT(*) n FROM mm_inventory').get().n;
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Not MM data']]),'Bad Sheet');
  assert.equal((await request('/api/materials/import',admin,'POST',body())).status,400);assert.equal(db.prepare('SELECT COUNT(*) n FROM mm_inventory').get().n,before);
  assert.equal((await request('/api/materials?offset=-1',viewer)).status,400);
});

test('raw Excel upload validates roles, CSRF, MIME and filename and imports all sheets',async()=>{
  const wb=XLSX.utils.book_new(),columns=['LOCATION','ITEM CD','ITEM NM','SPEC','BARCODE_NO','QTY'];
  for(let i=1;i<=3;i++)XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([columns,['A1','RAW-ITEM','Raw item','Spec','RAW-BAR-'+i,2.5]]),'Sheet '+i);
  const bytes=Buffer.from(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}));
  const upload=(session,extra={},body=bytes)=>fetch(base+'/api/materials/import-file',{method:'POST',headers:{Cookie:session.cookie,'X-CSRF-Token':session.csrf,'Content-Type':'application/octet-stream','X-MM-File-Name':encodeURIComponent('MM sample.xlsx'),...extra},body});
  assert.equal((await upload(viewer)).status,403);assert.equal((await upload(admin,{'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await upload(admin,{'Content-Type':'application/json'})).status,415);assert.equal((await upload(admin,{'X-MM-File-Name':'%invalid'})).status,400);
  assert.equal((await upload(admin,{},Buffer.alloc(0))).status,400);
  const response=await upload(admin);assert.equal(response.status,200);const result=await response.json();assert.equal(result.count,3);assert.deepEqual(result.sheets.map(s=>s.rows),[1,1,1]);
});

test('raw MM upload remains open beyond the previous 30-second request deadline',{timeout:45000},async()=>{
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['LOCATION','ITEM CD','ITEM NM','SPEC','BARCODE_NO','QTY'],['A1','SLOW-ITEM','Slow item','Spec','SLOW-BAR',1.5]]),'MM');
  const bytes=Buffer.from(XLSX.write(wb,{type:'buffer',bookType:'xlsx'})),size=Math.ceil(bytes.length/33);
  const result=await new Promise((resolve,reject)=>{
    let offset=0,timer;const req=httpRequest(base+'/api/materials/import-file',{method:'POST',headers:{Cookie:admin.cookie,'X-CSRF-Token':admin.csrf,'Content-Type':'application/octet-stream','X-MM-File-Name':'slow.xlsx','Content-Length':bytes.length}},res=>{
      let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body}));res.on('error',reject);
    });
    req.on('error',reject);req.on('close',()=>clearInterval(timer));
    timer=setInterval(()=>{req.write(bytes.subarray(offset,offset+size));offset+=size;if(offset>=bytes.length){clearInterval(timer);req.end();}},1000);
  });
  assert.equal(result.status,200);assert.equal(JSON.parse(result.body).count,1);
});

test('cutting conversion import, role boundaries, exact pairs, evidence and separate history',async()=>{
 const ws=XLSX.utils.aoa_to_sheet([['Model Code','MI 1st','AI 1st','MI 2nd','AI 2nd'],['MODEL-TEST','MI-TEST-1','AI-TEST-1','MI-TEST-2','AI-TEST-2']]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Pairs');const bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
 assert.equal((await request('/api/cutting/status')).status,401);
 assert.equal((await request('/api/cutting/scans',viewer,'POST',{request_id:randomUUID(),code:'AI-TEST-1'})).status,403);
 const upload=async session=>{const res=await fetch(base+'/api/cutting/import-file',{method:'POST',headers:{Cookie:session.cookie,'X-CSRF-Token':session.csrf,'Content-Type':'application/octet-stream','X-MM-File-Name':'fixture.xlsx'},body:bytes});return {status:res.status,data:await res.json()};};
 assert.equal((await upload(inspector)).status,403);const imported=await upload(admin);assert.equal(imported.status,201);assert.equal(imported.data.pairs,2);
 const lookup=await request('/api/cutting/lookup?code=AI-TEST-2',viewer);assert.equal(lookup.status,200);assert.equal(lookup.data.matches[0].target_code,'MI-TEST-2');assert.equal(lookup.data.matches[0].variant,2);
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH3sAAAAASUVORK5CYII=';
 const body={request_id:randomUUID(),code:'MI-TEST-1',image};const saved=await request('/api/cutting/scans',inspector,'POST',body);assert.equal(saved.status,201);assert.equal(saved.data.matches[0].target_code,'AI-TEST-1');
 assert.equal((await request('/api/cutting/scans',inspector,'POST',body)).data.id,saved.data.id);assert.equal((await request('/api/cutting/scans',admin,'POST',body)).status,409);
 const hist=await request('/api/cutting/scans',viewer);assert.equal(hist.data.total,1);assert.equal(hist.data.scans[0].scanner,'inspector');
 assert.equal((await request('/api/cutting/scans/'+saved.data.id,viewer)).data.matches[0].target_code,'AI-TEST-1');
 assert.equal((await request('/api/cutting/scans/'+saved.data.id+'/image')).status,401);assert.equal((await request('/api/cutting/scans/'+saved.data.id+'/image',viewer)).status,200);
 assert.equal((await request('/cutting.js')).status,200);assert.equal((await request('/cutting.css')).status,200);
});

test('HS canonical codes share duplicate counts while raw labels, other modes and request retries retain evidence',async()=>{
  const a={request_id:randomUUID(),mode:'HS',barcode:'0837770049AA-261113-4981-000100'};
  const first=await request('/api/scans',inspector,'POST',a);assert.equal(first.status,201);assert.equal(first.data.is_duplicate,false);
  const second=await request('/api/scans',inspector,'POST',{...a,request_id:randomUUID(),barcode:'0837770049AA2611144981000200'});assert.equal(second.status,201);assert.equal(second.data.is_duplicate,true);
  assert.equal((await request('/api/scans',inspector,'POST',a)).status,200);
  const check=await request('/api/scans/check?mode=HS&barcode='+encodeURIComponent(a.barcode),viewer);assert.equal(check.data.barcode,'0837770049AA');assert.equal(check.data.count,2);
  const rows=(await request('/api/scans?mode=HS',viewer)).data.scans.filter(r=>r.barcode==='0837770049AA');assert.equal(rows.length,2);assert.equal(rows.find(r=>r.id===first.data.id).raw_barcode,a.barcode);
  for(const mode of ['Stock','Label']){const result=await request('/api/scans',inspector,'POST',{...a,mode,request_id:randomUUID()});assert.equal(result.status,201);assert.equal(db.prepare('SELECT barcode FROM scans WHERE id=?').get(result.data.id).barcode,a.barcode);}
});

test('password change invalidates all sessions and logout invalidates a session immediately', async () => {
  const old = await login('viewer');
  assert.equal((await request('/api/password',viewer,'POST',{ oldPassword:password,password:'another-test-password-2026' })).status,200);
  assert.equal((await request('/api/scans',old)).status,401);
  assert.equal((await request('/api/logout',inspector,'POST')).status,200);
  assert.equal((await request('/api/scans',inspector)).status,401);
});

test('account creation and password changes accept exactly eight characters and reject seven', async () => {
  const user = { username:'password-boundary',name:'Password boundary',role:'viewer',password:'Eight!pw' };
  assert.equal((await request('/api/users',admin,'POST',{ ...user,password:'Seven!p' })).status,400);
  assert.equal((await request('/api/users',admin,'POST',user)).status,201);
  const loggedIn = await request('/api/login',null,'POST',{ username:user.username,password:user.password });
  assert.equal(loggedIn.status,200);
  const s = { cookie:loggedIn.headers.get('set-cookie').split(';')[0],csrf:loggedIn.data.csrf };
  assert.equal((await request('/api/password',s,'POST',{ oldPassword:user.password,password:'Seven!p' })).status,400);
  assert.equal((await request('/api/password',s,'POST',{ oldPassword:user.password,password:'New!pw88' })).status,200);
  assert.equal((await request('/api/login',null,'POST',{ username:user.username,password:'New!pw88' })).status,200);
});

test('failed-login throttling limits repeated guesses without leaking account existence', async () => {
  for (let i = 0; i < 8; i++) assert.equal((await request('/api/login',null,'POST',{ username:'not-a-user',password:'wrong-password-2026' })).status,401);
  assert.equal((await request('/api/login',null,'POST',{ username:'not-a-user',password:'wrong-password-2026' })).status,429);
});

test('rejects malformed CSV and persists records after reopening a disk database', () => {
  assert.throws(() => parseCSV('a,b\n"unfinished'),/nháy/);
  assert.deepEqual(parseCSV('a,b\r\n"hello\nworld","say ""yes"""'),[['a','b'],['hello\nworld','say "yes"']]);
  const dir = mkdtempSync(join(tmpdir(),'work-area-test-'));
  try {
    const path = join(dir,'db.sqlite'); const first = openDatabase(path);
    first.prepare('INSERT INTO users(username,name,password,role) VALUES (?,?,?,?)').run('durable','Stored name','not-a-login-password','viewer');
    first.prepare('INSERT INTO user_preferences(user_id,navigation,continuous_scan) VALUES (?,?,0)').run(1,JSON.stringify(['scan','home','account']));first.close();
    const second = openDatabase(path); assert.equal(second.prepare('SELECT name FROM users').get().name,'Stored name');assert.deepEqual(JSON.parse(second.prepare('SELECT navigation FROM user_preferences WHERE user_id=1').get().navigation),['scan','home','account']);second.close();
    const third=openDatabase(path);assert.equal(third.prepare('SELECT continuous_scan FROM user_preferences WHERE user_id=1').get().continuous_scan,0);
    third.exec('ALTER TABLE user_preferences DROP COLUMN continuous_scan');third.close();
    const migrated=openDatabase(path);const pref=migrated.prepare('SELECT * FROM user_preferences WHERE user_id=1').get();assert.equal(pref.continuous_scan,1);assert.deepEqual(JSON.parse(pref.navigation),['scan','home','account']);migrated.close();
  } finally { rmSync(dir,{ recursive:true,force:true }); }
});

test('production refuses HTTP origin and sets Secure cookies when configured for HTTPS', async () => {
  await assert.rejects(() => createApp({ db,production:true,origin:'http://bad.example' }),/APP_ORIGIN/);
  const prod = await createApp({ db,production:true,origin:'https://work-area.example' });
  await new Promise(resolve => prod.listen(0,'127.0.0.1',resolve));
  try {
    const res = await fetch('http://127.0.0.1:' + prod.address().port + '/api/login',{ method:'POST',headers:{ 'Content-Type':'application/json',Origin:'https://work-area.example' },body:JSON.stringify({ username:'admin',password }) });
    assert.equal(res.status,200); assert.match(res.headers.get('set-cookie'),/; Secure/);
  } finally { prod.closeAllConnections(); await new Promise(resolve => prod.close(resolve)); }
});
