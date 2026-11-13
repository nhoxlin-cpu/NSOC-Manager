import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fitScanRect,resizeScanRect,enhanceGlare} from '../public/scanner-tools.js';

test('moving the scan area stays inside the available view and QR stays square',()=>{
  assert.deepEqual(fitScanRect({x:-90,y:500,w:200,h:90},320,240),{x:0,y:150,w:200,h:90});
  const qr=fitScanRect({x:500,y:-20,w:260,h:130},320,200,true);assert.equal(qr.w,qr.h);assert.ok(qr.x>=0&&qr.y>=0&&qr.x+qr.w<=320&&qr.y+qr.h<=200);
});
test('resizing holds the opposite corner and clamps oversized or tiny regions',()=>{
  const initial={x:40,y:30,w:200,h:100};const changed=resizeScanRect(initial,'tl',20,10,320,240);
  assert.equal(changed.x+changed.w,initial.x+initial.w);assert.equal(changed.y+changed.h,initial.y+initial.h);
  for(const corner of ['tl','tr','bl','br'])for(const delta of [-1000,1000]){const r=resizeScanRect(initial,corner,delta,delta,320,240);assert.ok(r.x>=0&&r.y>=0&&r.w>0&&r.h>0&&r.x+r.w<=320&&r.y+r.h<=240);}
});
test('glare processing leaves clipped white pixels white instead of inventing detail',()=>{
  const data=new Uint8ClampedArray(128*64*4).fill(255);enhanceGlare({width:128,height:64,data});assert.ok(data.every(v=>v===255));
});
