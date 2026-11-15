import {DatabaseSync} from 'node:sqlite';
import {mkdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {transaction} from './db.mjs';
import {businessApi,queuePaths,stampOfflineTime} from './offline-business.mjs';
export function initOffline(db){db.exec(`CREATE TABLE IF NOT EXISTS offline_replays(request_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),path TEXT NOT NULL,request_hash TEXT NOT NULL,response TEXT NOT NULL,captured_at TEXT NOT NULL,received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);CREATE TABLE IF NOT EXISTS offline_settings(name TEXT PRIMARY KEY,value TEXT NOT NULL)`);db.prepare("INSERT OR IGNORE INTO offline_settings(name,value) VALUES ('realm',?)").run(randomUUID());}
export const offlineRealm=db=>db.prepare("SELECT value FROM offline_settings WHERE name='realm'").get().value;
export async function makeOfflineSnapshot(db,user,directory){
 await mkdir(directory,{recursive:true,mode:0o700});const token=randomUUID(),scratch=join(directory,token+'-private.sqlite'),file=join(directory,token+'.sqlite');let copy;
 try{
  db.prepare('VACUUM INTO ?').run(scratch);copy=new DatabaseSync(scratch);copy.exec('PRAGMA secure_delete=ON; PRAGMA journal_mode=DELETE;');
  copy.exec('DELETE FROM sessions; DELETE FROM login_attempts; DELETE FROM offline_replays;');
  copy.prepare("UPDATE users SET password='OFFLINE-DISABLED',username=CASE WHEN id=? THEN username ELSE ?||id END,role=CASE WHEN id=? THEN role ELSE 'viewer' END,active=CASE WHEN id=? THEN active ELSE 0 END").run(user.id,'offline-'+token+'-',user.id,user.id);
  for(const table of ['user_preferences','holding_preferences','mm_lookup_saved'])copy.prepare('DELETE FROM '+table+' WHERE user_id<>?').run(user.id);
  copy.prepare('VACUUM INTO ?').run(file);copy.close();copy=null;await unlink(scratch);return {file,at:new Date().toISOString(),user:{id:user.id,username:user.username,name:user.name,role:user.role,active:user.active}};
 }catch(error){copy?.close();await Promise.allSettled([unlink(scratch),unlink(file)]);throw error;}
}
function nestedDatabase(db){let depth=0;const stack=[];return {prepare:sql=>db.prepare(sql),exec:sql=>{
 if(/^BEGIN(?: IMMEDIATE)?$/i.test(sql)){const name='offline_inner_'+(++depth);stack.push(name);return db.exec('SAVEPOINT '+name);}
 if(sql==='COMMIT'){const name=stack.pop();return db.exec('RELEASE SAVEPOINT '+name);}
 if(sql==='ROLLBACK'){const name=stack.pop();return db.exec('ROLLBACK TO SAVEPOINT '+name+'; RELEASE SAVEPOINT '+name);}
 return db.exec(sql);
 }};}
export function replayOffline(db,user,packet){
 const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
 if(!packet||typeof packet.request_id!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(packet.request_id)||!queuePaths.has(packet.path)||!packet.body||typeof packet.body!=='object'||Array.isArray(packet.body)||typeof packet.captured_at!=='string'||!Number.isFinite(Date.parse(packet.captured_at)))fail('Giao dịch offline không hợp lệ.');
 if(packet.realm&&packet.realm!==offlineRealm(db))fail('Bộ dữ liệu server đã thay đổi. Giữ hàng chờ và khôi phục đúng bản sao lưu trước khi đồng bộ.',409);
 const hash=createHash('sha256').update(JSON.stringify({path:packet.path,body:packet.body,captured_at:packet.captured_at})).digest('hex');
 return transaction(db,()=>{
  const old=db.prepare('SELECT * FROM offline_replays WHERE request_id=?').get(packet.request_id);if(old){if(old.user_id!==user.id||old.request_hash!==hash)fail('Mã đồng bộ đã được dùng cho dữ liệu khác.',409);return {...JSON.parse(old.response),duplicate:true};}
  const now=Date.now(),clock=Date.parse(packet.captured_at),adjusted=clock>now+5*60e3||clock<now-366*86400e3,at=new Date(adjusted?now:clock).toISOString();
  let result;try{result=businessApi(nestedDatabase(db),user,packet.path,{method:'POST',data:packet.body},true);}catch(error){if(!error.status)error.status=error.code?.includes('CONSTRAINT')||error.errcode&&((error.errcode&255)===19)?409:400;throw error;}
  if(!result.duplicate)stampOfflineTime(db,packet.path,packet.body,result,at,user.id);
  const response={result,request_id:packet.request_id,captured_at:at,clock_adjusted:adjusted};db.prepare('INSERT INTO offline_replays(request_id,user_id,path,request_hash,response,captured_at) VALUES (?,?,?,?,?,?)').run(packet.request_id,user.id,packet.path,hash,JSON.stringify(response),at);return response;
 });
}
