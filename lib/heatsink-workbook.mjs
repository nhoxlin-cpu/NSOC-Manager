import XLSX from './vendor/sheetjs-0.20.3.cjs';
import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
const key=v=>String(v??'').toLowerCase().replace(/[^a-z0-9]/g,'');
const attrs=s=>Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map(m=>[m[1],m[2].replaceAll('&amp;','&')]));
export function parseHeatsink(buffer){
 buffer=Buffer.from(buffer);if(buffer.length>200*1024*1024||buffer.readUInt32LE(0)!==0x04034b50)throw Error('Chọn file XLSX hợp lệ, tối đa 200 MB.');
 // Bound expanded ZIP data before SheetJS inflates any workbook entries.
 let expanded=0,entries=0;for(let i=0;i<buffer.length-46;i++){if(buffer.readUInt32LE(i)!==0x02014b50)continue;const size=buffer.readUInt32LE(i+24),n=buffer.readUInt16LE(i+28),x=buffer.readUInt16LE(i+30),c=buffer.readUInt16LE(i+32);expanded+=size;entries++;if(size===0xffffffff||expanded>800*1024*1024||entries>30000)throw Error('File Excel giải nén quá lớn.');i+=45+n+x+c;}
 if(!entries)throw Error('Không tìm thấy nội dung XLSX.');
 const wb=XLSX.read(buffer,{type:'buffer',dense:true,bookFiles:true,cellNF:true,cellFormula:false,cellHTML:false});if(wb.SheetNames.length>300)throw Error('Tối đa 300 sheet.');
 const xml=p=>Buffer.from(wb.files?.[p]?.content||[]).toString();
 const rels=p=>{const dir=posix.dirname(p),file=posix.join(dir,'_rels',posix.basename(p)+'.rels');return Object.fromEntries([...xml(file).matchAll(/<(?:\w+:)?Relationship\b([^>]+)\/?\s*>/g)].map(m=>attrs(m[1])).filter(a=>a.TargetMode!=='External'&&!/^[a-z]+:/i.test(a.Target||'')).map(a=>[a.Id,posix.normalize(posix.join(dir,a.Target||''))]));};
 const bookRels=rels('xl/workbook.xml'),sheetPaths=[...xml('xl/workbook.xml').matchAll(/<(?:\w+:)?sheet\b([^>]+)>/g)].map(m=>bookRels[attrs(m[1])['r:id']]);
 const groups=[],sheets=[],images=new Map();
 for(const [index,name] of wb.SheetNames.entries()){
  const ws=wb.Sheets[name];if(!ws?.['!ref']){sheets.push({name,groups:0,parts:0});continue;}
  const range=XLSX.utils.decode_range(ws['!ref']);if(range.e.r>100000||range.e.c>100)throw Error('Sheet quá lớn: '+name);
  const merged=(r,c)=>(ws['!merges']||[]).find(m=>r>=m.s.r&&r<=m.e.r&&c>=m.s.c&&c<=m.e.c);
  const value=(r,c,inherit=false)=>{if(inherit){const m=merged(r,c);if(m){r=m.s.r;c=m.s.c;}}const cell=ws['!data']?.[r]?.[c];return cell?String(cell.t==='n'&&/^0+$/.test(cell.z||'')?XLSX.utils.format_cell(cell):cell.v??'').trim():'';};
  let header=-1,map={};for(let r=0;r<Math.min(30,range.e.r+1);r++){const fields={};for(let c=0;c<=range.e.c;c++){const k=key(value(r,c));if(k)fields[k]=c;}if(fields.subheatsink!==undefined&&fields.codeheatsink!==undefined&&fields.codeic!==undefined){header=r;map=fields;break;}}
  if(header<0)throw Error('Sheet '+name+': thiếu tiêu đề Sub Heatsink / Code Heatsink / Code IC.');
  const icMerge=merged(header,map.codeic),position=icMerge&&icMerge.e.c>icMerge.s.c?map.codeic:null,code=position===null?map.codeic:map.codeic+1;
  const local=[];let current=null;
  for(let r=header+1;r<=range.e.r;r++){
   const ic=value(r,code),description=map.description===undefined?'':value(r,map.description);if(!ic&&!description)continue;
   const sub_code=value(r,map.subheatsink,true),heatsink_code=value(r,map.codeheatsink,true);
   const model=map.model!==undefined?value(r,map.model,true)||name:name;
   const subMerge=merged(r,map.subheatsink),start=subMerge?.s.r??r,end=subMerge?.e.r??r;
   if(!current||current.sub_code!==sub_code||current.heatsink_code!==heatsink_code||current.model!==model||r>current.end){current={sub_code,heatsink_code,model,sheet:name,source_row:r+1,start,end,parts:[],images:[]};local.push(current);groups.push(current);}
   current.parts.push({position:position===null?'':value(r,position,true),code:ic,description,source_row:r+1});if(groups.length>100000)throw Error('Quá 100.000 cụm.');
  }
  const sheetPath=sheetPaths[index],sheetRels=sheetPath?rels(sheetPath):{};
  for(const drawingPath of Object.values(sheetRels).filter(p=>/^xl\/drawings\/[^/]+\.xml$/.test(p))){const drawingRels=rels(drawingPath);for(const anchor of xml(drawingPath).matchAll(/<(?:\w+:)?(?:oneCellAnchor|twoCellAnchor)\b[^>]*>([\s\S]*?)<\/(?:\w+:)?(?:oneCellAnchor|twoCellAnchor)>/g)){
   const row=Number(/<(?:\w+:)?from>[\s\S]*?<(?:\w+:)?row>(\d+)<\//.exec(anchor[1])?.[1]),id=/r:embed="([^"]+)"/.exec(anchor[1])?.[1],path=drawingRels[id],bytes=Buffer.from(wb.files?.[path]?.content||[]);const g=local.find(g=>row>=g.start&&row<=g.end);if(!g||!bytes.length)continue;
   const mime=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))?'image/jpeg':null;if(!mime)throw Error('Ảnh không hỗ trợ trong '+name);const hash=createHash('sha256').update(bytes).digest('hex');images.set(hash,{id:hash,mime,bytes});if(!g.images.includes(hash))g.images.push(hash);
  }}
  sheets.push({name,groups:local.length,parts:local.reduce((n,g)=>n+g.parts.length,0)});
 }
 if(!groups.length)throw Error('File chưa có dữ liệu Sub Heatsink.');return {groups,sheets,images:[...images.values()]};
}
export function parseHeatsinkInWorker(buffer){return new Promise((resolve,reject)=>{const w=new Worker(new URL(import.meta.url),{workerData:{heatsink:true,buffer},resourceLimits:{maxOldGenerationSizeMb:1536}});let done=false;const finish=(e,v)=>{if(done)return;done=true;clearTimeout(timer);w.terminate();e?reject(e):resolve(v);};const timer=setTimeout(()=>finish(Error('Đọc Excel quá 120 giây.')),120000);w.once('message',m=>finish(m.error?Error(m.error):null,m.value));w.once('error',e=>finish(Error('Không đọc được Excel: '+e.message)));w.once('exit',()=>finish(Error('Chưa đọc xong Excel.')));});}
if(!isMainThread&&workerData?.heatsink){try{parentPort.postMessage({value:parseHeatsink(workerData.buffer)});}catch(e){parentPort.postMessage({error:e.message});}parentPort.close();}
