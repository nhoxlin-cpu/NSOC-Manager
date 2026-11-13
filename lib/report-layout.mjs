const x=v=>String(v??'').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
export const columnName=n=>{let result='';for(n++;n;n=Math.floor((n-1)/26))result=String.fromCharCode(65+(n-1)%26)+result;return result;};
const font=(color,bold=false,size=10)=>`<font><sz val="${size}"/><color rgb="FF${color}"/><name val="Aptos"/>${bold?'<b/>':''}</font>`;
const fill=color=>`<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill>`;
const xf=(fontId,fillId,numFmtId=0,center=false)=>`<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="1" xfId="0" applyAlignment="1" applyFill="1" applyFont="1"${numFmtId?' applyNumberFormat="1"':''}><alignment vertical="center" horizontal="${center?'center':numFmtId?'right':'left'}" wrapText="1"/></xf>`;
export const reportStyles=`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.###;[Red](#,##0.###);–"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/></numFmts><fonts count="9">${font('263E50')}${font('FFFFFF',true)}${font('FFFFFF',true,20)}${font('153B54',true,11)}${font('6B8191',false,9)}${font('18744C',true)}${font('B33845',true)}${font('946016',true)}${font('236FA1')}</fonts><fills count="9"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fill('12364D')}${fill('EAF2F8')}${fill('F4F7FA')}${fill('245571')}${fill('E3F3EA')}${fill('FCE9EB')}${fill('FFF2D9')}</fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFE1E8EF"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="20">${xf(0,0)}${xf(0,4)}${xf(0,4,164)}${xf(0,0,164)}${xf(1,5,0,true)}${xf(1,2)}${xf(2,2)}${xf(4,3)}${xf(4,0)}${xf(3,3)}${xf(5,6,0,true)}${xf(6,7,0,true)}${xf(7,8,0,true)}${xf(0,0,165)}${xf(0,4,165)}${xf(8,0)}${xf(8,4)}${xf(3,0)}<xf numFmtId="0" fontId="8" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="bottom" horizontal="center" wrapText="1"/></xf><xf numFmtId="0" fontId="8" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="bottom" horizontal="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const statusStyle=value=>/^(PASS|ĐỦ|KHỚP|KHÔNG TRÙNG)$/i.test(String(value))?10:/^(NG|DƯ|SAI|TRÙNG)$/i.test(String(value))?11:/^(THIẾU|CHƯA GHI|NGOÀI SO)$/i.test(String(value))?12:null;
function width(header,rows,col){
  if(/description|mô tả|ghi chú|spec/i.test(header))return 44;
  if(/ảnh|image/i.test(header))return 23;
  if(/thời gian|giờ scan|ngày|date/i.test(header))return 23;
  if(/samsung|barcode|item|box|phiếu|lô/i.test(header))return Math.min(30,Math.max(20,header.length+3));
  if(/số lượng|qty|moq|đã bán|còn thiếu|tổng|lượt|^ng$|^id$|stt/i.test(header))return Math.min(21,Math.max(12,header.length*.75+3));
  const length=Math.max(header.length,...rows.slice(0,250).map(r=>String(r[col]??'').length));return Math.min(34,Math.max(17,length+2));
}
export function renderReportSheet(sheet,index,metadata){
  const source=sheet.rows||[],headers=(source[0]||['Nội dung']).map(h=>String(h).replace(/Thời gian UTC/g,'Thời gian (GMT+7)').replace(/Giờ scan UTC/g,'Giờ scan (GMT+7)'));
  const data=source.slice(1),cols=headers.length,last=columnName(cols-1),widths=headers.map((h,i)=>width(h,data,i)),relations=[],links=[];
  const imageCells=new Set((sheet.images||[]).map(i=>i.row+'|'+i.col)),imageRows=new Set((sheet.images||[]).map(i=>i.row));
  const now=metadata.generatedAt||new Date(),stamp=new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'short'}).format(now);
  const textCell=(ref,value,style)=>`<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${x(value)}</t></is></c>`;
  function fullRow(row,value,style,height){return `<row r="${row}" ht="${height}" customHeight="1">${Array.from({length:cols},(_,i)=>textCell(columnName(i)+row,i?'':value,style)).join('')}</row>`;}
  let content=fullRow(1,'HANSOL  /  HEVH  ·  WORK AREA',5,23)+fullRow(2,metadata.title||'BÁO CÁO CÔNG VIỆC',6,38)+fullRow(3,[sheet.title||sheet.name,metadata.scope].filter(Boolean).join('  •  '),7,28)+fullRow(4,`Xuất: ${stamp} (GMT+7)${metadata.exportedBy?'  |  Người xuất: '+metadata.exportedBy:''}`,8,22)+fullRow(5,sheet.summary||`${data.length.toLocaleString('vi-VN')} dòng dữ liệu${metadata.summary?'  |  '+metadata.summary:''}`,9,28)+`<row r="6" ht="10" customHeight="1"/>`;
  content+=`<row r="7" ht="34" customHeight="1">${headers.map((h,i)=>textCell(columnName(i)+'7',h,4)).join('')}</row>`;
  data.forEach((row,rowIndex)=>{
    const rowNumber=rowIndex+8,stripe=rowIndex%2!==0;let lines=1;
    const cells=headers.map((header,col)=>{
      let value=row[col]??'',style=stripe?1:0,type=typeof value==='number'?'number':'text';const ref=columnName(col)+rowNumber;
      if(type==='number'){if(!Number.isFinite(value))value='';else style=stripe?2:3;}
      if(/thời gian|giờ scan|ngày|date/i.test(header)&&typeof value==='string'&&/^\d{4}-\d\d-\d\d(?:[ T]\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)?)?$/.test(value)){
        const utc=/[Zz]|[+-]\d\d:\d\d$/.test(value)?value:value.replace(' ','T')+(value.length===10?'T00:00:00Z':'Z');const time=Date.parse(utc);if(Number.isFinite(time)){value=(time+7*3600000)/86400000+25569;style=stripe?14:13;type='number';}
      }
      const status=/kết quả|trạng thái|maker khớp|nhãn số lượng|bán đủ/i.test(header)?statusStyle(value):null;if(status!==null)style=status;
      if(/^maker bán/i.test(header)){const matchIndex=headers.findIndex(h=>/maker khớp/i.test(h));if(matchIndex>=0)style=statusStyle(row[matchIndex])??12;}
      if(metadata.imageLinks&&/^ảnh /i.test(header)&&typeof value==='string'&&/^images\/[\w./-]+$/.test(value)&&!value.includes('..')){
        const id='rId'+(relations.length+1);relations.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${x(value)}" TargetMode="External"/>`);links.push(`<hyperlink ref="${ref}" r:id="${id}"/>`);value='Mở ảnh · #'+row[0];style=stripe?16:15;
      }
      if(imageCells.has(rowNumber+'|'+col))style=stripe?19:18;lines=Math.max(lines,Math.ceil(String(value).length/Math.max(8,widths[col]-2)));
      return type==='number'&&typeof value==='number'?`<c r="${ref}" s="${style}"><v>${value}</v></c>`:textCell(ref,value,style);
    }).join('');content+=`<row r="${rowNumber}" ht="${Math.min(120,Math.max(imageRows.has(rowNumber)?96:27,lines*15+8))}" customHeight="1">${cells}</row>`;
  });
  if(!data.length)content+=fullRow(8,'Chưa có dữ liệu trong phạm vi báo cáo.',8,32);
  const end=Math.max(8,data.length+7),merges=Array.from({length:5},(_,i)=>cols>1?`<mergeCell ref="A${i+1}:${last}${i+1}"/>`:'').join('')+(!data.length&&cols>1?`<mergeCell ref="A8:${last}8"/>`:'');
  const sheetXml=`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><tabColor rgb="FF${index===0?'217D70':'245571'}"/><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}${end}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0" zoomScale="85"><pane xSplit="${cols>3?2:0}" ySplit="7" topLeftCell="${cols>3?'C':'A'}8" activePane="${cols>3?'bottomRight':'bottomLeft'}" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="27"/><cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${content}</sheetData><autoFilter ref="A7:${last}${Math.max(7,data.length+7)}"/>${merges?`<mergeCells count="${5+(data.length?0:1)}">${merges}</mergeCells>`:''}${links.length?`<hyperlinks>${links.join('')}</hyperlinks>`:''}<printOptions horizontalCentered="1"/><pageMargins left="0.3" right="0.3" top="0.45" bottom="0.45" header="0.2" footer="0.2"/><pageSetup paperSize="${cols>12?8:9}" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddHeader>&amp;L&amp;9HANSOL · HEVH&amp;R&amp;9${x(sheet.title||sheet.name)}</oddHeader><oddFooter>&amp;L&amp;8Work Area · Nội bộ&amp;R&amp;8Trang &amp;P / &amp;N</oddFooter></headerFooter></worksheet>`;
  return {xml:sheetXml,lastRow:end,lastColumn:last,relations:relations.length?`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations.join('')}</Relationships>`:null};
}
