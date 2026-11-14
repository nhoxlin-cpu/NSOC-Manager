import { fitScanRect,fitBarcodeRect,resizeScanRect,enhanceGlare,cameraPoint } from '/scanner-tools.js?v=20261114-19';
import { hsCode } from '/hs-code.js?v=20261114-19';
const symbols = {
  continuous:'<path d="M20 7a9 9 0 0 0-15-3L2 7m0-5v5h5M4 17a9 9 0 0 0 15 3l3-3m0 5v-5h-5"/>',
  back:'<path d="M19 12H5m6-6-6 6 6 6"/>',
  flash:'<path d="m13 2-9 12h7l-1 8L21 9h-8Z"/>',
  sound:'<path d="M11 4 5 9H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  vibration:'<rect x="7" y="3" width="10" height="18" rx="2"/><path d="m3 6-1 3 1 3-1 3 1 3m18-12 1 3-1 3 1 3-1 3M11 18h2"/>',
  barcode:'<path d="M3 4v16M6 4v16M10 4v16M12 4v16M16 4v16M20 4v16"/>',
  qr:'<path d="M3 3h6v6H3Zm12 0h6v6h-6ZM3 15h6v6H3Zm12 0h3v3h3v3h-6Zm-3-3h3m3 0h3M12 3v6m0 9v3"/>',
  check:'<path d="m4 12 5 5L20 6"/>'
  ,glare:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2M3 21 21 3"/>'
};
const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${symbols[name]}</svg>`;
const clean = value => String(value ?? '').trim().toUpperCase();
const pref = (key, fallback) => { try { return localStorage.getItem('wa-scanner-' + key) ?? fallback; } catch { return fallback; } };
const remember = (key, value) => { try { localStorage.setItem('wa-scanner-' + key, String(value)); } catch {} };
let vendorPromise;
export function zxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!vendorPromise) vendorPromise = new Promise((resolve, reject) => {
    const script=document.createElement('script'); script.src='/vendor/zxing-0.21.3.min.js';
    script.onload=() => window.ZXing ? resolve(window.ZXing) : reject(Error('Không khởi tạo được bộ đọc mã.'));
    script.onerror=() => { script.remove(); vendorPromise=null; reject(Error('Không tải được bộ đọc mã. Hãy kiểm tra mạng rồi mở camera lại.')); };
    document.head.append(script);
  });
  return vendorPromise;
}

export class PhoneScanner {
  constructor(dialog, options) {
    this.dialog=dialog; this.options=options; this.epoch=0; this.saved=0; this.queued=0; this.seen=new Map(); this.alerts=[];
    this.pointers=new Map();this.digitalZoom=1;this.opticalZoom=1;this.videoPan={x:0,y:0};this.glare=false;this.framePass=0;
    this.continuous=options.continuous!==false;this.singlePaused=false;this.captured=0;
    this.format=pref('format','barcode') === 'qr' ? 'qr' : 'barcode'; this.sound=pref('sound','true') === 'true'; this.vibration=pref('vibration','true') === 'true';
    this.canvas=document.createElement('canvas'); this.context=this.canvas.getContext('2d',{willReadFrequently:true});
    this.evidenceCanvas=document.createElement('canvas');
    dialog.className='phone-scanner'; dialog.setAttribute('aria-label','Quét mã bằng điện thoại');
    dialog.innerHTML=`<video class="scanner-video" autoplay playsinline muted></video><div class="scanner-shade"></div>
      <div class="scanner-layout"><section class="scanner-top" aria-label="Kết quả quét">
        <div class="scanner-heading"><div><span class="scanner-eyebrow">WORK AREA · QUÉT LIÊN TỤC</span><h2 id="scanner-title"></h2></div><button id="scanner-continuous" class="scanner-continuous" aria-pressed="true">${svg('continuous')}</button></div>
        <p class="scanner-status" id="scanner-status" aria-live="polite">Đang mở camera…</p>
        <div class="scanner-result" id="scanner-result"><span id="scanner-value">Đưa mã vào khung</span><span id="scanner-result-icon"></span></div>
        <dl class="scanner-stock-info" id="scanner-stock-info" hidden></dl>
        <p class="scanner-count" id="scanner-count">Đã lưu 0 lượt trong lần mở camera này</p>
        <div class="scanner-result-actions"><button class="scanner-repeat" id="scanner-repeat" disabled>Quét lại cùng mã</button><button class="scanner-next" id="scanner-next" hidden>Quét mã tiếp theo</button></div>
        <div class="scanner-alerts" id="scanner-alerts" aria-live="polite"></div>
      </section><div class="scanner-body"><div class="scanner-frame" id="scanner-frame" tabindex="0" role="group" aria-label="Vùng quét: kéo để di chuyển, kéo góc để đổi kích thước. Phím mũi tên để di chuyển, cộng trừ để đổi cỡ.">${['tl','tr','bl','br'].map(corner=>`<button type="button" class="scanner-corner ${corner}" data-resize="${corner}" aria-label="Kéo góc ${corner} để thay đổi kích thước vùng quét"></button>`).join('')}<div class="scanner-laser"></div><span class="scanner-frame-label" id="scanner-frame-label">Đặt barcode vào trong khung</span></div></div>
      <section class="scanner-controls" aria-label="Điều khiển camera"><div class="scanner-formats" role="tablist" aria-label="Định dạng mã"><button id="scanner-barcode" role="tab">${svg('barcode')} Barcode</button><button id="scanner-qr" role="tab">${svg('qr')} QR</button></div>
        <div class="scanner-tools"><label class="scanner-zoom-label"><span class="sr-only">Mức phóng đại camera</span><select id="scanner-zoom" aria-label="Mức phóng đại camera" disabled><option value="1">×1</option></select></label><div class="scanner-round-tools"><button class="scanner-round" id="scanner-vibration" aria-label="Rung khi đọc mã">${svg('vibration')}</button><button class="scanner-round" id="scanner-sound" aria-label="Âm thanh khi đọc mã">${svg('sound')}</button></div></div><div class="scanner-assist"><button id="scanner-glare" aria-pressed="false">${svg('glare')} Nhãn bóng / chói</button><button id="scanner-reset-view">Đặt lại khung</button></div><p class="scanner-assist-note" id="scanner-assist-note" hidden></p>
      </section><div class="scanner-bottom"><button class="scanner-back" id="scanner-back" aria-label="Đóng camera">${svg('back')}</button><button class="scanner-manual" id="scanner-manual">Nhập mã bằng tay</button><button class="scanner-flash" id="scanner-flash" aria-label="Bật đèn flash" aria-pressed="false" disabled>${svg('flash')}</button></div></div>`;
    this.$=s => dialog.querySelector(s); this.video=this.$('video');this.$('.scanner-body').append(this.$('#scanner-frame-label'));
    this.$('#scanner-continuous').hidden=options.hideContinuous===true;
    this.$('#scanner-title').textContent=options.title || `Scan ${options.mode}`;
    this.$('#scanner-back').onclick=() => this.close();
    this.$('#scanner-manual').onclick=() => { this.close(); options.onManual?.(); };
    this.$('#scanner-repeat').onclick=() => this.lastCode && this.accept(this.lastRaw||this.lastCode,true,this.lastImage);
    this.$('#scanner-continuous').onclick=()=>this.setContinuous(!this.continuous);
    this.$('#scanner-next').onclick=()=>this.resumeSingle();
    this.$('#scanner-barcode').onclick=() => this.changeFormat('barcode'); this.$('#scanner-qr').onclick=() => this.changeFormat('qr');
    this.$('#scanner-sound').onclick=() => { this.sound=!this.sound; remember('sound',this.sound); this.settings(); if (this.sound) this.feedback(false); };
    this.$('#scanner-vibration').onclick=() => { this.vibration=!this.vibration; remember('vibration',this.vibration); this.settings(); if (this.vibration) navigator.vibrate?.(40); };
    this.$('#scanner-flash').onclick=() => this.flash();
    this.$('#scanner-zoom').onchange=e => this.zoom(Number(e.target.value));
    this.$('#scanner-glare').onclick=()=>this.setGlare(!this.glare);this.$('#scanner-reset-view').onclick=()=>this.resetView();
    this.installGestures();
    this.onClose=() => {if(!dialog.open)this.release();}; dialog.addEventListener('close',this.onClose);
    this.settings(); this.formatUI();this.flowUI();
  }
  async open() {
    this.active=true; const epoch=++this.epoch; this.dialog.showModal(); document.body.classList.add('scanner-open');
    try { this.audio=new (window.AudioContext || window.webkitAudioContext)(); this.audio.resume().catch(()=>{}); } catch {}
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { this.paint('error','Camera cần HTTPS và quyền truy cập camera.'); return; }
    try {
      await Promise.all([this.startVideo(),this.prepareDecoder()]);
      if (!this.active || epoch !== this.epoch) return;
      this.paint('ready',this.options.onCode?'Sẵn sàng · Đọc mã để điền vào mục đã chọn':this.continuous?'Sẵn sàng · Mã mới được tự động lưu':'Quét từng mã · Tự dừng sau một kết quả'); this.loop(epoch);
    } catch(e) { if (this.active && epoch === this.epoch) { this.epoch++; this.releaseStream(); this.paint('error',e.name === 'NotAllowedError' ? 'Chưa được cấp quyền camera. Hãy cho phép camera trong trình duyệt.' : e.name === 'NotFoundError' ? 'Không tìm thấy camera. Bạn có thể nhập mã bằng tay.' : e.message); } }
  }
  settings() {
    for (const [name,on] of [['sound',this.sound],['vibration',this.vibration]]) {
      const b=this.$('#scanner-' + name); b.classList.toggle('enabled',on); b.setAttribute('aria-pressed',String(on));
    }
    if (typeof navigator.vibrate !== 'function') { this.$('#scanner-vibration').disabled=true; this.$('#scanner-vibration').title='Trình duyệt không hỗ trợ rung'; }
  }
  flowUI() {
    const button=this.$('#scanner-continuous');button.setAttribute('aria-pressed',String(this.continuous));button.setAttribute('aria-label','Quét liên tục: '+(this.continuous?'Bật':'Tắt'));button.classList.toggle('enabled',this.continuous);button.title='Quét liên tục: '+(this.continuous?'Bật':'Tắt');
    this.$('.scanner-eyebrow').textContent='WORK AREA · '+(this.continuous?'QUÉT LIÊN TỤC':'QUÉT TỪNG MÃ');this.$('#scanner-next').hidden=!this.singlePaused;
    this.dialog.dataset.scanFlow=this.singlePaused?'paused':this.continuous?'continuous':'single';
  }
  setContinuous(on,notify=true) {
    this.continuous=on;
    if(on)this.singlePaused=false;else if(this.lastCode&&!this.busy)this.singlePaused=true;
    this.flowUI();if(notify)this.options.onContinuousChange?.(on);
  }
  resumeSingle() {
    this.singlePaused=false;this.latched='';this.lastRead='';this.candidate='';this.hits=0;this.candidateTime=0;this.flowUI();this.paint('ready','Sẵn sàng quét mã tiếp theo',this.lastCode);
  }
  formatUI() {
    this.dialog.dataset.format=this.format;
    for (const format of ['barcode','qr']) { const b=this.$('#scanner-' + format); b.classList.toggle('active',this.format === format); b.setAttribute('aria-selected',String(this.format === format)); }
    this.$('#scanner-frame-label').textContent=(this.format === 'qr' ? 'QR' : 'Barcode')+' · Chạm lấy nét · Kéo khung · Chụm để zoom';
  }
  async changeFormat(format) {
    if (this.format === format || this.changing) return;
    this.changing=true; this.saveRoi();this.format=format; remember('format',format); this.formatUI();this.roi=null;this.layoutRoi();this.candidate=''; this.hits=0;
    try { await this.prepareDecoder(); } catch(e) { this.paint('error',e.message); }
    finally { this.changing=false; }
  }
  async prepareDecoder() {
    const format=this.format;
    const wanted=format === 'qr' ? ['qr_code','data_matrix','aztec','pdf417'] : ['code_128','code_39','code_93','ean_13','ean_8','itf','upc_a','upc_e','codabar'];
    this.detector=null; this.reader=null;
    if ('BarcodeDetector' in window) {
      try { const formats=(await BarcodeDetector.getSupportedFormats()).filter(f => wanted.includes(f)); if (formats.length) { if (this.format === format) this.detector=new BarcodeDetector({formats}); return; } } catch {}
    }
    const Z=await zxing();
    const formats=format === 'qr' ? [Z.BarcodeFormat.QR_CODE,Z.BarcodeFormat.DATA_MATRIX,Z.BarcodeFormat.AZTEC,Z.BarcodeFormat.PDF_417] : [Z.BarcodeFormat.CODE_128,Z.BarcodeFormat.CODE_39,Z.BarcodeFormat.CODE_93,Z.BarcodeFormat.EAN_13,Z.BarcodeFormat.EAN_8,Z.BarcodeFormat.ITF,Z.BarcodeFormat.UPC_A,Z.BarcodeFormat.UPC_E,Z.BarcodeFormat.CODABAR];
    if (this.format !== format) return;
    this.Z=Z; this.hints=new Map([[Z.DecodeHintType.POSSIBLE_FORMATS,formats],[Z.DecodeHintType.TRY_HARDER,true]]); this.reader=new Z.MultiFormatReader();
  }
  async startVideo(deviceId) {
    this.releaseStream(); const epoch=this.epoch;
    const stream=await navigator.mediaDevices.getUserMedia({ video:{ ...(deviceId ? {deviceId:{exact:deviceId}} : {facingMode:{ideal:'environment'}}),width:{ideal:1920},height:{ideal:1080} },audio:false });
    if (!this.active || epoch !== this.epoch) { stream.getTracks().forEach(t=>t.stop()); return; }
    this.stream=stream; this.video.srcObject=stream; await this.video.play();
    if (!this.active || epoch !== this.epoch) { this.releaseStream(); return; }
    this.track=stream.getVideoTracks()[0]; this.torch=false;
    let caps={}; try { caps=this.track.getCapabilities?.() || {}; } catch {}
    this.caps=caps;this.opticalZoom=Number(this.track.getSettings?.().zoom)||1;this.digitalZoom=1;this.videoPan={x:0,y:0};this.applyVideoTransform();
    this.originalExposure=this.track.getSettings?.().exposureCompensation;
    const flash=this.$('#scanner-flash'); flash.disabled=!caps.torch; flash.setAttribute('aria-pressed','false'); flash.classList.remove('enabled'); flash.title=caps.torch ? 'Bật/tắt đèn flash' : 'Camera này không hỗ trợ đèn flash';
    const zoom=this.$('#scanner-zoom'); zoom.replaceChildren();
    this.zoomMin=caps.zoom?.min || 1;this.zoomMax=Math.max(4,Math.min(caps.zoom?.max || 4,6));
    for (const value of [...new Set([this.zoomMin,this.opticalZoom,1,1.5,2,3,4,this.zoomMax])].filter(v=>v>=this.zoomMin&&v<=this.zoomMax).sort((a,b)=>a-b)) zoom.add(new Option('×'+value,value));
    zoom.disabled=false;zoom.value=String(this.opticalZoom);zoom.title='Chọn mức zoom hoặc chụm hai ngón trên vùng camera';
    if (Array.isArray(caps.focusMode)&&caps.focusMode.includes('continuous')) try {await this.track.applyConstraints({advanced:[{focusMode:'continuous'}]});} catch {}
    this.layoutRoi();if(this.glare)await this.setGlare(true);
  }
  capture() {
    if (this.video.readyState < 2 || !this.video.videoWidth || !this.video.videoHeight) return false;
    const v=this.video.getBoundingClientRect(), f=this.$('#scanner-frame').getBoundingClientRect();
    const scale=Math.max(v.width/this.video.videoWidth,v.height/this.video.videoHeight);
    const x=Math.max(0,(this.video.videoWidth-v.width/scale)/2+(f.left-v.left)/scale);
    const y=Math.max(0,(this.video.videoHeight-v.height/scale)/2+(f.top-v.top)/scale);
    const w=Math.min(f.width/scale,this.video.videoWidth-x),h=Math.min(f.height/scale,this.video.videoHeight-y);
    if (w<=0 || h<=0) return false;
    const ratio=Math.min(1,960/w); const width=Math.max(1,Math.round(w*ratio)),height=Math.max(1,Math.round(h*ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width=width; this.canvas.height=height; }
    this.context.drawImage(this.video,x,y,w,h,0,0,width,height);
    if(this.options.autoCapture && (!this.options.onCode||this.options.captureOnCode)){
      const scale=Math.min(1,1280/Math.max(this.video.videoWidth,this.video.videoHeight));
      this.evidenceCanvas.width=Math.round(this.video.videoWidth*scale);this.evidenceCanvas.height=Math.round(this.video.videoHeight*scale);
      this.evidenceCanvas.getContext('2d').drawImage(this.video,0,0,this.evidenceCanvas.width,this.evidenceCanvas.height);
    }
    if(this.glare && (++this.framePass%4)!==0) {const image=this.context.getImageData(0,0,width,height);enhanceGlare(image,{invert:this.framePass%4===3});this.context.putImageData(image,0,0);}
    return true;
  }
  async loop(epoch) {
    if (!this.active || epoch !== this.epoch) return;
    if (!this.busy && !this.singlePaused && !this.changing && !this.zoomApplying && !this.focusBusy && !this.gesture && this.capture()) {
      let value='';
      try {
        if (this.detector) value=(await this.detector.detect(this.canvas))[0]?.rawValue || '';
        else if (this.reader) { const bitmap=new this.Z.BinaryBitmap(new this.Z.HybridBinarizer(new this.Z.HTMLCanvasElementLuminanceSource(this.canvas))); value=this.reader.decode(bitmap,this.hints).getText(); }
      } catch { /* No readable code in this frame. */ }
      if (!this.active || epoch !== this.epoch) return;
      value=clean(value);
      if (value && value.length<=500) {
        if (value === this.candidate && Date.now()-(this.candidateTime||0)<1800) this.hits++; else { this.candidate=value; this.hits=1; }
        this.candidateTime=Date.now();
        if (this.hits>=2 && value !== this.latched) {
          this.latched=value;
          const image=this.options.autoCapture&&(!this.options.onCode||this.options.captureOnCode)?this.evidenceCanvas.toDataURL('image/jpeg',.8):null;
          await this.accept(value,false,image);
        }
      } else if(Date.now()-(this.candidateTime||0)>1800) { this.candidate=''; this.hits=0; }
    }
    if (this.active && epoch === this.epoch) this.timer=setTimeout(()=>this.loop(epoch),this.reader ? 300 : 180);
  }
  async accept(code,force=false,image=null) {
    if (this.busy || !this.active) return;
    code=clean(code);const raw=code;
    if(!force && this.options.mode==='HS' && this.lastRead===code)return;
    this.lastRead=code;
    this.stockUI(null);
    if(raw!==this.lastRaw)this.lastImage=null;
    if(image)this.lastImage=image;
    this.lastRaw=raw;if(this.options.mode==='HS')code=hsCode(raw);
    this.busy=true; this.lastCode=code; this.$('#scanner-repeat').disabled=true; this.paint('checking',this.options.onCode?'Đang đọc mã…':'Đang kiểm tra trùng trên toàn server…',code);
    const payload={request_id:crypto.randomUUID(),barcode:code,mode:this.options.mode,image:null,reject_duplicate:this.options.mode!=='HS'&&!force};
    if(this.options.mode==='HS')payload.raw_barcode=raw;
    try {
      if(this.options.autoCapture && (!this.options.onCode||this.options.captureOnCode)){
        if(!this.lastImage)throw Error('Chưa chụp được ảnh đối chiếu. Hãy đưa mã vào khung và quét lại.');
        payload.image=this.lastImage;
      }
      if(this.options.onCode){const result=await this.options.onCode(code,{image:payload.image});this.captured++;const kind=result?.kind||'success';this.paint(kind,result?.message||'Đã điền mã vào mục đã chọn',result?.displayValue||code);this.$('#scanner-repeat').textContent='Đọc lại cùng mã';this.feedback(kind==='error');return;}
      let known=0, online=true;
      const local=(await this.options.pending().catch(()=>[])).filter(r=>r.mode === this.options.mode && clean(r.barcode) === code).length;
      try { const result=await this.options.api('/scans/check?barcode=' + encodeURIComponent(code) + '&mode=' + encodeURIComponent(this.options.mode)); known=result.count; }
      catch(e) { if (!e.network) throw e; online=false; }
      if (!this.active) return;
      if (this.options.mode!=='HS' && !force && (known>0 || local>0 || this.seen.has(code))) { this.duplicate(code,known,local,online); return; }
      if (!online) {
        await this.options.enqueue({...payload,reject_duplicate:false}); this.queued++; this.seen.set(code,true); this.paint('pending','Chờ đồng bộ · Chưa kiểm tra trùng toàn server',code); this.feedback(false);
      } else {
        try {
          const result=await this.options.api('/scans',{method:'POST',data:payload}); this.saved++; this.seen.set(code,true);this.stockUI(result.stock);
          if(this.options.mode==='HS'&&result.is_duplicate)this.duplicate(code,result.prior_count,0,true,true);
          else{this.paint('success',this.options.mode==='HS'?'HS · KHÔNG TRÙNG · Đã lưu':result.barcode_count>1 ? `Đã lưu thêm · Mã có ${result.barcode_count} lượt trên server` : 'Đã lưu · Đã kiểm tra trùng trên server',code);this.feedback(false);}
        } catch(e) {
          if (e.code === 'DUPLICATE_SCAN') { this.duplicate(code,e.count,local,true); return; }
          if (!e.network) throw e;
          await this.options.enqueue({...payload,reject_duplicate:false}); this.queued++; this.seen.set(code,true); this.paint('pending','Chờ đồng bộ · Chưa kiểm tra trùng toàn server',code); this.feedback(false);
        }
      }
      this.repeatIsDuplicate=false; this.$('#scanner-repeat').textContent='Quét lại cùng mã'; this.options.onChanged?.();
    } catch(e) { this.paint('error',e.message,code); this.$('#scanner-repeat').textContent='Thử lưu lại mã'; if (e.status === 401) this.options.onAuthExpired?.(); }
    finally { this.busy=false; if (this.active) {this.$('#scanner-repeat').disabled=!this.lastCode;this.singlePaused=!this.continuous;this.flowUI();} this.counts(); }
  }
  duplicate(code,serverCount,localCount,online,saved=false) {
    this.repeatIsDuplicate=true;
    const label=serverCount ? `TRÙNG ${serverCount} LƯỢT · ${code}` : `ĐÃ QUÉT TRÊN THIẾT BỊ · ${code}`;
    this.alerts=[{code,label},...this.alerts.filter(a=>a.code !== code)].slice(0,3);
    const container=this.$('#scanner-alerts'); container.replaceChildren();
    for (const alert of this.alerts) { const row=document.createElement('div'); row.className='scanner-alert'; row.textContent=alert.label; container.append(row); }
    this.paint('duplicate',saved?`HS · TRÙNG ${serverCount} lượt trước · Đã lưu lượt này`:serverCount ? `TRÙNG ${serverCount} lượt trên server · Chưa lưu thêm` : online ? 'Mã đã có trong phiên hoặc hàng chờ · Chưa lưu thêm' : 'Mã đã quét trên thiết bị · Chưa kiểm tra toàn server',code);
    this.$('#scanner-repeat').textContent='Lưu thêm lượt cùng mã'; this.feedback(true);
  }
  stockUI(row){
    const el=this.$('#scanner-stock-info');el.replaceChildren();el.hidden=this.options.mode!=='Stock'||!row;
    if(el.hidden)return;
    for(const [label,value] of [['ITEM code',row.item_code||'Chưa tìm thấy trong MM'],['Item NM',row.item_name],['QTY',row.quantity],['Maker / Vendor',[row.maker,row.vendor].filter(Boolean).join(' / ')],['Lot No',row.lot_no]]){
      const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value??'—';el.append(dt,dd);
    }
  }
  paint(kind,message,code) {
    if (!this.active) return;
    this.dialog.dataset.state=kind; this.$('#scanner-status').textContent=message;
    if (code) this.$('#scanner-value').textContent=code;
    this.$('#scanner-result-icon').innerHTML=kind === 'success' ? svg('check') : '';
    this.counts();
  }
  counts() { if (this.active) this.$('#scanner-count').textContent=this.options.onCode?`Đã đọc ${this.captured} mã trong lần mở camera này${this.singlePaused?' · Đang tạm dừng':''}`:`Đã lưu ${this.saved} lượt trong lần mở camera này${this.queued ? ` · ${this.queued} chờ đồng bộ` : ''}${this.singlePaused?' · Đang tạm dừng':''}`; }
  feedback(duplicate) {
    if (this.vibration) { try { navigator.vibrate?.(duplicate ? [70,50,70] : 45); } catch {} }
    if (!this.sound || !this.audio || this.audio.state === 'closed') return;
    try { this.audio.resume().catch(()=>{}); const oscillator=this.audio.createOscillator(),gain=this.audio.createGain(),now=this.audio.currentTime; oscillator.frequency.value=duplicate ? 280 : 1000; gain.gain.setValueAtTime(.035,now); gain.gain.exponentialRampToValueAtTime(.001,now+.14); oscillator.connect(gain); gain.connect(this.audio.destination); oscillator.start(now); oscillator.stop(now+.15); } catch {}
  }
  async flash() {
    if (!this.track || !this.caps?.torch || this.glare) return;
    const button=this.$('#scanner-flash'); button.disabled=true;
    try { const on=!this.torch; await this.track.applyConstraints({advanced:[{torch:on}]}); this.torch=on; button.setAttribute('aria-pressed',String(on)); button.classList.toggle('enabled',on); button.setAttribute('aria-label',on ? 'Tắt đèn flash' : 'Bật đèn flash'); }
    catch { this.paint('error','Thiết bị không bật được đèn flash. Bạn vẫn có thể tiếp tục quét.'); }
    finally { if (this.active) button.disabled=false; }
  }
  async zoom(value) {
    if (!this.track) return;
    this.nextZoom=Math.min(this.zoomMax,Math.max(this.zoomMin,value));if(this.zoomApplying)return;
    this.zoomApplying=true;
    try {while(this.nextZoom!==null && this.active && this.track){const target=this.nextZoom;this.nextZoom=null;const track=this.track;
      if(this.caps?.zoom){const cap=this.caps.zoom,step=cap.step||.1,hardware=Math.min(cap.max,Math.max(cap.min,cap.min+Math.floor((target-cap.min)/step+1e-8)*step));
        try {await track.applyConstraints({advanced:[{zoom:hardware}]});if(track!==this.track)break;this.opticalZoom=hardware;} catch {this.opticalZoom=Number(track.getSettings?.().zoom)||this.opticalZoom||1;}
      }else this.opticalZoom=1;
      this.digitalZoom=Math.max(1,target/this.opticalZoom);this.applyVideoTransform();
      const effective=Number((this.opticalZoom*this.digitalZoom).toFixed(2)),select=this.$('#scanner-zoom');select.querySelectorAll('[data-transient]').forEach(x=>x.remove());if(![...select.options].some(o=>Number(o.value)===effective)){const option=new Option('×'+effective,effective);option.dataset.transient='true';select.add(option);}select.value=String(effective);
    }}finally{this.zoomApplying=false;}
  }
  applyVideoTransform() {
    const width=this.dialog.clientWidth,height=this.dialog.clientHeight,z=this.digitalZoom||1;
    const maxX=width*(z-1)/2,maxY=height*(z-1)/2;
    this.videoPan.x=Math.min(maxX,Math.max(-maxX,this.videoPan.x));this.videoPan.y=Math.min(maxY,Math.max(-maxY,this.videoPan.y));
    this.video.style.transform=`translate(${this.videoPan.x}px,${this.videoPan.y}px) scale(${z})`;
  }
  roiBounds() {const b=this.$('.scanner-body').getBoundingClientRect();return {left:b.left,top:b.top,width:Math.max(1,b.width),height:Math.max(1,b.height-30)};}
  layoutRoi(reset=false) {
    const bounds=this.roiBounds();if(bounds.width<=1||bounds.height<=1)return;
    if(!this.roi&&!reset)try{const saved=JSON.parse(pref('roi-'+(this.options.accountKey||'default')+'-'+this.format,'null'));if(saved&&['x','y','w','h'].every(k=>Number.isFinite(saved[k])&&saved[k]>=0&&saved[k]<=1))this.roi=saved;}catch{}
    let rect;
    if(!this.roi||reset){const side=Math.min(bounds.width*.67,bounds.height*.8,290),w=this.format==='qr'?side:bounds.width*.94,h=this.format==='qr'?side:Math.min(w/2.8,bounds.height*.8,160);rect={x:(bounds.width-w)/2,y:(bounds.height-h)/2,w,h};}
    else rect={x:this.roi.x*bounds.width,y:this.roi.y*bounds.height,w:this.roi.w*bounds.width,h:this.roi.h*bounds.height};
    this.setRoi(rect,bounds);
  }
  setRoi(rect,bounds=this.roiBounds()) {
    const fit=this.format==='qr'?fitScanRect(rect,bounds.width,bounds.height,true):fitBarcodeRect(rect,bounds.width,bounds.height);
    Object.assign(this.$('#scanner-frame').style,{left:fit.x+'px',top:fit.y+'px',width:fit.w+'px',height:fit.h+'px'});
    this.roi={x:fit.x/bounds.width,y:fit.y/bounds.height,w:fit.w/bounds.width,h:fit.h/bounds.height};
  }
  saveRoi() {if(this.roi)remember('roi-'+(this.options.accountKey||'default')+'-'+this.format,JSON.stringify(this.roi));}
  resetView() {this.roi=null;this.videoPan={x:0,y:0};this.layoutRoi(true);this.saveRoi();this.zoom(Math.max(1,this.zoomMin||1));}
  installGestures() {
    const body=this.$('.scanner-body'),frame=this.$('#scanner-frame');
    const rect=()=>{const r=frame.getBoundingClientRect(),b=this.roiBounds();return{x:r.left-b.left,y:r.top-b.top,w:r.width,h:r.height};};
    body.onpointerdown=e=>{if(!this.active)return;e.preventDefault();this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});try{body.setPointerCapture(e.pointerId);}catch{}
      const points=[...this.pointers.values()];
      if(points.length===2){this.gesture={type:'pinch',distance:Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y),zoom:this.opticalZoom*this.digitalZoom,mid:{x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2},pan:{...this.videoPan}};}
      else if(points.length===1)this.gesture={type:e.target.closest('[data-resize]')?'resize':e.target.closest('#scanner-frame')?'move':this.digitalZoom>1?'pan':'move',corner:e.target.closest('[data-resize]')?.dataset.resize,start:{x:e.clientX,y:e.clientY},rect:rect(),pan:{...this.videoPan}};
    };
    body.onpointermove=e=>{if(!this.pointers.has(e.pointerId)||!this.gesture)return;e.preventDefault();this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const g=this.gesture,b=this.roiBounds();
      if(g.type!=='pinch'&&!g.moved){if(Math.hypot(e.clientX-g.start.x,e.clientY-g.start.y)<8)return;g.moved=true;}
      if(g.type==='pinch'){const p=[...this.pointers.values()];if(p.length<2)return;this.zoom(g.zoom*Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y)/Math.max(1,g.distance));this.videoPan={x:g.pan.x+(p[0].x+p[1].x)/2-g.mid.x,y:g.pan.y+(p[0].y+p[1].y)/2-g.mid.y};this.applyVideoTransform();}
      else {const dx=e.clientX-g.start.x,dy=e.clientY-g.start.y;if(g.type==='resize')this.setRoi(resizeScanRect(g.rect,g.corner,dx,dy,b.width,b.height,this.format==='qr'),b);else if(g.type==='pan'){this.videoPan={x:g.pan.x+dx,y:g.pan.y+dy};this.applyVideoTransform();}else this.setRoi({...g.rect,x:g.rect.x+dx,y:g.rect.y+dy},b);}
    };
    const finish=e=>{const g=this.gesture,tap=e.type==='pointerup'&&this.pointers.size===1&&g&&g.type!=='pinch'&&g.type!=='resize'&&!g.moved;this.pointers.delete(e.pointerId);this.gesture=null;this.hits=0;this.saveRoi();if(tap)this.focusAt(e.clientX,e.clientY);};body.onpointerup=finish;body.onpointercancel=finish;
    frame.onkeydown=e=>{const r=rect(),step=e.shiftKey?20:8;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();this.setRoi({...r,x:r.x+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0),y:r.y+(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0)});this.saveRoi();}else if(['+','=','-'].includes(e.key)){e.preventDefault();const factor=e.key==='-'?.9:1.1;this.setRoi({...r,w:r.w*factor,h:r.h*factor});this.saveRoi();}};
    this.resizeObserver=new ResizeObserver(()=>{if(this.active){this.layoutRoi();this.applyVideoTransform();}});this.resizeObserver.observe(body);
  }
  async focusAt(clientX,clientY){
    if(!this.active||!this.track||this.focusBusy)return;
    clearTimeout(this.focusRestore);clearTimeout(this.focusHide);
    let ring=this.$('.scanner-focus');if(!ring){ring=document.createElement('div');ring.className='scanner-focus';ring.setAttribute('role','status');ring.innerHTML='<span></span>';this.dialog.append(ring);}
    ring.hidden=false;ring.style.left=clientX+'px';ring.style.top=clientY+'px';ring.dataset.state='working';ring.querySelector('span').textContent='Lấy nét';
    const track=this.track,epoch=this.epoch,modes=this.caps.focusMode||[],mode=modes.includes('single-shot')?'single-shot':modes.includes('continuous')?'continuous':null;
    const supported=navigator.mediaDevices?.getSupportedConstraints?.()||{},pointSupport=supported.pointsOfInterest===true||Object.hasOwn(this.caps,'pointsOfInterest');
    const point=cameraPoint(clientX,clientY,this.video.getBoundingClientRect(),this.video.videoWidth,this.video.videoHeight),advanced={};
    if(mode)advanced.focusMode=mode;if(pointSupport)advanced.pointsOfInterest=[point];
    this.focusBusy=true;
    try{
      if(!mode)throw Error('unsupported');
      await track.applyConstraints({advanced:[advanced]});if(!this.active||epoch!==this.epoch)return;
      ring.dataset.state='applied';ring.querySelector('span').textContent=pointSupport?'Lấy nét':'Tự lấy nét';
      if(mode==='single-shot'&&modes.includes('continuous'))this.focusRestore=setTimeout(()=>{if(this.active&&this.track===track)track.applyConstraints({advanced:[{focusMode:'continuous',...(pointSupport?{pointsOfInterest:[point]}:{})}]}).catch(()=>{});},1200);
    }catch{if(this.active&&epoch===this.epoch){ring.dataset.state='unsupported';ring.querySelector('span').textContent='Không hỗ trợ';}}
    finally{this.focusBusy=false;if(this.active&&epoch===this.epoch)this.focusHide=setTimeout(()=>{ring.hidden=true;},1500);}
  }
  async setGlare(on) {
    this.glare=on;const button=this.$('#scanner-glare');button.setAttribute('aria-pressed',String(on));button.classList.toggle('enabled',on);
    const note=this.$('#scanner-assist-note');note.hidden=!on;note.textContent='Nghiêng nhẹ điện thoại để tránh phản chiếu. Vùng cháy trắng cần đổi góc hoặc ánh sáng.';
    const track=this.track;if(!track)return;
    try {
      const advanced={};if(on&&this.caps.torch){advanced.torch=false;this.torch=false;this.$('#scanner-flash').setAttribute('aria-pressed','false');this.$('#scanner-flash').classList.remove('enabled');}
      if(Array.isArray(this.caps.focusMode)&&this.caps.focusMode.includes('continuous'))advanced.focusMode='continuous';
      if(Array.isArray(this.caps.exposureMode)&&this.caps.exposureMode.includes('continuous'))advanced.exposureMode='continuous';
      const exposure=this.caps.exposureCompensation;if(exposure&&Number.isFinite(exposure.min)&&Number.isFinite(exposure.max)){const target=on?-1:Number.isFinite(this.originalExposure)?this.originalExposure:0,step=exposure.step||.1;advanced.exposureCompensation=Math.min(exposure.max,Math.max(exposure.min,exposure.min+Math.round((target-exposure.min)/step)*step));}
      if(Object.keys(advanced).length)await track.applyConstraints({advanced:[advanced]});
    }catch{note.textContent='Đang tăng tương phản ảnh đọc. Camera chưa áp dụng được giảm phơi sáng; hãy nghiêng nhẹ để tránh phản chiếu.';}
    this.$('#scanner-flash').disabled=!this.caps.torch||on;
  }
  releaseStream() { this.stream?.getTracks().forEach(t=>t.stop()); this.stream=null; this.track=null; if (this.video) this.video.srcObject=null; }
  release() {
    if (!this.active) return;
    clearTimeout(this.focusRestore);clearTimeout(this.focusHide);
    this.saveRoi();this.resizeObserver?.disconnect();this.pointers.clear();this.gesture=null;this.active=false; this.epoch++; clearTimeout(this.timer); this.releaseStream(); this.audio?.close().catch(()=>{}); document.body.classList.remove('scanner-open'); this.dialog.removeEventListener('close',this.onClose); this.options.onChanged?.();
  }
  close() { if (this.dialog.open) this.dialog.close(); this.release(); }
}
