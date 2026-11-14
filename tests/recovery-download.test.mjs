import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,unlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import {openDatabase} from '../lib/db.mjs';
import {issueSession} from '../lib/auth.mjs';
test('recovery archive is admin-only, downloaded as private attachment, and never exposes file paths',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'wa-recovery-')),archive=join(folder,'backup.zip'),bytes=Buffer.alloc(1024*1024,42),db=openDatabase(':memory:');
 writeFileSync(archive,bytes);writeFileSync(archive+'.json',JSON.stringify({createdAt:'2026-11-14T08:40:46.013Z',build:'test-build'}));const sessions={};
 for(const role of ['admin','inspector','viewer']){const row=db.prepare('INSERT INTO users(username,name,password,role) VALUES (?,?,?,?)').run(role,role,'unused',role);sessions[role]=issueSession(db,row.lastInsertRowid);}
 const server=await createApp({db,production:false,recoveryArchive:archive});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
 const get=role=>fetch(base+'/api/admin/recovery-backup',{headers:role?{Cookie:'wa_session='+sessions[role].token}:{}});
 assert.equal((await get()).status,401);
 const info=role=>fetch(base+'/api/admin/recovery-backup/info',{headers:role?{Cookie:'wa_session='+sessions[role].token}:{}});
 assert.equal((await info()).status,401);assert.equal((await info('viewer')).status,403);assert.equal((await info('inspector')).status,403);
 assert.deepEqual(await(await info('admin')).json(),{size_bytes:bytes.length,created_at:'2026-11-14T08:40:46.013Z',build:'test-build'});
 for(const role of ['inspector','viewer'])assert.equal((await get(role)).status,403);
 const r=await get('admin');assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/zip');assert.match(r.headers.get('content-disposition'),/attachment; filename="WorkArea-Recovery.zip"/);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(Number(r.headers.get('content-length')),bytes.length);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);
 unlinkSync(archive);const missing=await get('admin');assert.equal(missing.status,404);assert.ok(!(await missing.text()).includes(folder));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();rmSync(folder,{recursive:true,force:true});}
});
