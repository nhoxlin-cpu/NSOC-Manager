import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {createApp} from '../server.mjs';
import {openDatabase} from '../lib/db.mjs';

test('web offline serves only manifest assets with WASM/SW headers; APIs remain authenticated',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'workarea-web-'));const db=openDatabase(':memory:');let server;
 try{await mkdir(join(directory,'offline'));await writeFile(join(directory,'index.html'),'<h1>Offline shell</h1>');await writeFile(join(directory,'sw.js'),'// worker');await writeFile(join(directory,'offline/test.wasm'),Buffer.from([0,97,115,109]));await writeFile(join(directory,'secret.txt'),'not published');await writeFile(join(directory,'web-manifest.json'),JSON.stringify({files:['index.html','sw.js','offline/test.wasm']}));server=await createApp({db,webDirectory:directory,production:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 assert.equal(await(await fetch(base+'/')).text(),'<h1>Offline shell</h1>');const sw=await fetch(base+'/sw.js');assert.equal(sw.headers.get('service-worker-allowed'),'/');assert.equal(sw.headers.get('cache-control'),'no-cache');assert.match(sw.headers.get('content-type'),/javascript/);assert.equal((await fetch(base+'/offline/test.wasm')).headers.get('content-type'),'application/wasm');assert.equal((await fetch(base+'/secret.txt')).status,404);assert.equal((await fetch(base+'/api/offline/snapshot')).status,401);assert.match(sw.headers.get('content-security-policy'),/wasm-unsafe-eval/);
 }finally{server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));db.close();await rm(directory,{recursive:true,force:true});}
});

test('worker caches only its shell, preserves old versions on failed install and never intercepts APIs',async()=>{
 const source=(await readFile(new URL('../offline/web-worker.js',import.meta.url),'utf8')).replace('__VERSION__','test').replace('__ASSETS__',JSON.stringify(['/index.html','/app.js']));const handlers={},stored=new Map([['work-area-shell-old',new Map()],['unrelated',new Map()]]);let fail=false;
 const caches={open:async name=>{if(!stored.has(name))stored.set(name,new Map());const data=stored.get(name);return {put:async(key,response)=>data.set(key,response),match:async key=>data.get(key),keys:async()=>[...data.keys()].map(p=>new Request('https://test.local'+p))};},delete:async name=>stored.delete(name),keys:async()=>[...stored.keys()]};
 vm.runInNewContext(source,{self:{location:{origin:'https://test.local'},addEventListener:(name,fn)=>handlers[name]=fn},caches,URL,Request:class{constructor(url){this.url=url;}},fetch:async req=>{if(fail&&req.url==='/app.js')throw Error('network');return {ok:true};},Set,Error});
 const event=()=>({waitUntil(p){this.promise=p;}});fail=true;let install=event();handlers.install(install);await assert.rejects(install.promise);assert.ok(stored.has('work-area-shell-old'));assert.ok(!stored.has('work-area-shell-test'));fail=false;install=event();handlers.install(install);await install.promise;assert.equal(stored.get('work-area-shell-test').size,2);
 for(const url of ['https://test.local/api/offline/snapshot','https://test.local/api/ckd/pair/save','https://test.local/downloads/test.apk','https://other.local/app.js'])handlers.fetch({request:{url,method:'GET',mode:'cors'},respondWith(){assert.fail('Private/network resource intercepted');}});
 let reply;const check={...event(),data:{type:'SHELL_READY'},ports:[{postMessage:r=>reply=r}]};handlers.message(check);await check.promise;assert.equal(reply.ready,true);stored.get('work-area-shell-test').delete('/app.js');handlers.message(check);await check.promise;assert.equal(reply.ready,false);
 const activate=event();handlers.activate(activate);await activate.promise;assert.ok(!stored.has('work-area-shell-old'));assert.ok(stored.has('unrelated'));
});

test('standalone signup bypasses service worker even when accidentally listed in shell assets',async()=>{
 const paths=['/register','/register.html','/registration-page.js','/registration-page.css'];const source=(await readFile(new URL('../offline/web-worker.js',import.meta.url),'utf8')).replace('__VERSION__','signup-test').replace('__ASSETS__',JSON.stringify(paths));const handlers={};vm.runInNewContext(source,{self:{location:{origin:'https://test.local'},addEventListener:(name,fn)=>handlers[name]=fn},URL,Set});
 for(const path of paths)handlers.fetch({request:{url:'https://test.local'+path,method:'GET',mode:'navigate'},respondWith(){assert.fail('Signup must use the current server response');}});
});
