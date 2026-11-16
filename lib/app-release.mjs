import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
let cached;
export async function appRelease(publicDir){
 const meta=JSON.parse(await readFile(resolve(publicDir,'android-release.json'),'utf8'));
 if(meta.package_id!=='vn.hansol.workarea.offline'||!Number.isSafeInteger(meta.version_code)||meta.version_code<1||typeof meta.version!=='string')throw Error('Invalid Android release metadata');
 const file=resolve(publicDir,'downloads/WorkArea-Offline-1.0.0.apk'),info=await stat(file),key=file+':'+info.size+':'+info.mtimeMs;
 if(cached?.key!==key)cached={key,sha256:createHash('sha256').update(await readFile(file)).digest('hex')};
 return {package_id:meta.package_id,version_code:meta.version_code,version:meta.version,notes:String(meta.notes||'').slice(0,1500),url:'/downloads/WorkArea-Offline-1.0.0.apk',bytes:info.size,sha256:cached.sha256};
}
