import {test} from 'node:test';import assert from 'node:assert/strict';
import {openDatabase} from '../lib/db.mjs';import {listMM} from '../lib/mm-data.mjs';import {rememberCodes} from '../lib/mm-code-registry.mjs';
test('all imported Specs remain searchable without inventory and historical matches never inherit current quantities',()=>{const db=openDatabase(':memory:');try{
 rememberCodes(db,[{item_code:'ITEM1',item_name:'Cap',spec:'82uF OLD',vendor:'Vendor'}],'first');
 rememberCodes(db,[{item_code:'ITEM1',item_name:'Cap',spec:'100uF NEW',vendor:'Vendor'}],'next');
 const old=listMM(db,{field:'spec',q:'82uF'});assert.equal(old.materials.length,1);assert.equal(old.materials[0].archived,1);assert.equal(old.materials[0].qty,null);assert.equal(old.materials[0].box_count,0);
 assert.equal(listMM(db,{field:'spec',q:'100uF'}).materials.length,1);assert.equal(listMM(db,{field:'item_code',q:'ITEM1'}).materials.length,0);
}finally{db.close();}});
