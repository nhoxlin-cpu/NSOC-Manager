import {test} from 'node:test';
import assert from 'node:assert/strict';
import XLSX from '../lib/vendor/sheetjs-0.20.3.cjs';
import {reportWorkbook} from '../lib/formats.mjs';
import {renderReportSheet,reportStyles} from '../lib/report-layout.mjs';

const rows=[['ID','ITEM','Description','Số lượng','Kết quả','Thời gian UTC'],[1,'000123','Điện trở 10K, ±1%',1250.75,'PASS','2026-11-13 09:45:00'],[2,'=HYPERLINK("bad")','A&B <test>',0,'NG','2026-11-13 10:00:00']];
const meta={title:'BÁO CÁO KIỂM TRA',scope:'Dữ liệu minh họa',exportedBy:'QA',generatedAt:new Date('2026-11-13T10:15:00Z')};
test('formatted reports preserve identifiers, decimals and safe text and convert timestamps to GMT+7',()=>{
  const bytes=reportWorkbook([{name:'Chi tiết',rows}],meta),book=XLSX.read(bytes,{type:'buffer',cellStyles:true,cellDates:true});
  const sheet=book.Sheets['Chi tiết'];assert.equal(sheet.B8.v,'000123');assert.equal(sheet.B8.t,'s');assert.equal(sheet.D8.v,1250.75);assert.equal(sheet.B9.v,'=HYPERLINK("bad")');assert.equal(sheet.B9.t,'s');assert.ok(!sheet.B9.f);
  assert.equal(sheet.F7.v,'Thời gian (GMT+7)');assert.equal(sheet.F8.v.toISOString(),'2026-11-13T16:45:00.000Z');assert.match(sheet.A4.v,/QA/);assert.match(sheet.A2.v,/BÁO CÁO/);
});
test('reports have print layout, frozen headings, filters, alternating rows and status styles',()=>{
  const sheet=renderReportSheet({name:'Chi tiết',rows},0,meta).xml;
  for(const pattern of [/ySplit="7"/,/xSplit="2"/,/showGridLines="0"/,/autoFilter ref="A7:F9"/,/orientation="landscape"/,/pageMargins/,/Trang &amp;P/,/mergeCell ref="A2:F2"/,/s="10"/,/s="11"/,/customWidth="1"/])assert.match(sheet,pattern);
  assert.match(reportStyles,/#,##0/);assert.match(reportStyles,/dd\/mm\/yyyy hh:mm/);
  const book=reportWorkbook([{name:'Chi tiết',rows}],meta).toString();assert.match(book,/_xlnm.Print_Titles/);assert.match(book,/docProps\/core.xml/);assert.match(book,/xl\/styles.xml/);
});
test('empty sheets stay present and photo links only point to safe relative ZIP paths',()=>{
  const empty=reportWorkbook([{name:'Tổng quan',rows:[['Nội dung','Giá trị']]}],meta);assert.match(empty.toString(),/Chưa có dữ liệu/);
  const result=renderReportSheet({name:'Ảnh',rows:[['ID','Ảnh Samsung','Ảnh ITEM'],[1,'images/SO-1/check-1-samsung.jpg','images/../../unsafe.jpg']]},0,{...meta,imageLinks:true});assert.match(result.relations,/images\/SO-1\/check-1-samsung.jpg/);assert.doesNotMatch(result.relations,/unsafe/);assert.match(result.xml,/Mở ảnh/);
});
