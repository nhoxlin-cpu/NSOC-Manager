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
before(async () => {
  db = openDatabase(':memory:'); const hash = await hashPassword(password);
  for (const role of ['admin','inspector','viewer']) db.prepare('INSERT INTO users(username,name,password,role) VALUES (?,?,?,?)').run(role, role, hash, role);
  server = await createApp({ db, origin:'http://work-area.test', production:false });
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
    first.prepare('INSERT INTO user_preferences(user_id,navigation) VALUES (?,?)').run(1,JSON.stringify(['scan','home','account']));first.close();
    const second = openDatabase(path); assert.equal(second.prepare('SELECT name FROM users').get().name,'Stored name');assert.deepEqual(JSON.parse(second.prepare('SELECT navigation FROM user_preferences WHERE user_id=1').get().navigation),['scan','home','account']);second.close();
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
