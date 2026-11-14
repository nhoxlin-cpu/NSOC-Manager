import {readFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {openDatabase} from '../lib/db.mjs';
import {initHolding,importHolding,holdingLookup,holdingReference} from '../lib/holding.mjs';
import {parseMMInWorker} from '../lib/mm-workbook.mjs';
if(!process.env.DB_PATH)throw Error('Set DB_PATH explicitly before importing Holding reference files.');
const args=process.argv.slice(2);if(!args.length||args.length%2)throw Error('Usage: node scripts/import-holding-stock.mjs PBA32 file.xls [PMD32 file.xls]');
const files=[];
for(let i=0;i<args.length;i+=2){const kind=args[i],path=args[i+1];if(!['PBA32','PMD32'].includes(kind))throw Error('Use PBA32 or PMD32.');const parsed=await parseMMInWorker(await readFile(path));if(parsed.rows.some(r=>r.storage_location?.trim().toUpperCase()!==kind))throw Error('S/L does not match '+kind);files.push({kind,name:basename(path),parsed});}
const db=openDatabase();try{initHolding(db);const admin=db.prepare("SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1").get();if(!admin)throw Error('An active administrator account is required.');
for(const file of files){const current=holdingReference(db).batches.find(b=>b.kind===file.kind);const same=current?.rows===file.parsed.rows.length&&file.parsed.rows.every(r=>{const saved=holdingLookup(db,r.barcode).matches.find(m=>m.kind===file.kind);return saved&&['item_code','item_name','qty','vendor','lot_no'].every(k=>(saved[k]??'')===(r[k]??''));});if(same){console.log(file.kind+': reference already matches; skipped.');continue;}console.log(JSON.stringify(importHolding(db,file.parsed,file.name,file.kind,admin.id)));}
}finally{db.close();}
