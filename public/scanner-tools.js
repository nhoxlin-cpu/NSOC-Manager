const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
export function fitScanRect(rect,width,height,square=false) {
  width=Math.max(1,width); height=Math.max(1,height);
  let w=clamp(rect.w,Math.min(120,width),width),h=clamp(rect.h,Math.min(70,height),height);
  if (square) w=h=Math.min(Math.max(96,Math.min(w,h)),width,height);
  return {x:clamp(rect.x,0,width-w),y:clamp(rect.y,0,height-h),w,h};
}
export function resizeScanRect(rect,corner,dx,dy,width,height,square=false) {
  const left=corner.includes('l'),top=corner.includes('t');
  const anchorX=left ? rect.x+rect.w : rect.x,anchorY=top ? rect.y+rect.h : rect.y;
  let w=rect.w+(left ? -dx : dx),h=rect.h+(top ? -dy : dy);
  if (square) w=h=Math.max(w,h);
  w=clamp(w,Math.min(square?96:120,width),left?anchorX:width-anchorX);
  h=clamp(h,Math.min(square?96:70,height),top?anchorY:height-anchorY);
  if (square) w=h=Math.min(w,h);
  return fitScanRect({x:left?anchorX-w:anchorX,y:top?anchorY-h:anchorY,w,h},width,height,square);
}
// Local grayscale contrast normalization. It expands weak, still-present detail;
// clipped white reflections contain no recoverable barcode information.
export function enhanceGlare(image,{invert=false}={}) {
  const {width,height,data}=image,tile=64,cols=Math.ceil(width/tile),rows=Math.ceil(height/tile);
  const gray=new Uint8Array(width*height),maps=[],highlights=new Uint32Array(256);let brightCount=0;
  for (let i=0;i<gray.length;i++) {const value=Math.round(data[i*4]*.299+data[i*4+1]*.587+data[i*4+2]*.114);gray[i]=value;if(value>=160){highlights[value]++;brightCount++;}}
  if(brightCount>gray.length*.03){
    let sum=0,lo=160,hi=255;for(let v=160;v<256;v++){sum+=highlights[v];if(sum>=brightCount*.02){lo=v;break;}}
    sum=0;for(let v=255;v>=160;v--){sum+=highlights[v];if(sum>=brightCount*.02){hi=v;break;}}
    // A glossy light label can have both bars and background in a narrow bright
    // band; isolate that band instead of letting a dark workbench set its levels.
    if(hi-lo>=6&&hi-lo<=90){for(let i=0;i<gray.length;i++){let value=clamp(Math.round((gray[i]-lo)*255/(hi-lo)),0,255);if(invert)value=255-value;data[i*4]=data[i*4+1]=data[i*4+2]=value;}return image;}
  }
  for (let ty=0;ty<rows;ty++) for(let tx=0;tx<cols;tx++) {
    const hist=new Uint32Array(256),x0=tx*tile,y0=ty*tile,x1=Math.min(width,x0+tile),y1=Math.min(height,y0+tile),count=(x1-x0)*(y1-y0);
    for (let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) hist[gray[y*width+x]]++;
    let sum=0,lo=0,hi=255;
    for(let v=0;v<256;v++){sum+=hist[v];if(sum>=count*.02){lo=v;break;}}
    sum=0;for(let v=255;v>=0;v--){sum+=hist[v];if(sum>=count*.02){hi=v;break;}}
    const map=new Uint8Array(256);
    for(let v=0;v<256;v++) map[v]=hi-lo>=6 ? clamp(Math.round((v-lo)*255/(hi-lo)),0,255) : v;
    maps.push(map);
  }
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const gx=clamp(x/tile-.5,0,cols-1),gy=clamp(y/tile-.5,0,rows-1),x0=Math.floor(gx),y0=Math.floor(gy),x1=Math.min(cols-1,x0+1),y1=Math.min(rows-1,y0+1),fx=gx-x0,fy=gy-y0,v=gray[y*width+x];
    const a=maps[y0*cols+x0][v]*(1-fx)+maps[y0*cols+x1][v]*fx,b=maps[y1*cols+x0][v]*(1-fx)+maps[y1*cols+x1][v]*fx;
    let value=Math.round(a*(1-fy)+b*fy);if(invert)value=255-value;
    const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=value;
  }
  return image;
}
