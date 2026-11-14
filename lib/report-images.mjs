const esc=v=>String(v??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
function dimensions(bytes,mime){
  if(mime==='image/png'&&bytes.length>=24)return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
  if(mime==='image/jpeg'){
    let pos=2;while(pos+9<bytes.length){if(bytes[pos++]!==255)continue;const marker=bytes[pos++];if(marker===216||marker===217)continue;const size=bytes.readUInt16BE(pos);if(size<2)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return [bytes.readUInt16BE(pos+5),bytes.readUInt16BE(pos+3)];pos+=size;}
  }return [128,128];
}
export function reportDrawings(images,index){
  const parts={},rels=[],pictures=[],types=new Map();
  images.forEach((image,i)=>{
    const data=Buffer.from(image.data),ext=image.mime==='image/png'?'png':image.mime==='image/webp'?'webp':'jpg',name=`report${index+1}image${i+1}.${ext}`;
    const [w,h]=dimensions(data,image.mime),scale=Math.min(112/Math.max(1,w),88/Math.max(1,h)),width=Math.max(1,Math.round(w*scale)),height=Math.max(1,Math.round(h*scale));
    parts['xl/media/'+name]=data;types.set(ext,image.mime);
    rels.push(`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${name}"/>`);
    pictures.push(`<xdr:oneCellAnchor><xdr:from><xdr:col>${image.col}</xdr:col><xdr:colOff>${Math.max(8,Math.round((161-width)/2))*9525}</xdr:colOff><xdr:row>${image.row-1}</xdr:row><xdr:rowOff>57150</xdr:rowOff></xdr:from><xdr:ext cx="${width*9525}" cy="${height*9525}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i+1}" name="Image ${i+1}" descr="${esc(image.alt||'Ảnh đối chiếu')}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${i+1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width*9525}" cy="${height*9525}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`);
  });
  parts[`xl/drawings/drawing${index+1}.xml`]=`<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${pictures.join('')}</xdr:wsDr>`;
  parts[`xl/drawings/_rels/drawing${index+1}.xml.rels`]=`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`;
  return {parts,types};
}
