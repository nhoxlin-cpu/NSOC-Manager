import XLSX from './vendor/sheetjs-0.20.3.cjs';
import { Worker,isMainThread,parentPort,workerData } from 'node:worker_threads';
const key=v=>String(v??'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
const clean=v=>String(v??'').trim();
const flat={modelcode:'model_code',modelname:'model_name',mi1:'mi_1',mi1st:'mi_1',micode1st:'mi_1',mi2:'mi_2',mi2nd:'mi_2',micode2nd:'mi_2',ai1:'ai_1',ai1st:'ai_1',aicode1st:'ai_1',ai2:'ai_2',ai2nd:'ai_2',aicode2nd:'ai_2',itemname:'item_name',itemname1st:'item_name',maker1:'maker_1',maker1st:'maker_1',maker2:'maker_2',maker2nd:'maker_2',itemqtybom:'qty',bomqty:'qty',qty:'qty',location:'location',fcntofg:'fcn',fcn:'fcn'};
export function parseCuttingWorkbook(buffer){
  buffer=Buffer.from(buffer);
  if(!buffer.length||buffer.length>32*1024*1024)throw Error('Bảng quy đổi tối đa 32 MB.');
  if(!buffer.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex'))&&!buffer.subarray(0,4).equals(Buffer.from('504b0304','hex')))throw Error('Chọn file .xls hoặc .xlsx hợp lệ.');
  const wb=XLSX.read(buffer,{type:'buffer',dense:true,cellFormula:false,cellHTML:false,cellText:true,cellNF:true,WTF:true});
  if(!wb.SheetNames.length||wb.SheetNames.length>100)throw Error('Bảng quy đổi cần 1–100 sheet.');
  const pairs=[],sheets=[];
  for(const name of wb.SheetNames){
    const ws=wb.Sheets[name];if(!ws?.['!ref']){sheets.push({name,pairs:0,empty:true});continue;}
    const range=XLSX.utils.decode_range(ws['!ref']);if(range.e.r>100000||range.e.c>127)throw Error(`Sheet ${name} quá lớn.`);
    const cell=(r,c,merged=false)=>{
      if(r<0)return undefined;
      if(merged){const m=(ws['!merges']||[]).find(m=>r>=m.s.r&&r<=m.e.r&&c>=m.s.c&&c<=m.e.c);if(m){r=m.s.r;c=m.s.c;}}
      return ws['!data']?.[r]?.[c]??ws[XLSX.utils.encode_cell({r,c})];
    };
    const value=(r,c,merged=false)=>{const v=cell(r,c,merged);if(!v)return '';if(v.t==='n'&&v.z&&/^0+$/.test(v.z))return XLSX.utils.format_cell(v);return clean(v.v);};
    let header=-1,map;
    for(let r=0;r<=Math.min(99,range.e.r);r++){
      const candidate=[];
      for(let c=0;c<=range.e.c;c++){
        const leaf=key(value(r,c,true)),above=[key(value(r-1,c,true)),key(value(r-2,c,true))];
        let field=flat[leaf]||(leaf==='maker2st'?'maker_2':null);
        if(/^itemcode(1st|2nd|2st)$/.test(leaf)){
          const group=above.find(v=>v==='micode'||v==='aicode');if(group)field=(group==='micode'?'mi_':'ai_')+(leaf.endsWith('1st')?'1':'2');
        }
        candidate[c]=field||null;
      }
      if(candidate.includes('mi_1')&&candidate.includes('ai_1')){const known=candidate.filter(Boolean);if(new Set(known).size!==known.length)continue;header=r;map=candidate;break;}
    }
    if(header<0){let nonempty=false;for(let r=0;r<=range.e.r;r++){for(let c=0;c<=range.e.c;c++)if(value(r,c)){nonempty=true;break;}if(nonempty)break;}if(!nonempty){sheets.push({name,pairs:0,empty:true});continue;}throw Error(`Sheet ${name}: chưa tìm thấy cột MI 1st / AI 1st. Chưa nhập bảng quy đổi.`);}
    let count=0;
    for(let r=header+1;r<=range.e.r;r++){
      const labels=Array.from({length:range.e.c+1},(_,c)=>key(value(r,c)));
      if(labels.includes('vnmanager')||labels.filter(v=>['plan','me','mim','iqc','pqc','qe','production','oqc'].includes(v)).length>=3)break;
      const record=Object.fromEntries(map.flatMap((f,c)=>f?[[f,value(r,c,f==='model_code'||f==='model_name')]]:[]));
      for(const variant of [1,2]){
        const code=f=>{const v=clean(record[f]).toUpperCase();return ['-','—','N/A'].includes(v)?'':v;};
        const mi=code('mi_'+variant),ai=code('ai_'+variant);if(!mi&&!ai)continue;
        if(!mi||!ai)throw Error(`Sheet ${name}, dòng ${r+1}: thiếu MI hoặc AI của cặp ${variant===1?'1st':'2nd'}.`);
        if(mi.length>200||ai.length>200)throw Error(`Sheet ${name}, dòng ${r+1}: mã quá dài.`);
        const pair={model_code:clean(record.model_code).toUpperCase(),model_name:clean(record.model_name),mi_code:mi,ai_code:ai,variant,item_name:clean(record.item_name),maker:clean(record['maker_'+variant]),qty:clean(record.qty),location:clean(record.location),fcn:clean(record.fcn),source_sheet:name,source_row:r+1};
        if(Object.values(pair).some(v=>typeof v==='string'&&v.length>2000))throw Error(`Sheet ${name}, dòng ${r+1}: dữ liệu quá dài.`);
        pairs.push(pair);count++;if(pairs.length>100000)throw Error('Bảng quy đổi tối đa 100.000 cặp.');
      }
    }
    sheets.push({name,pairs:count,headerRow:header+1});
  }
  if(!pairs.length)throw Error('Chưa có cặp AI / MI hợp lệ trong file.');
  return {pairs,sheets};
}
export function parseCuttingInWorker(buffer){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL(import.meta.url),{workerData:{cutting:true,buffer},resourceLimits:{maxOldGenerationSizeMb:768}});let done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);worker.terminate();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(Error('Đọc bảng quy đổi quá 90 giây.')),90000);
    worker.once('message',m=>finish(m.error?Error(m.error):null,m.value));worker.once('error',()=>finish(Error('Không đọc được bảng quy đổi.')));worker.once('exit',()=>{if(!done)finish(Error('Chưa đọc xong bảng quy đổi.'));});
  });
}
if(!isMainThread&&workerData?.cutting){try{parentPort.postMessage({value:parseCuttingWorkbook(workerData.buffer)});}catch(e){parentPort.postMessage({error:e.message});}parentPort.close();}
