const symbols = {
  back:'<path d="M19 12H5m6-6-6 6 6 6"/>',
  flash:'<path d="m13 2-9 12h7l-1 8L21 9h-8Z"/>',
  sound:'<path d="M11 4 5 9H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  vibration:'<rect x="7" y="3" width="10" height="18" rx="2"/><path d="m3 6-1 3 1 3-1 3 1 3m18-12 1 3-1 3 1 3-1 3M11 18h2"/>',
  flip:'<path d="M3 8V3h5m13 13v5h-5M3 8a9 9 0 0 1 16-3m2 11a9 9 0 0 1-16 3"/><circle cx="12" cy="12" r="3"/>',
  barcode:'<path d="M3 4v16M6 4v16M10 4v16M12 4v16M16 4v16M20 4v16"/>',
  qr:'<path d="M3 3h6v6H3Zm12 0h6v6h-6ZM3 15h6v6H3Zm12 0h3v3h3v3h-6Zm-3-3h3m3 0h3M12 3v6m0 9v3"/>',
  check:'<path d="m4 12 5 5L20 6"/>'
};
const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${symbols[name]}</svg>`;
const clean = value => String(value ?? '').trim().toUpperCase();
const pref = (key, fallback) => { try { return localStorage.getItem('wa-scanner-' + key) ?? fallback; } catch { return fallback; } };
const remember = (key, value) => { try { localStorage.setItem('wa-scanner-' + key, String(value)); } catch {} };
let vendorPromise;
function zxing() {
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
    this.format=pref('format','barcode') === 'qr' ? 'qr' : 'barcode'; this.sound=pref('sound','true') === 'true'; this.vibration=pref('vibration','true') === 'true';
    this.canvas=document.createElement('canvas'); this.context=this.canvas.getContext('2d',{willReadFrequently:true});
    dialog.className='phone-scanner'; dialog.setAttribute('aria-label','Quét mã bằng điện thoại');
    dialog.innerHTML=`<video class="scanner-video" autoplay playsinline muted></video><div class="scanner-shade"></div>
      <div class="scanner-layout"><section class="scanner-top" aria-label="Kết quả quét">
        <div class="scanner-heading"><div><span class="scanner-eyebrow">WORK AREA · QUÉT LIÊN TỤC</span><h2 id="scanner-title"></h2></div><span class="scanner-live"><i></i> Camera</span></div>
        <p class="scanner-status" id="scanner-status" aria-live="polite">Đang mở camera…</p>
        <div class="scanner-result" id="scanner-result"><span id="scanner-value">Đưa mã vào khung</span><span id="scanner-result-icon"></span></div>
        <p class="scanner-count" id="scanner-count">Đã lưu 0 lượt trong lần mở camera này</p>
        <button class="scanner-repeat" id="scanner-repeat" disabled>Quét lại cùng mã</button>
        <div class="scanner-alerts" id="scanner-alerts" aria-live="polite"></div>
      </section><div class="scanner-body"><div class="scanner-frame" id="scanner-frame"><span class="scanner-corner tl"></span><span class="scanner-corner tr"></span><span class="scanner-corner bl"></span><span class="scanner-corner br"></span><div class="scanner-laser"></div><span class="scanner-frame-label" id="scanner-frame-label">Đặt barcode vào trong khung</span></div></div>
      <section class="scanner-controls" aria-label="Điều khiển camera"><div class="scanner-formats" role="tablist" aria-label="Định dạng mã"><button id="scanner-barcode" role="tab">${svg('barcode')} Barcode</button><button id="scanner-qr" role="tab">${svg('qr')} QR</button></div>
        <div class="scanner-tools"><label class="scanner-zoom-label"><span class="sr-only">Mức phóng đại camera</span><select id="scanner-zoom" aria-label="Mức phóng đại camera" disabled><option value="1">×1</option></select></label><div class="scanner-round-tools"><button class="scanner-round" id="scanner-flip" aria-label="Đổi camera" disabled>${svg('flip')}</button><button class="scanner-round" id="scanner-vibration" aria-label="Rung khi đọc mã">${svg('vibration')}</button><button class="scanner-round" id="scanner-sound" aria-label="Âm thanh khi đọc mã">${svg('sound')}</button></div></div>
      </section><div class="scanner-bottom"><button class="scanner-back" id="scanner-back" aria-label="Đóng camera">${svg('back')}</button><button class="scanner-manual" id="scanner-manual">Nhập mã bằng tay</button><button class="scanner-flash" id="scanner-flash" aria-label="Bật đèn flash" aria-pressed="false" disabled>${svg('flash')}</button></div></div>`;
    this.$=s => dialog.querySelector(s); this.video=this.$('video');
    this.$('#scanner-title').textContent=options.title || `Scan ${options.mode}`;
    this.$('#scanner-back').onclick=() => this.close();
    this.$('#scanner-manual').onclick=() => { this.close(); options.onManual?.(); };
    this.$('#scanner-repeat').onclick=() => this.lastCode && this.accept(this.lastCode,true);
    this.$('#scanner-barcode').onclick=() => this.changeFormat('barcode'); this.$('#scanner-qr').onclick=() => this.changeFormat('qr');
    this.$('#scanner-sound').onclick=() => { this.sound=!this.sound; remember('sound',this.sound); this.settings(); if (this.sound) this.feedback(false); };
    this.$('#scanner-vibration').onclick=() => { this.vibration=!this.vibration; remember('vibration',this.vibration); this.settings(); if (this.vibration) navigator.vibrate?.(40); };
    this.$('#scanner-flash').onclick=() => this.flash(); this.$('#scanner-flip').onclick=() => this.flip();
    this.$('#scanner-zoom').onchange=e => this.zoom(Number(e.target.value));
    this.onClose=() => this.release(); dialog.addEventListener('close',this.onClose);
    this.settings(); this.formatUI();
  }
  async open() {
    this.active=true; const epoch=++this.epoch; this.dialog.showModal(); document.body.classList.add('scanner-open');
    try { this.audio=new (window.AudioContext || window.webkitAudioContext)(); this.audio.resume().catch(()=>{}); } catch {}
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { this.paint('error','Camera cần HTTPS và quyền truy cập camera.'); return; }
    try {
      await Promise.all([this.startVideo(),this.prepareDecoder()]);
      if (!this.active || epoch !== this.epoch) return;
      this.paint('ready','Sẵn sàng · Mã mới được tự động lưu'); this.loop(epoch);
    } catch(e) { if (this.active && epoch === this.epoch) { this.epoch++; this.releaseStream(); this.paint('error',e.name === 'NotAllowedError' ? 'Chưa được cấp quyền camera. Hãy cho phép camera trong trình duyệt.' : e.name === 'NotFoundError' ? 'Không tìm thấy camera. Bạn có thể nhập mã bằng tay.' : e.message); } }
  }
  settings() {
    for (const [name,on] of [['sound',this.sound],['vibration',this.vibration]]) {
      const b=this.$('#scanner-' + name); b.classList.toggle('enabled',on); b.setAttribute('aria-pressed',String(on));
    }
    if (typeof navigator.vibrate !== 'function') { this.$('#scanner-vibration').disabled=true; this.$('#scanner-vibration').title='Trình duyệt không hỗ trợ rung'; }
  }
  formatUI() {
    this.dialog.dataset.format=this.format;
    for (const format of ['barcode','qr']) { const b=this.$('#scanner-' + format); b.classList.toggle('active',this.format === format); b.setAttribute('aria-selected',String(this.format === format)); }
    this.$('#scanner-frame-label').textContent=this.format === 'qr' ? 'Đặt mã QR vào trong khung' : 'Đặt barcode vào trong khung';
  }
  async changeFormat(format) {
    if (this.format === format || this.changing) return;
    this.changing=true; this.format=format; remember('format',format); this.formatUI(); this.candidate=''; this.hits=0; this.latched='';
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
    this.caps=caps;
    const flash=this.$('#scanner-flash'); flash.disabled=!caps.torch; flash.setAttribute('aria-pressed','false'); flash.classList.remove('enabled'); flash.title=caps.torch ? 'Bật/tắt đèn flash' : 'Camera này không hỗ trợ đèn flash';
    const zoom=this.$('#scanner-zoom'); zoom.replaceChildren();
    if (caps.zoom && Number.isFinite(caps.zoom.min) && caps.zoom.max > caps.zoom.min) {
      const values=[caps.zoom.min,this.track.getSettings?.().zoom || caps.zoom.min,1,1.5,2,3,4,caps.zoom.max].filter(v=>v>=caps.zoom.min && v<=Math.min(caps.zoom.max,6)).map(v=>Math.min(caps.zoom.max,Number((caps.zoom.min+Math.round((v-caps.zoom.min)/(caps.zoom.step || .1))*(caps.zoom.step || .1)).toFixed(3))));
      for (const value of [...new Set(values)].sort((a,b)=>a-b)) { const option=new Option('×' + value,value); zoom.add(option); }
      zoom.disabled=false; zoom.value=String(this.track.getSettings?.().zoom || caps.zoom.min); zoom.title='Phóng đại camera';
    } else { zoom.add(new Option('×1',1)); zoom.disabled=true; zoom.title='Camera này không hỗ trợ zoom'; }
    try { this.devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind === 'videoinput'); } catch { this.devices=[]; }
    this.$('#scanner-flip').disabled=this.devices.length < 2;
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
    this.context.drawImage(this.video,x,y,w,h,0,0,width,height); return true;
  }
  async loop(epoch) {
    if (!this.active || epoch !== this.epoch) return;
    if (!this.busy && !this.changing && this.capture()) {
      let value='';
      try {
        if (this.detector) value=(await this.detector.detect(this.canvas))[0]?.rawValue || '';
        else if (this.reader) { const bitmap=new this.Z.BinaryBitmap(new this.Z.HybridBinarizer(new this.Z.HTMLCanvasElementLuminanceSource(this.canvas))); value=this.reader.decode(bitmap,this.hints).getText(); }
      } catch { /* No readable code in this frame. */ }
      if (!this.active || epoch !== this.epoch) return;
      value=clean(value);
      if (value && value.length<=500) {
        if (value === this.candidate) this.hits++; else { this.candidate=value; this.hits=1; }
        if (this.hits>=2 && value !== this.latched) { this.latched=value; await this.accept(value); }
      } else { this.candidate=''; this.hits=0; }
    }
    if (this.active && epoch === this.epoch) this.timer=setTimeout(()=>this.loop(epoch),this.reader ? 300 : 180);
  }
  async accept(code,force=false) {
    if (this.busy || !this.active) return;
    this.busy=true; this.lastCode=code; this.$('#scanner-repeat').disabled=true; this.paint('checking','Đang kiểm tra trùng trên toàn server…',code);
    const payload={request_id:crypto.randomUUID(),barcode:code,mode:this.options.mode,image:null,reject_duplicate:!force};
    try {
      let known=0, online=true;
      const local=(await this.options.pending().catch(()=>[])).filter(r=>r.mode === this.options.mode && clean(r.barcode) === code).length;
      try { const result=await this.options.api('/scans/check?barcode=' + encodeURIComponent(code) + '&mode=' + encodeURIComponent(this.options.mode)); known=result.count; }
      catch(e) { if (!e.network) throw e; online=false; }
      if (!this.active) return;
      if (!force && (known>0 || local>0 || this.seen.has(code))) { this.duplicate(code,known,local,online); return; }
      if (!online) {
        await this.options.enqueue({...payload,reject_duplicate:false}); this.queued++; this.seen.set(code,true); this.paint('pending','Chờ đồng bộ · Chưa kiểm tra trùng toàn server',code); this.feedback(false);
      } else {
        try {
          const result=await this.options.api('/scans',{method:'POST',data:payload}); this.saved++; this.seen.set(code,true);
          this.paint('success',result.barcode_count>1 ? `Đã lưu thêm · Mã có ${result.barcode_count} lượt trên server` : 'Đã lưu · Đã kiểm tra trùng trên server',code); this.feedback(false);
        } catch(e) {
          if (e.code === 'DUPLICATE_SCAN') { this.duplicate(code,e.count,local,true); return; }
          if (!e.network) throw e;
          await this.options.enqueue({...payload,reject_duplicate:false}); this.queued++; this.seen.set(code,true); this.paint('pending','Chờ đồng bộ · Chưa kiểm tra trùng toàn server',code); this.feedback(false);
        }
      }
      this.repeatIsDuplicate=false; this.$('#scanner-repeat').textContent='Quét lại cùng mã'; this.options.onChanged?.();
    } catch(e) { this.paint('error',e.message,code); this.$('#scanner-repeat').textContent='Thử lưu lại mã'; if (e.status === 401) this.options.onAuthExpired?.(); }
    finally { this.busy=false; if (this.active) this.$('#scanner-repeat').disabled=!this.lastCode; this.counts(); }
  }
  duplicate(code,serverCount,localCount,online) {
    this.repeatIsDuplicate=true;
    const label=serverCount ? `TRÙNG ${serverCount} LƯỢT · ${code}` : `ĐÃ QUÉT TRÊN THIẾT BỊ · ${code}`;
    this.alerts=[{code,label},...this.alerts.filter(a=>a.code !== code)].slice(0,3);
    const container=this.$('#scanner-alerts'); container.replaceChildren();
    for (const alert of this.alerts) { const row=document.createElement('div'); row.className='scanner-alert'; row.textContent=alert.label; container.append(row); }
    this.paint('duplicate',serverCount ? `TRÙNG ${serverCount} lượt trên server · Chưa lưu thêm` : online ? 'Mã đã có trong phiên hoặc hàng chờ · Chưa lưu thêm' : 'Mã đã quét trên thiết bị · Chưa kiểm tra toàn server',code);
    this.$('#scanner-repeat').textContent='Lưu thêm lượt cùng mã'; this.feedback(true);
  }
  paint(kind,message,code) {
    if (!this.active) return;
    this.dialog.dataset.state=kind; this.$('#scanner-status').textContent=message;
    if (code) this.$('#scanner-value').textContent=code;
    this.$('#scanner-result-icon').innerHTML=kind === 'success' ? svg('check') : '';
    this.counts();
  }
  counts() { if (this.active) this.$('#scanner-count').textContent=`Đã lưu ${this.saved} lượt trong lần mở camera này${this.queued ? ` · ${this.queued} chờ đồng bộ` : ''}`; }
  feedback(duplicate) {
    if (this.vibration) { try { navigator.vibrate?.(duplicate ? [70,50,70] : 45); } catch {} }
    if (!this.sound || !this.audio || this.audio.state === 'closed') return;
    try { this.audio.resume().catch(()=>{}); const oscillator=this.audio.createOscillator(),gain=this.audio.createGain(),now=this.audio.currentTime; oscillator.frequency.value=duplicate ? 280 : 1000; gain.gain.setValueAtTime(.035,now); gain.gain.exponentialRampToValueAtTime(.001,now+.14); oscillator.connect(gain); gain.connect(this.audio.destination); oscillator.start(now); oscillator.stop(now+.15); } catch {}
  }
  async flash() {
    if (!this.track || !this.caps?.torch) return;
    const button=this.$('#scanner-flash'); button.disabled=true;
    try { const on=!this.torch; await this.track.applyConstraints({advanced:[{torch:on}]}); this.torch=on; button.setAttribute('aria-pressed',String(on)); button.classList.toggle('enabled',on); button.setAttribute('aria-label',on ? 'Tắt đèn flash' : 'Bật đèn flash'); }
    catch { this.paint('error','Thiết bị không bật được đèn flash. Bạn vẫn có thể tiếp tục quét.'); }
    finally { if (this.active) button.disabled=false; }
  }
  async zoom(value) {
    if (!this.track || !this.caps?.zoom) return;
    try { await this.track.applyConstraints({advanced:[{zoom:value}]}); } catch { this.paint('error','Thiết bị chưa áp dụng được mức zoom này.'); this.$('#scanner-zoom').value=String(this.track.getSettings?.().zoom || this.caps.zoom.min); }
  }
  async flip() {
    if (this.changing || !this.devices?.length) return;
    this.changing=true; this.$('#scanner-flip').disabled=true;
    try { const current=this.track?.getSettings?.().deviceId; const at=this.devices.findIndex(d=>d.deviceId === current); const next=this.devices[(at+1)%this.devices.length]; await this.startVideo(next.deviceId); this.paint('ready','Đã đổi camera · Đưa mã vào khung'); }
    catch(e) { this.paint('error','Không đổi được camera. Hãy đóng và mở camera lại.'); }
    finally { this.changing=false; }
  }
  releaseStream() { this.stream?.getTracks().forEach(t=>t.stop()); this.stream=null; this.track=null; if (this.video) this.video.srcObject=null; }
  release() {
    if (!this.active) return;
    this.active=false; this.epoch++; clearTimeout(this.timer); this.releaseStream(); this.audio?.close().catch(()=>{}); document.body.classList.remove('scanner-open'); this.dialog.removeEventListener('close',this.onClose); this.options.onChanged?.();
  }
  close() { if (this.dialog.open) this.dialog.close(); this.release(); }
}
