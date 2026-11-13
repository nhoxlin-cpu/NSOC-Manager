import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../lib/db.mjs';
import { scanQuantity } from '../lib/scan-quantity.mjs';

test('only Stock with one explicit integer QTY contributes to quantity totals',()=>{
  for(const [code,expected] of [['ITEM=ABC;QTY=250',250],['ABC | quantity: 12',12],['QTY=1000000000',1000000000],['ABC123456',null],['QTY=10;QTY=20',null],['QTY=-1',null],['QTY=0',null],['QTY=1.5',null],['QTY=1,000',null],['QTY=1000000001',null],['NOTQTY=10',null]]){
    assert.equal(scanQuantity(code,'Stock'),expected,code);
    assert.equal(scanQuantity(code,'HS'),null);
    assert.equal(scanQuantity(code,'Label'),null);
  }
  assert.equal(scanQuantity('QTY=-1; QTY=2','Stock'),null);
});

test('legacy scans gain Stock QTY once without changing saved evidence or non-Stock scans',()=>{
  const dir=mkdtempSync(join(tmpdir(),'work-area-qty-'));
  try{
    const path=join(dir,'legacy.sqlite');let db=openDatabase(path);
    db.exec('ALTER TABLE scans DROP COLUMN quantity');
    db.prepare('INSERT INTO users(username,name,password,role) VALUES (?,?,?,?)').run('legacy','Legacy','hash','admin');
    const save=db.prepare('INSERT INTO scans(request_id,barcode,mode,user_id,image_type,image) VALUES (?,?,?,1,?,?)');
    for(const mode of ['Stock','HS','Label'])save.run('legacy-request-'+mode,'ITEM=A;QTY=25',mode,'image/jpeg',Buffer.from([255,216,255]));
    db.close();db=openDatabase(path);
    assert.deepEqual(db.prepare('SELECT quantity FROM scans ORDER BY id').all().map(r=>r.quantity),[25,null,null]);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM scans WHERE image IS NOT NULL').get().n,3);
    db.close();db=openDatabase(path);
    assert.equal(db.prepare('SELECT SUM(quantity) n FROM scans').get().n,25);db.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});
