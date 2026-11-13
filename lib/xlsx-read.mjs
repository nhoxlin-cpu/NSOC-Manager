import { inflateRawSync } from 'node:zlib';

const decode = s => s.replace(/&#x([\da-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi,(_,hex,num,key)=>hex||num?String.fromCodePoint(parseInt(hex||num,hex?16:10)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[key.toLowerCase()]));
const attrs = s => Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));
const texts = xml => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m=>decode(m[1])).join('');
export function readWorkbook(buffer) {
  if(!Buffer.isBuffer(buffer)||buffer.length>18*1024*1024)throw Error('File Excel tối đa 18 MB.');
  let end=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)throw Error('File không phải XLSX hợp lệ.');
  const entries=new Map();let pos=buffer.readUInt32LE(end+16);const count=buffer.readUInt16LE(end+10);
  if(count>2000||buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6))throw Error('Excel có cấu trúc ZIP không được hỗ trợ.');
  for(let i=0;i<count;i++){
    if(pos+46>buffer.length||buffer.readUInt32LE(pos)!==0x02014b50)throw Error('ZIP hỏng.');
    const n=buffer.readUInt16LE(pos+28),extra=buffer.readUInt16LE(pos+30),comment=buffer.readUInt16LE(pos+32);
    const name=buffer.toString('utf8',pos+46,pos+46+n);
    if(entries.has(name))throw Error('ZIP có mục trùng.');
    entries.set(name,{method:buffer.readUInt16LE(pos+10),flags:buffer.readUInt16LE(pos+8),size:buffer.readUInt32LE(pos+24),compressed:buffer.readUInt32LE(pos+20),offset:buffer.readUInt32LE(pos+42)});pos+=46+n+extra+comment;
  }
  let expanded=0;
  function read(name,optional=false){
    const e=entries.get(name);if(!e){if(optional)return '';throw Error('Thiếu '+name);}
    if(e.flags&1||e.size>24*1024*1024||(expanded+=e.size)>60*1024*1024)throw Error('Excel quá lớn hoặc được mã hóa.');
    const o=e.offset;if(o+30>buffer.length||buffer.readUInt32LE(o)!==0x04034b50)throw Error('ZIP hỏng.');
    const start=o+30+buffer.readUInt16LE(o+26)+buffer.readUInt16LE(o+28);if(start+e.compressed>buffer.length)throw Error('ZIP thiếu dữ liệu.');
    const bytes=buffer.subarray(start,start+e.compressed),data=e.method===0?bytes:e.method===8?inflateRawSync(bytes,{maxOutputLength:24*1024*1024}):null;
    if(!data||data.length!==e.size)throw Error('Không đọc được dữ liệu Excel.');
    const xml=data.toString('utf8');if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('XML Excel không hợp lệ.');return xml;
  }
  const strings=[...read('xl/sharedStrings.xml',true).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m=>texts(m[1]));
  const relations=new Map([...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s([^>]*?)\/?\s*>/g)].map(m=>{const a=attrs(m[1]);return [a.Id,a.Target];}));
  return [...read('xl/workbook.xml').matchAll(/<sheet\s([^>]*?)\/?\s*>/g)].slice(0,2).map(match=>{
    const a=attrs(match[1]),target=relations.get(a['r:id']);if(!target||target.includes('..')||target.includes('://'))throw Error('Đường dẫn sheet không hợp lệ.');
    const name=target.startsWith('/')?target.slice(1):'xl/'+target;
    const rows=[...read(name).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(row=>{
      const result={};for(const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
        const at=attrs(c[1]),body=c[2]||'',v=/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1]||'';
        const value=at.t==='s'?strings[Number(v)]??'':at.t==='inlineStr'?texts(body):decode(v);
        if(at.r)result[at.r.replace(/\d/g,'')]=value;
      }return result;
    });return {name:a.name,rows};
  });
}
