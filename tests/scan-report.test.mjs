import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../lib/db.mjs';
import {scanReport} from '../lib/scan-report.mjs';
import XLSX from '../lib/vendor/sheetjs-0.20.3.cjs';
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOuIAAAAASUVORK5CYII=','base64');
test('all scan exports are reports with scope, overview, STT, GMT+7 and correctly linked photos',()=>{
 const db=openDatabase(':memory:');try{db.prepare("INSERT INTO users(username,name,password,role) VALUES('qa','Report QA','unused','admin')").run();
 const insert=db.prepare('INSERT INTO scans(request_id,barcode,mode,user_id,quantity,image_type,image,created_at,prior_count) VALUES (?,?,?,1,?,?,?,?,?)');
 for(const mode of ['HS','Stock','Label'])insert.run(randomUUID(),mode==='Label'?'=SUM(A1:A2)':'REPORT-'+mode,mode,mode==='Stock'?1.234567:null,'image/png',image,'2026-11-14 01:00:00',mode==='HS'?1:0);
 const select="SELECT *, '000123' item_code,'Test item' item_name,'Report QA' scanner,'Vendor' vendor,'Maker' maker,'001' lot_no,(image IS NOT NULL) has_image FROM scans";
 for(const mode of ['HS','Stock','Label',null]){
   const rows=db.prepare(select+' WHERE (? IS NULL OR mode=?) ORDER BY id DESC').all(mode,mode),bytes=scanReport(db,rows,mode,{name:'Report QA'}),book=XLSX.read(bytes,{type:'buffer',cellDates:true});assert.equal(book.SheetNames[0],'Tổng quan');assert.ok(book.Sheets['Chi tiết']);
   const detail=book.Sheets['Chi tiết'];assert.equal(detail.A7.v,'STT');assert.equal(detail.A8.v,1);assert.match(detail.A4.v,/Report QA/);assert.match(detail.A4.v,/GMT\+7/);assert.match(detail.A1.v,/HANSOL/);assert.equal(detail[mode==='HS'?'F8':'E8'].v.toISOString(),'2026-11-14T08:00:00.000Z');assert.equal(detail[mode==='HS'?'B8':'F8'].v,'000123');assert.ok(bytes.includes(image));
   assert.match(bytes.toString(),/oneCellAnchor/);assert.match(bytes.toString(),/Print_Titles/);
   if(mode==='Stock'){assert.deepEqual(book.SheetNames,['Tổng quan','Total theo ITEM','Chi tiết']);assert.equal(detail.H8.v,1.234567);assert.equal(book.Sheets['Total theo ITEM'].G8.v,1.234567);}
   if(mode==='Label'){assert.equal(detail.B8.t,'s');assert.equal(detail.B8.v,'=SUM(A1:A2)');assert.equal(detail.B8.f,undefined);}
 }
 }finally{db.close();}
});
test('empty scan reports retain overview and a clear no-data detail sheet',()=>{
 const db=openDatabase(':memory:');try{const book=XLSX.read(scanReport(db,[],'Stock',{name:'QA'}),{type:'buffer'});assert.deepEqual(book.SheetNames,['Tổng quan','Total theo ITEM','Chi tiết']);assert.match(book.Sheets['Chi tiết'].A8.v,/Chưa có dữ liệu/);}finally{db.close();}
});
