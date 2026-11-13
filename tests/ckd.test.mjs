import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../lib/db.mjs';
import { initCkd,parseCkdWorkbook,importCkdWorkbook,checkCkd,saveCkd } from '../lib/ckd.mjs';
import { readWorkbook } from '../lib/xlsx-read.mjs';
import { excel } from '../lib/formats.mjs';

function fixture(){
  const db=openDatabase(':memory:');initCkd(db);db.prepare('INSERT INTO users(username,name,password,role) VALUES (?,?,?,?)').run('fixture','Fixture','unused','admin');
  const models=[{samsung:'BN83-12345A',items:'ITEM-A/ITEM-B',item:'RES-CHIP',description:'1M ohm, +/-1%, 1608',maker:'YAGEO/WALSIN',moq_text:'5000',moq:5000}];
  const order={samsung:'BN83-12345A',so_no:'1',items:'ITEM-A/ITEM-B',selling_code:'ITEM-A',selling_qty:6000,so_maker:'YAGEO/WALSIN',maker:'YAGEO',vendor:'Supplier',type:'Local'};
  const parsed={models,orders:[order,{...order,so_no:'2',selling_code:'ITEM-B',selling_qty:4000}],missing_moq:0};
  const imported=importCkdWorkbook(db,parsed,'Synthetic order',1);
  const pair={workbook_id:imported.id,samsung:'bn83-12345a',item_code:'ITEM-A'};
  const save=overrides=>saveCkd(db,{...pair,request_id:randomUUID(),box_ref:randomUUID(),...overrides},1);
  return {db,pair,save,parsed};
}
test('CKD checks Samsung and ITEM against model and selling codes; uses Description and MOQ',()=>{
  const {db,pair}=fixture();try{
    const r=checkCkd(db,pair);assert.equal(r.pass,true);assert.equal(r.qty,5000);assert.equal(r.target,10000);assert.equal(r.model.description,'1M ohm, +/-1%, 1608');assert.equal(r.quantity_status,'Thiếu');
    assert.equal(checkCkd(db,{...pair,samsung:'BN83-12345ABN832611110000'}).pass,true);
    for(const b of [{samsung:'MISSING'},{item_code:'ITEM-OTHER'}])assert.equal(checkCkd(db,{...pair,...b}).status,'NG');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM ckd_checks').get().n,0);
    db.prepare("UPDATE ckd_orders SET maker='WRONG'").run();assert.equal(checkCkd(db,pair).status,'NG');
  }finally{db.close();}
});
test('multiple ITEM codes and boxes add to the same Samsung SO; labels show thiếu, đủ and dư',()=>{
  const {db,pair,save}=fixture();try{
    assert.equal(save().check.quantity_status,'Thiếu');
    assert.equal(save({item_code:'ITEM-B'}).check.quantity_status,'Đủ');
    assert.throws(()=>save(),/Vượt/);
    const over=save({accept_over:true});assert.equal(over.check.quantity_status,'Dư');assert.equal(over.check.after,15000);
    const other=importCkdWorkbook(db,fixtureData(),'Other order',1);assert.equal(checkCkd(db,{...pair,workbook_id:other.id}).total,0);
  }finally{db.close();}
});
function fixtureData(){return {models:[{samsung:'BN83-12345A',items:'ITEM-A',item:'R',description:'D',maker:'YAGEO',moq_text:'5000',moq:5000}],orders:[{samsung:'BN83-12345A',so_no:'1',items:'ITEM-A',selling_code:'ITEM-A',selling_qty:10000,so_maker:'YAGEO',maker:'YAGEO',vendor:'V',type:'Local'}],missing_moq:0};}
test('NG is saved only on explicit choice and never counts; duplicate box and request cannot add twice',()=>{
  const {db,pair,save}=fixture();try{
    assert.throws(()=>save({item_code:'WRONG'}),/NG/);
    const ng=save({item_code:'WRONG',accept_ng:true});assert.equal(ng.check.status,'NG');assert.equal(checkCkd(db,pair).total,0);
    const id=randomUUID(),box='BOX-UNIQUE';save({request_id:id,box_ref:box});assert.equal(save({request_id:id,box_ref:box}).duplicate,true);
    assert.throws(()=>save({box_ref:box}),/đã được lưu/);assert.equal(checkCkd(db,pair).total,5000);
  }finally{db.close();}
});
test('ambiguous MOQ requires explicit integer quantity and missing SO or maker never passes',()=>{
  const {db,pair,save}=fixture();try{
    db.prepare("UPDATE ckd_models SET moq=NULL,moq_text='1st:1500 / 2nd:2000'").run();assert.equal(checkCkd(db,pair).needs_qty,true);assert.throws(()=>save(),/MOQ/);
    assert.equal(save({qty:1500}).check.qty,1500);assert.throws(()=>save({qty:'1.5'}),/số nguyên/);
    db.prepare('DELETE FROM ckd_orders').run();assert.equal(checkCkd(db,pair).pass,false);
  }finally{db.close();}
});
test('XLSX reader handles inline text safely and rejects malformed or oversized input',()=>{
  const rows=readWorkbook(excel([['Description','A&B <value>'],['00123',5000]]));assert.deepEqual(rows[0].rows,[{A:'Description',B:'A&B <value>'},{A:'00123',B:'5000'}]);
  assert.throws(()=>parseCkdWorkbook(excel([['Not an SO']])));
  for(const bytes of [Buffer.alloc(0),Buffer.from('not excel'),Buffer.alloc(19*1024*1024)])assert.throws(()=>readWorkbook(bytes));
});
