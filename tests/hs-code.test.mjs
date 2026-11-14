import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {hsCode} from '../public/hs-code.js';
import {openDatabase} from '../lib/db.mjs';
test('HS extracts the code before the dash and preserves leading zeroes and letter suffixes',()=>{
  for(const suffix of ['AA','NF','AF','AB','ABC','XYZ']){const code='0837770049'+suffix;assert.equal(hsCode(code+'-261113-4981-000100'),code);assert.equal(hsCode(' '+code.toLowerCase()+' '),code);assert.equal(hsCode(code+'2611134981000100'),code);}
  assert.equal(hsCode('0837770049AA–261113'),'0837770049AA');
  for(const legacy of ['HS-SAVE-ONE','MODE-ONLY-HS','BN83-27639A'])assert.equal(hsCode(legacy),legacy);
});
test('legacy HS rows keep raw evidence, images and original comparison results while canonical codes become searchable',()=>{
  const dir=mkdtempSync(join(tmpdir(),'work-area-hs-code-'));
  try{const path=join(dir,'data.sqlite');let db=openDatabase(path);db.exec('ALTER TABLE scans DROP COLUMN raw_barcode');db.prepare('INSERT INTO users(username,name,password,role) VALUES (?,?,?,?)').run('legacy','Legacy','hash','admin');
    const insert=db.prepare('INSERT INTO scans(request_id,barcode,mode,user_id,image_type,image,prior_count) VALUES (?,?,?,1,?,?,?)');
    insert.run('hs-code-legacy-1','0837770049AA-261113-1','HS','image/jpeg',Buffer.from([255,216,255]),0);insert.run('hs-code-legacy-2','0837770049AA-261113-2','HS',null,null,1);insert.run('hs-code-legacy-3','0837770049AA-261113-1','Stock',null,null,0);db.close();
    db=openDatabase(path);const rows=db.prepare('SELECT * FROM scans ORDER BY id').all();assert.deepEqual(rows.map(r=>r.barcode),['0837770049AA','0837770049AA','0837770049AA-261113-1']);assert.equal(rows[0].raw_barcode,'0837770049AA-261113-1');assert.ok(rows[0].image);assert.deepEqual(rows.map(r=>r.prior_count),[0,1,0]);db.close();
    db=openDatabase(path);assert.equal(db.prepare('SELECT raw_barcode FROM scans WHERE id=1').get().raw_barcode,'0837770049AA-261113-1');db.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});
