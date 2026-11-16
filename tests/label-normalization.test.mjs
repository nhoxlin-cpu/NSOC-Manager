import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../lib/db.mjs';
import {businessApi} from '../lib/offline-business.mjs';
import {normalizeLabelHistory} from '../lib/label-normalization.mjs';
const base='3324250653AX',long=base+'-2639-260929-0006-000:000003024';
function fixture(){const db=openDatabase(':memory:');db.prepare("INSERT INTO users(id,username,name,password,role) VALUES (1,'test','Test','hash','inspector')").run();return db;}
test('Label compares the main code, retains original data, retries idempotently and leaves Stock barcode identity unchanged',()=>{
 const db=fixture(),user={id:1,role:'inspector'};try{
  const body={request_id:randomUUID(),barcode:long,mode:'Label',reject_duplicate:true};
  const first=businessApi(db,user,'/scans',{method:'POST',data:body});
  assert.equal(businessApi(db,user,'/scans/check?mode=Label&barcode='+base).count,1);
  assert.equal(businessApi(db,user,'/scans/check?mode=Label&barcode='+encodeURIComponent(long)).count,1);
  assert.equal(businessApi(db,user,'/scans',{method:'POST',data:body}).id,first.id);
  assert.throws(()=>businessApi(db,user,'/scans',{method:'POST',data:{...body,request_id:randomUUID(),barcode:base}}),/tồn tại/);
  const second=businessApi(db,user,'/scans',{method:'POST',data:{...body,request_id:randomUUID(),barcode:base,reject_duplicate:false}});assert.equal(second.prior_count,1);
  const rows=db.prepare("SELECT barcode,raw_barcode FROM scans WHERE mode='Label' ORDER BY id").all();assert.equal(rows.length,2);assert.equal(rows[0].barcode,base);assert.equal(rows[0].raw_barcode,long);assert.equal(rows[1].raw_barcode,base);
  for(const barcode of [base,long])businessApi(db,user,'/scans',{method:'POST',data:{request_id:randomUUID(),barcode,mode:'Stock'}});
  assert.equal(db.prepare("SELECT COUNT(DISTINCT barcode) n FROM scans WHERE mode='Stock'").get().n,2);
 }finally{db.close();}
});
test('legacy Label normalization preserves every occurrence, request ID, image and original label',()=>{
 const db=fixture();try{
  for(const barcode of [base,long])db.prepare("INSERT INTO scans(request_id,barcode,mode,user_id,image_type,image) VALUES (?,?,'Label',1,'image/png',?)").run(randomUUID(),barcode,Buffer.from('evidence'));
  const old=db.prepare('SELECT id,request_id,image,barcode FROM scans ORDER BY id').all();normalizeLabelHistory(db);normalizeLabelHistory(db);
  const rows=db.prepare('SELECT * FROM scans ORDER BY id').all();assert.equal(rows.length,2);
  for(let i=0;i<rows.length;i++){assert.equal(rows[i].id,old[i].id);assert.equal(rows[i].request_id,old[i].request_id);assert.deepEqual(rows[i].image,old[i].image);assert.equal(rows[i].raw_barcode,old[i].barcode);assert.equal(rows[i].barcode,base);}
 }finally{db.close();}
});
