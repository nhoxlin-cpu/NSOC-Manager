export async function renderCutting(ctx){
  const {api,state,escape:e,number:n,time,icon,button,field,pageTop,canWrite,detail,toast,scanFlowBar,setContinuousScan,updateCaptureUI,openScanner,showCode}=ctx;
  const $=s=>document.querySelector(s);
  if(!document.querySelector('[data-cutting-css]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/cutting.css?v=20261114-1';css.dataset.cuttingCss='';document.head.append(css);}
  $('#main').innerHTML=`${pageTop('Cắt chân linh kiện','Quy đổi AI → MI · MI → AI')}<div id='cutting-page'><div class='columns'><section class='panel'><div class='field-row'><div class='field'><label for='cut-direction'>Chiều quy đổi</label><select id='cut-direction'><option value='auto'>Tự nhận diện AI / MI</option><option value='AI_TO_MI'>AI → MI</option><option value='MI_TO_AI'>MI → AI</option></select></div><div class='field'><label for='cut-model'>Model (tùy chọn)</label><input id='cut-model' list='cut-model-list' maxlength='200' placeholder='Nhập hoặc chọn mã model'><datalist id='cut-model-list'></datalist></div></div><p class='muted' id='cut-file-status' role='status'>Đang tải bảng quy đổi…</p><div class='capture-actions'>${button('Quét camera','cut-camera','primary','scan')}<button type='button' class='button scan-square' id='choose-photo' aria-label='Tự chụp ảnh đối chiếu'>${icon('camera')}</button></div><p class='cut-pair-rule'>AI 1st ↔ MI 1st · AI 2nd ↔ MI 2nd</p><details id='cut-manual'><summary>Nhập mã bằng tay</summary><form id='cut-form' class='mt'><div class='field'><label for='cut-code'>Mã AI hoặc MI</label><input id='cut-code' required maxlength='200' autocapitalize='characters' spellcheck='false'></div><p class='form-message' role='alert'></p><button type='submit' class='button primary full'>Quy đổi mã</button></form></details></section><section class='panel'><h2>Kết quả quy đổi</h2><div id='cut-result' aria-live='polite'><p class='muted'>Quét mã AI hoặc MI để tìm mã tương ứng.</p></div></section></div><div id='cut-import-panel'></div><section class='panel'><div class='table-tools'><h2>Lịch sử quy đổi</h2>${button('Tải lại','cut-reload','small','sync')}</div><p class='muted' id='cut-history-total'></p><div id='cut-history'></div><button type='button' class='button full mt' id='cut-more' hidden>Xem thêm</button></section></div>`;
  const root=$('#cutting-page');let active=false,lookupVersion=0,history=[],next=null,historyVersion=0,retry=null;
  const live=()=>root.isConnected;
  scanFlowBar($('.capture-actions'),true);updateCaptureUI();
  if(!canWrite()){$('#choose-photo').disabled=true;$('#choose-photo').classList.remove('enabled');$('#choose-photo').setAttribute('aria-pressed','false');}
  $('#choose-photo').onclick=()=>{state.autoCapture=!state.autoCapture;try{localStorage.setItem('wa-auto-capture-u'+state.user.id,String(state.autoCapture));}catch{}updateCaptureUI();};
  function resultHTML(result){
    if(!result.batch)return `<div class='notice'>Chưa có bảng quy đổi. Quản trị viên cần nhập file Excel gốc.</div>`;
    if(!result.matches.length)return `<div class='notice warning'>Chưa tìm thấy cặp tương ứng cho <strong>${e(result.code)}</strong>${result.model?' trong model '+e(result.model):''}.</div>`;
    return `${result.ambiguous_direction?`<div class='notice warning'>Mã xuất hiện ở cả AI và MI. Chọn chiều quy đổi để thu hẹp kết quả.</div>`:''}${result.multiple_targets?`<div class='notice warning'>Có nhiều mã tương ứng. Kiểm tra model và cặp 1st / 2nd trong danh sách.</div>`:''}${result.truncated?`<div class='notice warning'>Có hơn 200 cặp phù hợp. Nhập mã model để xem chính xác.</div>`:''}<p class='muted'>Mã đã quét: <strong>${e(result.code)}</strong> · ${n(result.count)} cặp</p><div class='cut-matches'>${result.matches.map(m=>`<article class='cut-match'><div class='cut-match-heading'><span class='badge ${m.variant===1?'green':'amber'}'>${m.variant===1?'1st':'2nd'}</span><strong>${m.direction==='AI_TO_MI'?'AI → MI':'MI → AI'}</strong></div><div class='cut-target'>${e(m.target_code)}</div><p class='muted'>${e(m.model_code)||'Model chưa ghi'}${m.model_name?' · '+e(m.model_name):''}</p><dl class='cut-details'><dt>Item</dt><dd>${e(m.item_name)||'—'}</dd><dt>Maker</dt><dd>${e(m.maker)||'—'}</dd><dt>BOM QTY</dt><dd>${e(m.qty)||'—'}</dd><dt>Location</dt><dd>${e(m.location)||'—'}</dd>${m.fcn?`<dt>FCN → FG</dt><dd>${e(m.fcn)}</dd>`:''}</dl><button class='button small' data-cut-code='${e(m.target_code)}'>QR / Mã vạch</button></article>`).join('')}</div>`;
  }
  function codeButtons(container){container.querySelectorAll('[data-cut-code]').forEach(b=>b.onclick=()=>showCode(b.dataset.cutCode));}
  async function loadStatus(){
    const result=await api('/cutting/status');if(!live())return;
    active=Boolean(result.batch);$('#cut-camera').disabled=!active;
    $('#cut-file-status').textContent=result.batch?`${result.batch.name} · ${n(result.batch.row_count)} cặp quy đổi`:'Chưa có bảng quy đổi. Nhập Excel gốc để bắt đầu.';
    $('#cut-model-list').innerHTML=result.models.map(m=>`<option value='${e(m.model_code)}'>${e(m.model_name)}</option>`).join('');
    if(!active)$('#cut-result').innerHTML=resultHTML({batch:null});
  }
  async function convert(code,image=null){
    if(!active)throw Error('Chưa có bảng quy đổi. Quản trị viên cần nhập file Excel.');
    const version=++lookupVersion,model=$('#cut-model').value.trim(),direction=$('#cut-direction').value;
    $('#cut-code').value=code;$('#cut-result').textContent='Đang tra mã tương ứng…';
    let result;
    try{
      if(canWrite()){
        const fingerprint=JSON.stringify([code.trim().toUpperCase(),model.trim().toUpperCase(),direction]);
        if(!retry||retry.fingerprint!==fingerprint)retry={fingerprint,request_id:crypto.randomUUID()};
        result=await api('/cutting/scans',{method:'POST',data:{request_id:retry.request_id,code,model,direction,image}});retry=null;
      }else result=await api('/cutting/lookup?code='+encodeURIComponent(code)+'&model='+encodeURIComponent(model)+'&direction='+direction);
    }catch(err){if(live()&&version===lookupVersion)$('#cut-result').textContent=err.message;throw err;}
    if(live()&&version===lookupVersion){$('#cut-result').innerHTML=resultHTML(result);codeButtons($('#cut-result'));loadHistory().catch(e=>toast(e.message));}
    const targets=[...new Set(result.matches.map(m=>m.target_code))];
    return {kind:!result.matches.length?'error':result.multiple_targets||result.ambiguous_direction||result.truncated?'pending':'success',displayValue:targets.length===1&&!result.ambiguous_direction?targets[0]:undefined,message:!result.matches.length?'Chưa tìm thấy mã tương ứng':result.multiple_targets||result.ambiguous_direction?'Có nhiều kết quả · Đóng camera để xem model và cặp quy đổi':`${result.matches[0].direction==='AI_TO_MI'?'AI → MI':'MI → AI'} · ${result.matches[0].variant===1?'1st':'2nd'} · ${code} → ${targets[0]}`};
  }
  $('#cut-camera').disabled=true;$('#cut-camera').onclick=()=>openScanner({title:'AI ↔ MI · Cắt chân',accountKey:'u'+state.user.id,continuous:state.continuousScan,onContinuousChange:setContinuousScan,autoCapture:canWrite()&&state.autoCapture,captureOnCode:true,onCode:(code,{image})=>convert(code,image),onManual:()=>{if(live()){$('#cut-manual').open=true;$('#cut-code').focus();}}});
  $('#cut-form').onsubmit=async event=>{event.preventDefault();const submit=$('#cut-form button[type=submit]');submit.disabled=true;$('#cut-form .form-message').textContent='';try{await convert($('#cut-code').value);}catch(e){if(live())$('#cut-form .form-message').textContent=e.message;}finally{if(live())submit.disabled=false;}};
  async function loadHistory(more=false){
    const version=++historyVersion,result=await api('/cutting/scans'+(more&&next?'?before='+next:''));if(!live()||version!==historyVersion)return;
    history=more?[...history,...result.scans]:result.scans;next=result.next;
    $('#cut-history-total').textContent=n(result.total)+' lượt quy đổi · Lịch sử riêng cho Cắt chân';
    $('#cut-history').innerHTML=history.length?`<div class='table-wrap'><table><thead><tr><th>STT</th><th>Mã đã quét</th><th>Mã tương ứng</th><th>Người quét</th><th>Xem lại</th></tr></thead><tbody>${history.map((r,i)=>`<tr><td>${i+1}</td><td>${e(r.code)}<small>${e(r.model||'')}</small></td><td>${r.targets.map(e).join('<br>')||'Chưa tìm thấy'}</td><td>${e(r.scanner)}<small>${time(r.created_at)}</small></td><td><button class='button small' data-cut-history='${r.id}'>Xem</button></td></tr>`).join('')}</tbody></table></div>`:`<p class='muted'>Chưa có lượt quy đổi.</p>`;
    $('#cut-more').hidden=!next;
    root.querySelectorAll('[data-cut-history]').forEach(b=>b.onclick=async()=>{try{const row=await api('/cutting/scans/'+b.dataset.cutHistory);if(!live())return;detail('Lượt quy đổi',`<p class='muted'>${e(row.scanner||state.user.name)} · ${time(row.created_at)}</p>${row.has_image?`<img class='evidence-image' src='/api/cutting/scans/${row.id}/image' alt='Ảnh đối chiếu lúc quét'>`:''}${resultHTML(row)}`);codeButtons($('#detail-content'));}catch(err){toast(err.message);}});
  }
  $('#cut-reload').onclick=()=>loadHistory().catch(err=>toast(err.message));
  $('#cut-more').onclick=()=>loadHistory(true).catch(err=>toast(err.message));
  for(const id of ['cut-model','cut-direction'])$('#'+id).addEventListener('change',()=>{lookupVersion++;$('#cut-result').innerHTML=`<p class='muted'>Quét mã để tra theo lựa chọn mới.</p>`;});
  if(state.user.role==='admin'){
    $('#cut-import-panel').innerHTML=`<section class='panel'><details id='cut-import-details'><summary>Nhập bảng quy đổi AI / MI</summary><p class='muted'>Nhập Excel gốc .xls / .xlsx (tối đa 32 MB). Đọc tất cả sheet, ghép AI 1st ↔ MI 1st và AI 2nd ↔ MI 2nd. Bảng mới thay bảng tra hiện tại; lịch sử giữ kết quả cũ.</p><a class='button small' href='/api/cutting/template'>Tải file mẫu</a><form id='cut-import-form' class='mt'><div class='field'><label for='cut-file'>File bảng quy đổi</label><input type='file' id='cut-file' accept='.xls,.xlsx' required></div><p class='form-message' role='alert'></p><button class='button primary' type='submit'>Nhập bảng quy đổi</button></form><p id='cut-import-status' role='status'></p></details></section>`;
    $('#cut-import-form').onsubmit=async event=>{event.preventDefault();const file=$('#cut-file').files[0],submit=$('#cut-import-form button');$('#cut-import-form .form-message').textContent='';try{if(!file||! /\.(xlsx|xls)$/i.test(file.name))throw Error('Chọn file Excel .xls hoặc .xlsx.');if(file.size>32*1024*1024)throw Error('File tối đa 32 MB.');submit.disabled=true;$('#cut-import-status').textContent='Đang đọc các sheet…';const result=await api('/cutting/import-file',{method:'POST',file,timeoutMs:420000});if(!live())return;$('#cut-import-status').textContent=`Đã nhập ${n(result.pairs)} cặp từ ${result.sheets.length} sheet.`;$('#cut-import-form').reset();await loadStatus();toast('Đã cập nhật bảng quy đổi');}catch(err){if(live()){$('#cut-import-form .form-message').textContent=err.message;$('#cut-import-status').textContent='Chưa cập nhật bảng quy đổi.';}}finally{if(live())submit.disabled=false;}};
  }
  await Promise.allSettled([loadStatus().catch(err=>{if(live())$('#cut-file-status').textContent=err.message;}),loadHistory().catch(err=>{if(live())$('#cut-history').textContent=err.message;})]);

}
