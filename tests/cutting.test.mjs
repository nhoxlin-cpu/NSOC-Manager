import {test} from 'node:test';
import assert from 'node:assert/strict';
import XLSX from '../lib/vendor/sheetjs-0.20.3.cjs';
import {parseCuttingWorkbook,parseCuttingInWorker} from '../lib/cutting-workbook.mjs';
import {openDatabase} from '../lib/db.mjs';
import {importCutting,lookupCutting,saveCuttingScan} from '../lib/cutting-data.mjs';
const header=['Model Code','Model Name','MI 1st','AI 1st','MI 2nd','AI 2nd','Item Name','Maker 1st','Maker 2nd','BOM QTY','Location'];
const rows=[header,['MODEL-A','Display','MI-A','AI-A','MI-B','AI-B','Cap','Maker-A','Maker-B',1.5,'C1,C2']];
function bytes(sheets,type='xlsx'){const wb=XLSX.utils.book_new();for(const [name,data]of sheets)XLSX.utils.book_append_sheet(wb,Array.isArray(data)?XLSX.utils.aoa_to_sheet(data):data,name);return XLSX.write(wb,{type:'buffer',bookType:type});}
test('all XLS/XLSX sheets and exact first/second pairs preserve metadata',async()=>{
 for(const type of ['xlsx','biff8']){const parsed=parseCuttingWorkbook(bytes([['One',rows],['Two',[header,['MODEL-B','','MI-C','AI-C']]]],type));assert.equal(parsed.pairs.length,3);assert.deepEqual(parsed.pairs.slice(0,2).map(p=>[p.mi_code,p.ai_code,p.variant,p.maker]),[['MI-A','AI-A',1,'Maker-A'],['MI-B','AI-B',2,'Maker-B']]);assert.equal(parsed.pairs[0].qty,'1.5');assert.equal(parsed.sheets.length,2);}
 assert.equal((await parseCuttingInWorker(bytes([['One',rows]]))).pairs.length,2);
});
test('merged report headers/model cells, padded codes and signature footer',()=>{
 const ws=XLSX.utils.aoa_to_sheet([['Report'],['Model Code','Model Name','MI CODE',null,'AI CODE',null,'Item Name(1st)','Maker(1st)','Maker(2st)','Item Qty(BOM)','Location'],[null,null,'Item Code(1st)','Item Code(2st)','Item Code(1st)','Item Code(2st)'],['M','Name','000123','MI2','AI1','AI2','Cap','X','Y',2,'C1'],[null,null,'MI3',null,'AI3'],['VN MANAGER'],['Plan','ME','IQC']]);
 ws['!merges']=[{s:{r:1,c:0},e:{r:2,c:0}},{s:{r:1,c:1},e:{r:2,c:1}},{s:{r:1,c:2},e:{r:1,c:3}},{s:{r:1,c:4},e:{r:1,c:5}},...Array.from({length:5},(_,i)=>({s:{r:1,c:6+i},e:{r:2,c:6+i}})),{s:{r:3,c:0},e:{r:4,c:0}},{s:{r:3,c:1},e:{r:4,c:1}}];
 ws.C4={t:'n',v:123,z:'000000'};const p=parseCuttingWorkbook(bytes([['Report',ws]])).pairs;
 assert.equal(p.length,3);assert.equal(p[0].mi_code,'000123');assert.equal(p[1].maker,'Y');assert.equal(p[2].model_code,'M');assert.equal(p[2].model_name,'Name');
});
test('incomplete pair or unrecognized nonempty sheet fails entire import',()=>{
 assert.throws(()=>parseCuttingWorkbook(bytes([['Good',rows],['Bad',[header,['M','','MI-ONLY']]]])),/Bad/);
 assert.throws(()=>parseCuttingWorkbook(bytes([['Good',rows],['Bad',[['Unknown']]]])),/Bad/);
 assert.throws(()=>parseCuttingWorkbook(Buffer.from('bad')));
});
test('bidirectional exact lookup, model ambiguity, isolated immutable history and retries',()=>{
 const db=openDatabase(':memory:');try{
 db.prepare("INSERT INTO users(id,username,name,password,role) VALUES(1,'test','Test','unused','admin')").run();
 const parsed=parseCuttingWorkbook(bytes([['One',[...rows,['MODEL-B','','MI-X','AI-A']]]]));importCutting(db,parsed,'one.xlsx',1);
 let r=lookupCutting(db,{code:' ai-a '});assert.equal(r.matches.length,2);assert.equal(r.multiple_targets,true);assert.deepEqual(new Set(r.matches.map(m=>m.target_code)),new Set(['MI-A','MI-X']));
 r=lookupCutting(db,{code:'AI-B',model:'model-a'});assert.equal(r.matches[0].target_code,'MI-B');assert.equal(r.matches[0].variant,2);
 assert.equal(lookupCutting(db,{code:'MI-B'}).matches[0].target_code,'AI-B');assert.equal(lookupCutting(db,{code:'AI-B',direction:'MI_TO_AI'}).matches.length,0);
 const input={request_id:'same',user_id:1,code:'AI-A',model:'MODEL-A',image:{mime:null,buffer:null}};
 const saved=saveCuttingScan(db,input);assert.equal(saved.matches[0].target_code,'MI-A');assert.equal(saveCuttingScan(db,input).id,saved.id);assert.throws(()=>saveCuttingScan(db,{...input,user_id:2}));
 importCutting(db,parseCuttingWorkbook(bytes([['New',[header,['MODEL-A','','NEW-MI','AI-A']]]])),'new.xlsx',1);
 assert.equal(lookupCutting(db,{code:'AI-A'}).matches[0].target_code,'NEW-MI');assert.equal(JSON.parse(db.prepare('SELECT snapshot FROM cutting_scans').get().snapshot).matches[0].target_code,'MI-A');assert.equal(db.prepare('SELECT COUNT(*) n FROM scans').get().n,0);
 }finally{db.close();}
});
