import { renderReportSheet,reportStyles } from './report-layout.mjs';
import { reportDrawings } from './report-images.mjs';
export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(cell.trim()); cell = ''; closed = false;
      if (c !== ',') {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
      }
    } else if (c === '"' && !cell && !closed) quoted = true;
    else { if (closed || c === '"') throw new Error('CSV có dấu nháy không hợp lệ.'); cell += c; }
  }
  if (quoted) throw new Error('CSV thiếu dấu nháy đóng.');
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}
const xml = text => String(text ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const crcTable = Array.from({ length: 256 }, (_, i) => {
  for (let j = 0; j < 8; j++) i = (i & 1) ? 0xedb88320 ^ (i >>> 1) : i >>> 1;
  return i >>> 0;
});
function crc32(data) { let crc = 0xffffffff; for (const b of data) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function zip(files) {
  const chunks = [], directory = []; let offset = 0;
  for (const [path, source] of Object.entries(files)) {
    const name = Buffer.from(path), data = Buffer.from(source), crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt16LE(33, 12);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(33, 14);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    chunks.push(head, name, data); directory.push(entry, name); offset += head.length + name.length + data.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22), count = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, central, end]);
}
export function excel(rows) {return excelWorkbook([{name:'Work Area',rows}]);}
export function reportWorkbook(sheets,metadata={}){return excelWorkbook(sheets,{...metadata,generatedAt:metadata.generatedAt||new Date()});}
export function excelWorkbook(sheets,metadata=null) {
  const column = n => { let r = ''; for (n++; n; n = Math.floor((n - 1) / 26)) r = String.fromCharCode(65 + (n - 1) % 26) + r; return r; };
  const parts={},printDefinitions=[];
  sheets.forEach((sheet,index)=>{if(metadata)return;const data=sheet.rows.map((row,i)=>`<row r="${i+1}">${row.map((v,j)=>typeof v==='number'?`<c r="${column(j)}${i+1}"><v>${v}</v></c>`:`<c r="${column(j)}${i+1}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join('')}</row>`).join('');parts[`xl/worksheets/sheet${index+1}.xml`]=`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${data}</sheetData></worksheet>`;});
  const files={
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Work Area" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  };
  files['[Content_Types].xml']=files['[Content_Types].xml'].replace(/<Override PartName="\/xl\/worksheets\/sheet1.xml"[^>]*\/>/,sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join(''));
  files['xl/workbook.xml']=files['xl/workbook.xml'].replace(/<sheets>.*?<\/sheets>/,`<sheets>${sheets.map((s,i)=>`<sheet name="${xml(s.name.slice(0,31))}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets>`);
  files['xl/_rels/workbook.xml.rels']=files['xl/_rels/workbook.xml.rels'].replace(/<Relationship Id="rId1"[^>]*\/>/,sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join(''));
  delete files['xl/worksheets/sheet1.xml'];
  if(metadata){
    sheets.forEach((sheet,index)=>{
      const rendered=renderReportSheet(sheet,index,metadata),name=sheet.name.slice(0,31).replace(/'/g,"''");
      parts[`xl/worksheets/sheet${index+1}.xml`]=rendered.xml;
      if(rendered.relations)parts[`xl/worksheets/_rels/sheet${index+1}.xml.rels`]=rendered.relations;
      if(sheet.images?.length){
        const drawing=reportDrawings(sheet.images,index),relPath=`xl/worksheets/_rels/sheet${index+1}.xml.rels`;
        Object.assign(parts,drawing.parts);
        const relationship=`<Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${index+1}.xml"/>`;
        parts[relPath]=(parts[relPath]||'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>').replace('</Relationships>',relationship+'</Relationships>');
        parts[`xl/worksheets/sheet${index+1}.xml`]=parts[`xl/worksheets/sheet${index+1}.xml`].replace('</worksheet>','<drawing r:id="rIdDrawing"/></worksheet>');
        files['[Content_Types].xml']=files['[Content_Types].xml'].replace('</Types>',`<Override PartName="/xl/drawings/drawing${index+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
        for(const [ext,type]of drawing.types)if(!files['[Content_Types].xml'].includes(`Extension="${ext}"`))files['[Content_Types].xml']=files['[Content_Types].xml'].replace('</Types>',`<Default Extension="${ext}" ContentType="${type}"/></Types>`);
      }
      printDefinitions.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${index}">${xml(`'${name}'!$1:$7`)}</definedName>`,`<definedName name="_xlnm.Print_Area" localSheetId="${index}">${xml(`'${name}'!$A$1:$${rendered.lastColumn}$${rendered.lastRow}`)}</definedName>`);
    });
    parts['xl/styles.xml']=reportStyles;
    files['[Content_Types].xml']=files['[Content_Types].xml'].replace('</Types>','<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>');
    files['xl/_rels/workbook.xml.rels']=files['xl/_rels/workbook.xml.rels'].replace('</Relationships>',`<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    files['_rels/.rels']=files['_rels/.rels'].replace('</Relationships>','<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>');
    files['xl/workbook.xml']=files['xl/workbook.xml'].replace('</workbook>',`<definedNames>${printDefinitions.join('')}</definedNames></workbook>`);
    parts['docProps/core.xml']=`<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(metadata.title||'Work Area Report')}</dc:title><dc:creator>${xml(metadata.exportedBy||'Work Area')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${metadata.generatedAt.toISOString()}</dcterms:created></cp:coreProperties>`;
    parts['docProps/app.xml']='<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Work Area</Application><Company>HANSOL / HEVH</Company></Properties>';
  }
  return zip({...files,...parts});
}

// Stream one image at a time; only the small ZIP directory stays in memory.
export async function streamZip(destination,entries){
  let offset=0,count=0;const directory=[];
  async function write(chunk){if(destination.destroyed)throw Error('Download closed');await new Promise((resolve,reject)=>destination.write(chunk,error=>error?reject(error):resolve()));}
  for await(const file of entries){
    const name=Buffer.from(file.name),data=Buffer.from(file.data),crc=crc32(data);
    if(++count>65535||offset+data.length+name.length+30>0xffffffff)throw Error('ZIP32 archive too large');
    const head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt32LE(crc,14);head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(name.length,26);
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);
    directory.push(entry,name);await write(head);await write(name);await write(data);offset+=30+name.length+data.length;
  }
  const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);await write(central);await write(end);destination.end();
}
