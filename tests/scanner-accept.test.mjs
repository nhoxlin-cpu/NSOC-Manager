import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('../public/scanner.js',import.meta.url),'utf8')).replace("'/scanner-tools.js?v=20261114-24'",JSON.stringify(new URL('../public/scanner-tools.js',import.meta.url).href)).replace("'/hs-code.js?v=20261114-19'",JSON.stringify(new URL('../public/hs-code.js',import.meta.url).href));
const {PhoneScanner}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
function scanner(options){const node={};return Object.assign(Object.create(PhoneScanner.prototype),{options,active:true,busy:false,saved:0,queued:0,seen:new Map(),continuous:true,$:()=>node,stockUI(){},paint(...args){this.result=args;},duplicate(...args){this.duplicateResult=args;},feedback(){},flowUI(){},counts(){}});}
test('HS performs one authoritative save without preflight or pending-image reads and keeps raw evidence/duplicate result',async()=>{
 const calls=[],image='data:image/jpeg;base64,fixture',s=scanner({mode:'HS',autoCapture:true,pending:()=>{throw Error('HS must not read pending rows');},api:async(path,options)=>{calls.push({path,...options});return {is_duplicate:true,prior_count:3};}});
 await s.accept('0837770049AA-261115-001',false,image);assert.equal(calls.length,1);assert.equal(calls[0].path,'/scans');assert.equal(calls[0].method,'POST');assert.equal(calls[0].data.barcode,'0837770049AA');assert.equal(calls[0].data.raw_barcode,'0837770049AA-261115-001');assert.equal(calls[0].data.image,image);assert.equal(s.saved,1);assert.deepEqual(s.duplicateResult,['0837770049AA',3,0,true,true]);assert.equal(s.busy,false);
});
test('HS failed save queues the same request and evidence for idempotent retry',async()=>{
 const rows=[],calls=[],s=scanner({mode:'HS',autoCapture:true,api:async(path,options)=>{calls.push(options.data);throw Object.assign(Error('offline'),{network:true});},enqueue:async row=>rows.push(row)});
 await s.accept('0837770049AA-261115-002',false,'data:image/jpeg;base64,fixture');assert.equal(calls.length,1);assert.equal(rows.length,1);assert.equal(rows[0].request_id,calls[0].request_id);assert.equal(rows[0].raw_barcode,'0837770049AA-261115-002');assert.equal(rows[0].image,calls[0].image);assert.equal(s.queued,1);assert.equal(s.result[0],'pending');
});
test('Stock retains preflight and local duplicate protection',async()=>{
 const calls=[],s=scanner({mode:'Stock',autoCapture:false,pending:async()=>[],api:async path=>{calls.push(path);return {count:2};}});
 await s.accept('P2611150000001');assert.equal(calls.length,1);assert.ok(calls[0].startsWith('/scans/check?'));assert.equal(s.saved,0);assert.deepEqual(s.duplicateResult,['P2611150000001',2,0,true]);
});
