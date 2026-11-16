import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {appRelease} from '../lib/app-release.mjs';
test('release digest follows actual APK bytes, exposes only fixed Work Area download and rejects foreign packages',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wa-release-'));try{
  await mkdir(join(dir,'downloads'));const meta={package_id:'vn.hansol.workarea.offline',version_code:11,version:'1.1.5',notes:'Update'};
  await writeFile(join(dir,'android-release.json'),JSON.stringify(meta));await writeFile(join(dir,'downloads/WorkArea-Offline-1.0.0.apk'),'fixture-one');
  const first=await appRelease(dir);assert.equal(first.sha256,createHash('sha256').update('fixture-one').digest('hex'));assert.equal(first.url,'/downloads/WorkArea-Offline-1.0.0.apk');
  await writeFile(join(dir,'downloads/WorkArea-Offline-1.0.0.apk'),'fixture-two-longer');const next=await appRelease(dir);assert.notEqual(next.sha256,first.sha256);assert.equal(next.bytes,18);
  await writeFile(join(dir,'android-release.json'),JSON.stringify({...meta,package_id:'foreign.app'}));await assert.rejects(appRelease(dir),/Invalid/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('published version matches phone build so future APK releases cannot omit update metadata',async()=>{
 const meta=JSON.parse(await readFile(new URL('../public/android-release.json',import.meta.url),'utf8')),gradle=await readFile(new URL('../android-offline/app/build.gradle',import.meta.url),'utf8');
 assert.match(gradle,new RegExp('versionCode '+meta.version_code+"; versionName '"+meta.version.replaceAll('.','\\.')+"'"));
});
