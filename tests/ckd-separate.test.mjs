import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import XLSX from '../lib/vendor/sheetjs-0.20.3.cjs';
import {openDatabase} from '../lib/db.mjs';
import {businessApi} from '../lib/offline-business.mjs';
import {initCkd,parseCkdWorkbook,importCkdWorkbook,checkCkd,saveCkd,ckdOverview} from '../lib/ckd.mjs';
const model=[['MATERIAL CODE','HS CODE','','ITEM','DESCRIPTION','MAKER','MOQ'],['BN83-25406A','217010252QTD','','RES-CHIP','1K ohm','YAGEO',5000]];
const so=[['','BN CODE','','','','','SO Maker','SELLING CODE','Selling Qty'],['','BN83-25406A','SO-1','217010252QTD','','','YAGEO','217010252QTD',10000]];
function file(sheets){const wb=XLSX.utils.book_new();for(const [name,rows]of sheets)XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),name);return Buffer.from(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}));}
test('SO and model list parse independently in one sheet and combined workbooks remain compatible',()=>{
 const models=parseCkdWorkbook(file([['Models',model]]),'models');assert.equal(models.models.length,1);assert.equal(models.orders.length,0);assert.equal(models.models[0].description,'1K ohm');
 const orders=parseCkdWorkbook(file([['SO',so]]),'so');assert.equal(orders.orders.length,1);assert.equal(orders.models.length,0);
 assert.throws(()=>parseCkdWorkbook(file([['Models',model]]),'so'),/SO/);assert.throws(()=>parseCkdWorkbook(file([['SO',so]]),'models'),/model/);
 const combined=parseCkdWorkbook(file([['SO',so],['Models',model]]));assert.equal(combined.orders.length,1);assert.equal(combined.models.length,1);
});
test('independent catalog is shared across SOs, selected catalog controls NG hints and saved checks keep their original model snapshot',()=>{
 const db=openDatabase(':memory:');try{
  initCkd(db);db.prepare("INSERT INTO users(id,username,name,password,role) VALUES (1,'test','Test','hash','inspector')").run();db.prepare("INSERT INTO materials VALUES ('217010252QTD','MM-217010252QTD','RES-CHIP','Description','YAGEO','Vendor','A1',10000,5000)").run();
  const catalog=importCkdWorkbook(db,parseCkdWorkbook(file([['Models',model]]),'models'),'Models',1);
  const first=importCkdWorkbook(db,parseCkdWorkbook(file([['SO',so]]),'so'),'SO A',1),second=importCkdWorkbook(db,parseCkdWorkbook(file([['SO',so]]),'so'),'SO B',1);
  const body={workbook_id:first.id,model_workbook_id:catalog.id,samsung:'BN83-25406A',item_code:'217010252QTD'};
  assert.equal(businessApi(db,{id:1,role:'inspector'},'/ckd/pair/check',{method:'POST',data:body}).pass,true);
  assert.equal(checkCkd(db,body).pass,true);const saved=saveCkd(db,{...body,request_id:randomUUID()},1);assert.equal(saved.check.model_workbook_id,catalog.id);assert.equal(saved.check.qty,5000);
  assert.equal(checkCkd(db,{...body,workbook_id:second.id}).total,0);assert.equal(ckdOverview(db,first.id).summary[0].total,5000);
  const other=[...model.slice(0,1),['BN83-25406A','OTHER-ITEM','','Other','Other description','YAGEO',1000]];
  const wrong=importCkdWorkbook(db,parseCkdWorkbook(file([['Other',other]]),'models'),'Other Models',1);
  const ng=checkCkd(db,{...body,model_workbook_id:wrong.id});assert.equal(ng.pass,false);assert.deepEqual(ng.expected_codes.items,['OTHER-ITEM']);
  assert.equal(JSON.parse(db.prepare('SELECT snapshot FROM ckd_checks WHERE id=?').get(saved.id).snapshot).model.description,'1K ohm');
  assert.throws(()=>checkCkd(db,{...body,workbook_id:catalog.id}),/SO/);assert.throws(()=>checkCkd(db,{...body,model_workbook_id:second.id}),/model list/);
 }finally{db.close();}
});
