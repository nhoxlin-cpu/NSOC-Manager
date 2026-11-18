const CACHE='work-area-shell-__VERSION__',ASSETS=__ASSETS__,SHELL=new Set(ASSETS);
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 try{for(const url of ASSETS){const response=await fetch(new Request(url,{cache:'reload',credentials:'omit'}));if(!response.ok)throw Error('Incomplete shell');await cache.put(url,response);}}
 catch(error){await caches.delete(CACHE);throw error;}
 // Existing tabs finish on their current version; never replace a running workspace.
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const name of await caches.keys())if(name.startsWith('work-area-shell-')&&name!==CACHE)await caches.delete(name);
})()));
self.addEventListener('message',event=>{if(event.data?.type!=='SHELL_READY'||!event.ports[0])return;event.waitUntil((async()=>{const cache=await caches.open(CACHE),keys=new Set((await cache.keys()).map(r=>new URL(r.url).pathname));event.ports[0].postMessage({ready:ASSETS.every(p=>keys.has(p))});})());});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/downloads/')||['/register','/register.html','/registration-page.js','/registration-page.css'].includes(url.pathname))return;
 const key=request.mode==='navigate'&&(url.pathname==='/'||url.pathname==='/index.html')?'/index.html':url.pathname;
 if(!SHELL.has(key))return;
 event.respondWith((async()=>{const cached=await(await caches.open(CACHE)).match(key);return cached||fetch(request);})());
});
