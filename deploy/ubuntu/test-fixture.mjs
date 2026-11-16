import {openDatabase} from '../../lib/db.mjs';
import {hashPassword} from '../../lib/auth.mjs';
import {initCkd} from '../../lib/ckd.mjs';
import {initHolding,receiveHolding} from '../../lib/holding.mjs';
import {recoveryBundle} from '../../lib/recovery.mjs';
import {streamZip} from '../../lib/formats.mjs';
import {createWriteStream} from 'node:fs';
import {finished} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
const db=openDatabase(':memory:');initCkd(db);initHolding(db);
db.prepare('INSERT INTO users(username,name,password,role) VALUES(?,?,?,?)').run('restore-admin','Restore test',await hashPassword('ubuntu-fixture-password'),'admin');
receiveHolding(db,{request_id:'ubuntu-fixture-receive-123',barcode:'FIXTURE-BOX',item_code:'001TEST',item_name:'Fixture',vendor:'Fixture maker',location:'A1',lot_no:'LOT-KEEP',qty:2.5},1);
const bundle=await recoveryBundle(db,fileURLToPath(new URL('../../',import.meta.url)),'https://old.example.test');
try{const out=createWriteStream(process.argv[2]);const done=finished(out);await streamZip(out,bundle.entries());await done;}finally{await bundle.cleanup();db.close();}
