import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {editHoldingInside} from '../lib/holding.mjs';
import {transaction} from '../lib/db.mjs';
export function planHoldingVendors(db){
 const rows=db.prepare('SELECT * FROM holding_entries WHERE remaining_qty>0 ORDER BY id').all();const changes=[],skipped={missing:0,ambiguous:0,unchanged:0};
 for(const row of rows){let matches=db.prepare('SELECT maker FROM mm_inventory WHERE barcode=? AND item_code=?').all(row.barcode,row.item_code);
 if(!matches.length)matches=db.prepare('SELECT DISTINCT maker FROM mm_inventory WHERE item_code=?').all(row.item_code);
 if(!matches.length)matches=db.prepare('SELECT maker FROM materials WHERE item_code=?').all(row.item_code);
 const names=[...new Set(matches.map(m=>String(m.maker||'').trim()).filter(Boolean))];if(!names.length){skipped.missing++;continue;}if(names.length!==1){skipped.ambiguous++;continue;}if(row.vendor===names[0]){skipped.unchanged++;continue;}
 changes.push({id:row.id,revision:row.revision,vendor:names[0]});
 }
 return {active:rows.length,changes,skipped};
}
export function applyHoldingVendors(db,plan,userId){return transaction(db,()=>{
 const admin=db.prepare("SELECT id FROM users WHERE id=? AND role='admin' AND active=1").get(userId);if(!admin)throw Error('Active admin required');
 for(const target of plan.changes){const row=db.prepare('SELECT * FROM holding_entries WHERE id=?').get(target.id);if(!row||row.remaining_qty<=0||row.revision!==target.revision)throw Error('Holding changed since preview; rerun preview');
 const current=planHoldingVendorsForOne(db,row);if(current!==target.vendor)throw Error('MM changed since preview; rerun preview');
 editHoldingInside(db,{...row,entry_id:row.id,expected_revision:row.revision,vendor:target.vendor,reason:'Correct existing Holding Vendor from MM Maker / Mark at user request',request_id:createHash('sha256').update('holding-mm-maker-repair:'+row.id+':'+row.revision+':'+target.vendor).digest('hex')},userId);
 }return {updated:plan.changes.length,skipped:plan.skipped};
});}
function planHoldingVendorsForOne(db,row){let matches=db.prepare('SELECT maker FROM mm_inventory WHERE barcode=? AND item_code=?').all(row.barcode,row.item_code);if(!matches.length)matches=db.prepare('SELECT DISTINCT maker FROM mm_inventory WHERE item_code=?').all(row.item_code);if(!matches.length)matches=db.prepare('SELECT maker FROM materials WHERE item_code=?').all(row.item_code);const names=[...new Set(matches.map(m=>String(m.maker||'').trim()).filter(Boolean))];return names.length===1?names[0]:null;}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!process.env.DB_PATH)throw Error('Explicit DB_PATH required');const apply=process.argv.includes('--apply'),db=new DatabaseSync(resolve(process.env.DB_PATH),{readOnly:!apply});db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000');
 try{const plan=planHoldingVendors(db);console.log(JSON.stringify({mode:apply?'apply':'preview',active:plan.active,to_update:plan.changes.length,skipped:plan.skipped}));
 if(apply){const directory=join(dirname(resolve(process.env.DB_PATH)),'backups');mkdirSync(directory,{recursive:true});const path=join(directory,'holding-vendor-before-'+Date.now()+'.sqlite');db.prepare('VACUUM INTO ?').run(path);const check=new DatabaseSync(path,{readOnly:true});try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Backup integrity failed');}finally{check.close();}console.log('Verified backup: '+path);const admin=db.prepare("SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1").get();console.log(JSON.stringify(applyHoldingVendors(db,plan,admin?.id)));}
 }finally{db.close();}
}
