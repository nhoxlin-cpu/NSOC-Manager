import {backup,DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,readdir,readFile,writeFile,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function recoveryBundle(db,root,origin){
 const temp=await mkdtemp(join(tmpdir(),'work-area-recovery-'));let closed=false;
 const cleanup=async()=>{if(!closed){closed=true;await rm(temp,{recursive:true,force:true});}};
 try{
  const database=join(temp,'work-area.sqlite');await backup(db,database);
  const check=new DatabaseSync(database);try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Backup integrity check failed');check.exec('DELETE FROM sessions');}finally{check.close();}
  const files=[];
  async function walk(dir,prefix){for(const entry of await readdir(dir,{withFileTypes:true})){const name=prefix+'/'+entry.name,path=join(dir,entry.name);if(entry.isSymbolicLink())throw Error('Backup source contains a symbolic link');if(entry.isDirectory())await walk(path,name);else if(entry.isFile())files.push({name,path});}}
  for(const dir of ['lib','public','scripts','deploy'])await walk(join(root,dir),'app/'+dir);
  for(const name of ['server.mjs','package.json','README.md','Dockerfile','compose.yaml']){try{const path=join(root,name);await lstat(path);files.push({name:'app/'+name,path});}catch(e){if(e.code!=='ENOENT')throw e;}}
  files.push({name:'app/data/work-area.sqlite',path:database});
  const manifest={format:'work-area-recovery-v1',createdAt:new Date().toISOString(),origin,node:process.version,sessionsRemoved:true,files:[]};let total=0;
  for(const f of files){const info=await lstat(f.path);if(info.isSymbolicLink()||info.size>512*1024*1024)throw Error('A backup file exceeds 512 MB or is not a regular file');total+=info.size;if(total>3500*1024*1024)throw Error('Backup exceeds ZIP size limit');const data=await readFile(f.path);manifest.files.push({name:f.name,size:data.length,sha256:hash(data)});}
  async function* entries(){yield{name:'manifest.json',data:JSON.stringify(manifest,null,2)};yield{name:'RESTORE.md',data:await readFile(join(root,'scripts/RECOVERY.md'))};for(const f of files){const data=await readFile(f.path);if(hash(data)!==manifest.files.find(m=>m.name===f.name).sha256)throw Error('Source changed during backup; retry');yield{name:f.name,data};}}
  return {entries,cleanup};
 }catch(e){await cleanup();throw e;}
}
