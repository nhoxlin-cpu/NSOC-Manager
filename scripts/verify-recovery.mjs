import{readFile}from'node:fs/promises';import{createHash}from'node:crypto';import{resolve,sep}from'node:path';
const root=resolve('..'),manifest=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8'));
if(manifest.format!=='work-area-recovery-v1')throw Error('Unknown recovery format');
for(const f of manifest.files){const p=resolve(root,f.name);if(!p.startsWith(root+sep)||!f.name.startsWith('app/'))throw Error('Invalid archive path');const b=await readFile(p);if(b.length!==f.size||createHash('sha256').update(b).digest('hex')!==f.sha256)throw Error('Checksum mismatch: '+f.name);}
console.log('Recovery checksums verified: '+manifest.files.length+' files.');
