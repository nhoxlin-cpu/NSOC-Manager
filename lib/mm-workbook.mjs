import XLSX from './vendor/sheetjs-0.20.3.cjs';
import { Worker,isMainThread,parentPort,workerData } from 'node:worker_threads';

export const MAX_MM_BYTES=32*1024*1024;
const aliases={sl:'storage_location',location:'location',itemcd:'item_code',itemcode:'item_code',itemnm:'item_name',itemname:'item_name',spec:'spec',description:'spec',barcodeno:'barcode',barcode:'barcode',qty:'qty',quantity:'qty',receiptdt:'receipt_date',receiptdate:'receipt_date',bpcd:'vendor_code',bpnm:'vendor',vendor:'vendor',custlblno:'customer_label',lotno:'lot_no',maker:'maker',mark:'maker',labelsts:'label_status'};
const key=value=>String(value??'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
const text=value=>value instanceof Date?value.toISOString().slice(0,10):String(value??'').trim();
const fields=['barcode','item_code','item_name','spec','location','qty'];

export function parseMMWorkbook(buffer){
  if(buffer instanceof Uint8Array&&!Buffer.isBuffer(buffer))buffer=Buffer.from(buffer);
  if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>MAX_MM_BYTES)throw Error('File MM tối đa 32 MB.');
  const ole=buffer.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')),zip=buffer.subarray(0,4).equals(Buffer.from('504b0304','hex'));
  if(!ole&&!zip)throw Error('Chọn file Excel .xls hoặc .xlsx hợp lệ.');
  const wb=XLSX.read(buffer,{type:'buffer',dense:true,cellDates:true,cellFormula:false,cellHTML:false,cellText:false,cellStyles:false,WTF:true});
  if(!wb.SheetNames.length||wb.SheetNames.length>100)throw Error('File MM cần có từ 1 đến 100 sheet.');
  const rows=[],sheets=[],barcodes=new Set();
  for(const name of wb.SheetNames){
    const ws=wb.Sheets[name];if(!ws?.['!ref']){sheets.push({name,rows:0,empty:true,totalRows:0});continue;}
    const range=XLSX.utils.decode_range(ws['!ref']);
    if(range.e.r>300000||range.e.c>255)throw Error(`Sheet ${name}: vượt giới hạn 300.000 dòng / 256 cột.`);
    const data=ws['!data'];
    const rowAt=r=>{const row=[];for(let c=0;c<=range.e.c;c++)row[c]=data?.[r]?.[c]?.v??ws[XLSX.utils.encode_cell({r,c})]?.v??'';return row;};
    let header=-1,map;
    for(let r=0;r<=Math.min(range.e.r,99);r++){
      const candidate=rowAt(r).map(v=>aliases[key(v)]||null);
      if(fields.every(f=>candidate.includes(f))){
        const known=candidate.filter(Boolean);if(new Set(known).size!==known.length)throw Error(`Sheet ${name}: tiêu đề cột trùng.`);
        header=r;map=candidate;break;
      }
    }
    if(header<0){
      let nonempty=false;for(let r=0;r<=range.e.r;r++){if(rowAt(r).some(v=>text(v))){nonempty=true;break;}}
      if(!nonempty){sheets.push({name,rows:0,empty:true,totalRows:0});continue;}
      throw Error(`Sheet ${name}: chưa tìm thấy tiêu đề LOCATION, ITEM CD, ITEM NM, SPEC, BARCODE_NO, QTY trong 100 dòng đầu. Chưa nhập sheet nào.`);
    }
    let count=0,totalRows=0,last=range.e.r;
    while(last>header&&!rowAt(last).some(v=>text(v)))last--;
    for(let r=header+1;r<=last;r++){
      const cells=rowAt(r);if(!cells.some(v=>text(v)))continue;
      if(cells.every((v,c)=>!text(v)||map[c]==='qty')&&r===last){totalRows++;continue;}
      const record=Object.fromEntries(map.flatMap((f,c)=>f?[[f,text(cells[c])]]:[]));
      for(const f of ['barcode','item_code','item_name'])if(!record[f])throw Error(`Sheet ${name}, dòng ${r+1}: thiếu ${f}. Chưa nhập sheet nào.`);
      record.barcode=record.barcode.toUpperCase();record.item_code=record.item_code.toUpperCase();
      if(barcodes.has(record.barcode))throw Error(`Sheet ${name}, dòng ${r+1}: BARCODE_NO trùng trong file. Chưa nhập sheet nào.`);
      barcodes.add(record.barcode);
      const qty=Number(record.qty.replace(/,/g,''));if(!Number.isFinite(qty)||qty<=0||qty>1e9)throw Error(`Sheet ${name}, dòng ${r+1}: QTY phải lớn hơn 0 và không quá 1 tỷ.`);
      record.qty=qty;record.source_sheet=name;record.source_row=r+1;
      for(const [f,v]of Object.entries(record))if(typeof v==='string'&&v.length>2000)throw Error(`Sheet ${name}, dòng ${r+1}: cột ${f} quá dài.`);
      rows.push(record);count++;if(rows.length>250000)throw Error('File MM tối đa 250.000 dòng dữ liệu; chưa nhập sheet nào.');
    }
    sheets.push({name,rows:count,headerRow:header+1,totalRows});
  }
  if(!rows.length)throw Error('File MM không có dòng dữ liệu.');
  return {rows,sheets};
}

export function parseMMInWorker(buffer){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL(import.meta.url),{workerData:{mm:true,buffer},resourceLimits:{maxOldGenerationSizeMb:768}});
    let done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);worker.terminate();if(error)reject(error);else resolve(value);};
    const timer=setTimeout(()=>finish(Error('Đọc file MM quá 90 giây. Hãy chia file và thử lại.')),90000);
    worker.once('message',msg=>finish(msg.error?Error(msg.error):null,msg.value));
    worker.once('error',()=>finish(Error('Không đọc được file MM hoặc file vượt bộ nhớ cho phép.')));
    worker.once('exit',code=>{if(!done)finish(Error('Tiến trình đọc MM kết thúc trước khi đọc đủ các sheet.'));});
  });
}
if(!isMainThread&&workerData?.mm){
  try{parentPort.postMessage({value:parseMMWorkbook(Buffer.from(workerData.buffer))});}catch(e){parentPort.postMessage({error:e.message});}
  parentPort.close();
}
