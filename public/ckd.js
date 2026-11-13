export async function renderCkd(ctx){
  const {api,PhoneScanner,state,escape:e,number:n,field,button,icon,pageTop,toast,detail,canWrite,scanFlowBar,setContinuousScan,stopCamera}=ctx;
  const $=s=>document.querySelector(s);let camera=null,autoCamera=false,current=null;
  const owner=state.user.id,key='wa-ckd-workbook-u'+owner;
  $('#main').innerHTML=pageTop('Kiểm tra CKD','Samsung → ITEM → Đối chiếu SO & model list')+`
    <section class="panel ckd-source"><div class="table-tools"><h2>Đơn hàng SO</h2><a id="ckd-export" class="button small">${icon('download')} Xuất Excel</a></div><label class="field"><span>File SO / CKD model list</span><select id="ckd-workbook"><option value="">Đang tải…</option></select></label><details><summary>Nhập file Excel mới</summary><p class="muted">Sheet1: SO · Sheet2: CKD model list. Mỗi file nhập tạo một đơn riêng, giữ lịch sử đơn cũ.</p><input type="file" id="ckd-file" accept=".xlsx" ${canWrite()?'':'disabled'}><p id="ckd-import-status" role="status"></p></details></section>
    <div class="columns"><section class="panel ckd-capture"><h2>Quét hai mã cho một box</h2><div class="ckd-steps"><span id="ckd-step-samsung" class="active">1 · Samsung</span><span id="ckd-step-item">2 · ITEM</span></div><button class="button primary full" id="ckd-camera">${icon('scan')} Quét camera · Samsung → ITEM</button><p class="muted">Dùng cùng camera Barcode / QR, zoom và chế độ nhãn bóng. Mỗi lần xác nhận tương ứng một box.</p><form id="ckd-pair-form">${field('1. Mã Samsung','ckd-samsung',{extra:'maxlength="500" autocapitalize="characters"',placeholder:'Quét mã Samsung trước'})}${field('2. ITEM code','ckd-item',{extra:'maxlength="500" autocapitalize="characters"',placeholder:'Quét mã ITEM trên box'})}<p class="form-message" id="ckd-pair-error" role="alert"></p><div class="actions equal"><button class="button" type="button" id="ckd-reset">Quét lại</button><button class="button primary" type="submit">Đối chiếu</button></div></form></section>
    <section class="panel"><h2>Tiến độ đơn hàng</h2><p class="muted">Cộng MOQ của các box PASS theo mã Samsung, gồm nhiều ITEM bán trong cùng SO. NG chỉ nằm trong lịch sử.</p><div id="ckd-progress"></div></section></div>
    <section class="panel"><div class="table-tools"><h2>Lịch sử check CKD</h2><button class="button small" id="ckd-reload">${icon('sync')} Tải lại</button></div><div id="ckd-history"></div></section>`;
  scanFlowBar($('.ckd-capture'));
  function workbook(){return Number($('#ckd-workbook').value);}
  function body(){return {workbook_id:workbook(),samsung:$('#ckd-samsung').value,item_code:$('#ckd-item').value};}
  function steps(){const done=Boolean($('#ckd-samsung').value.trim());$('#ckd-step-samsung').classList.toggle('done',done);$('#ckd-step-item').classList.toggle('active',done);}
  function reset(){current=null;$('#ckd-pair-form').reset();$('#ckd-pair-error').textContent='';steps();$('#ckd-samsung').focus();}
  async function loadHistory(){
    const id=workbook();$('#ckd-export').href='/api/ckd/export?workbook_id='+id;
    if(!id){$('#ckd-history').textContent='Nhập hoặc chọn file Excel để bắt đầu.';$('#ckd-progress').textContent='Chưa chọn đơn hàng.';return;}
    const r=await api('/ckd/history?workbook_id='+id);if(!$('#ckd-history')||workbook()!==id)return;
    $('#ckd-progress').innerHTML=r.totals.length?r.totals.map(t=>`<div class="ckd-progress-row"><strong>${e(t.samsung)}</strong><span>${n(t.boxes)} box · ${n(t.total)} / ${n(t.target)}${t.total>t.target?' · VƯỢT':t.total===t.target?' · ĐỦ':' · Còn '+n(t.target-t.total)}</span></div>`).join(''):'Chưa xác nhận box PASS.';
    $('#ckd-history').innerHTML=r.checks.length?`<div class="table-wrap"><table><thead><tr><th>Kết quả</th><th>Samsung / ITEM</th><th>Box / MOQ</th><th>Description</th><th>Người quét</th></tr></thead><tbody>${r.checks.map(row=>`<tr><td><span class="badge ${row.status==='PASS'?'green':'red'}">${e(row.status)}</span><span class="ckd-qty-badge" data-qty="${row.check.quantity_status==='\u0110\u1ee7'?'full':row.check.quantity_status==='D\u01b0'?'over':'under'}">${e(row.check.quantity_status||'')}</span>${row.counted?'':'<small>Không cộng SO</small>'}</td><td>${e(row.samsung)}<small>${e(row.item_code)}</small></td><td>${e(row.box_ref)}<small>${n(row.qty)}</small></td><td class="wrap">${e(row.check.model?.description||'—')}</td><td>${e(row.scanner)}<small>${e(row.created_at)}</small></td></tr>`).join('')}</tbody></table></div>`:'Chưa có lượt check. Quét đủ hai mã để đối chiếu.';
  }
  async function sources(selectId){const r=await api('/ckd/workbooks');if(!$('#ckd-workbook'))return;$('#ckd-workbook').innerHTML='<option value="">Chọn đơn hàng</option>'+r.workbooks.map(w=>`<option value="${w.id}">${e(w.name)} · ${w.orders} dòng SO / ${w.models} model</option>`).join('');let saved;try{saved=localStorage.getItem(key);}catch{}$('#ckd-workbook').value=String(selectId||saved||r.workbooks[0]?.id||'');await loadHistory();}
  $('#ckd-workbook').onchange=()=>{try{localStorage.setItem(key,String(workbook()));}catch{}reset();loadHistory().catch(err=>toast(err.message));};
  $('#ckd-reload').onclick=()=>loadHistory().catch(err=>toast(err.message));$('#ckd-reset').onclick=reset;
  $('#ckd-file').onchange=async event=>{
    const file=event.target.files[0];if(!file)return;const status=$('#ckd-import-status');event.target.disabled=true;
    try{if(!/\.xlsx$/i.test(file.name)||file.size>18*1024*1024)throw Error('Chọn file .xlsx tối đa 18 MB.');status.textContent='Đang đọc và nhập hai sheet…';const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Không đọc được file.'));reader.readAsDataURL(file);});const r=await api('/ckd/import',{method:'POST',data:{file:data,name:file.name}});status.textContent=`Đã nhập ${r.orders} dòng SO, ${r.models} model. ${r.missing_moq} model cần kiểm tra MOQ khi sử dụng.`;await sources(r.id);reset();}catch(err){status.textContent=err.message;}finally{event.target.disabled=!canWrite();event.target.value='';}
  };
  async function showCheck(data,requestId=crypto.randomUUID(),boxRef='BOX-'+crypto.randomUUID().slice(0,12)){
    if(!$('#ckd-pair-form')||state.user?.id!==owner)return;
    const r=await api('/ckd/pair/check',{method:'POST',data});current={data,requestId,boxRef};
    detail('Bảng check CKD',`<div class="result-banner ${r.pass?'':'fail'}">${r.pass?'PASS · Hai mã khớp':'NG · Cần kiểm tra'}</div><p class="result-info">Samsung: <strong>${e(r.samsung)}</strong><br>ITEM code: <strong>${e(r.item_code)}</strong></p><div class="notice ${r.pass?'success':'error'}">${e(r.reason)}</div><dl class="detail-list ckd-details">${[['Item',r.model?.item||'—'],['Description',r.model?.description||'—'],['Model Vendor',r.model?.maker||'—'],['SO Maker',r.order?.so_maker||'—'],['Maker bán',r.order?.maker||'—'],['Vendor',r.order?.vendor||'—'],['Type',r.order?.type||'—'],['Selling Q’ty',n(r.target)],['MOQ theo model',r.model?.moq_text||'Chưa có'],['Đã xác nhận',n(r.boxes)+' box · '+n(r.total)],['Sau box này',n(r.pass?r.after:r.total)]].map(([k,v])=>`<dt>${k}</dt><dd>${e(v)}</dd>`).join('')}</dl><div class="notice ${r.over?'error':'warning'}">${r.pass?(r.over?'VƯỢT '+n(r.after-r.target)+' so với Selling Qty.':r.after===r.target?'Đủ số lượng cần bán.':'Còn '+n(Math.max(0,r.target-r.after))+' sau box này.'):'Lưu NG chỉ ghi lịch sử, không cộng số lượng SO.'}</div><div class="field-row">${field('MOQ / số lượng box thực tế','ckd-qty',{type:'number',required:false,value:r.qty||'',extra:'min="1" max="1000000000" step="1" inputmode="numeric"'})}${field('Mã box duy nhất','ckd-box',{value:boxRef,extra:'maxlength="200"'})}</div><button class="button small" id="ckd-recheck">Tính lại số lượng</button><p id="ckd-save-error" class="form-message" role="alert">${r.needs_qty?'MOQ không phải một số cố định. Nhập số lượng box thực tế rồi tính lại.':''}</p><div class="actions equal mt"><button class="button" id="ckd-skip">Không lưu</button><button class="button ${r.pass?'primary':'danger'}" id="ckd-save" ${canWrite()&&(!r.pass||r.qty)?'':'disabled'}>${r.pass?'Xác nhận lưu box':'Lưu NG (không cộng SO)'}</button></div>`);
    $('#detail-dialog').scrollTop=0;
    $('#ckd-recheck').onclick=()=>showCheck({...data,qty:$('#ckd-qty').value},requestId,$('#ckd-box').value).catch(err=>{$('#ckd-save-error').textContent=err.message;});
    async function next(){reset();await loadHistory();if(autoCamera&&state.continuousScan&&$('#ckd-pair-form'))startCamera();}
    $('#ckd-skip').onclick=()=>{$('#detail-dialog').close();next().catch(err=>toast(err.message));};
    $('#ckd-save').onclick=async event=>{
      const btn=event.currentTarget;btn.disabled=true;
      try{
        const qty=$('#ckd-qty').value;
        if(String(qty)!==String(r.qty||''))throw Error('Số lượng vừa thay đổi. Bấm Tính lại số lượng trước khi lưu.');
        const result=await api('/ckd/pair/save',{method:'POST',data:{...data,qty,request_id:requestId,box_ref:$('#ckd-box').value,accept_ng:!r.pass,accept_over:r.pass&&r.over}});
        $('#detail-dialog').close();toast(result.duplicate?'Lượt này đã lưu, không cộng lần nữa.':r.pass?'Đã lưu box PASS.':'Đã lưu lịch sử NG, không cộng SO.');await next();
      }catch(err){if($('#ckd-save-error'))$('#ckd-save-error').textContent=err.message;btn.disabled=false;}
    };
  }
  function startCamera(){
    if(!workbook()){toast('Chọn file SO / CKD model list trước.');return;}stopCamera();camera?.close();autoCamera=true;
    let target=$('#ckd-samsung').value.trim()?'item':'samsung';
    const input=slot=>$('#ckd-'+slot);
    function pairUI(){
      for(const slot of ['samsung','item']){
        const value=input(slot).value.trim(),card=$('#ckd-camera-'+slot);
        card.classList.toggle('active',target===slot);card.classList.toggle('filled',Boolean(value));
        card.querySelector('.ckd-camera-code').textContent=value||'Chưa quét';
        card.querySelector('.ckd-camera-select').setAttribute('aria-pressed',String(target===slot));
        card.querySelector('.ckd-camera-clear').hidden=!value;
      }
      $('#scanner-title').textContent=target==='samsung'?'CKD · 1/2 Quét Samsung':'CKD · 2/2 Quét ITEM';
    }
    function choose(slot,clear=false){
      if(clear)input(slot).value='';target=slot;steps();pairUI();camera.resumeSingle();
      // Clear the held result too: the next deliberate read may be the same code.
      camera.lastCode='';camera.lastRead='';
    }
    camera=new PhoneScanner($('#camera-dialog'),{title:$('#ckd-samsung').value?'CKD · 2/2 Quét ITEM':'CKD · 1/2 Quét Samsung',accountKey:'u'+owner,continuous:state.continuousScan,onContinuousChange:setContinuousScan,
      onCode:async code=>{
        if(!$('#ckd-pair-form'))throw Error('Màn hình đã thay đổi.');
        input(target).value=code;steps();target=$('#ckd-samsung').value.trim()?'item':'samsung';pairUI();
        if(!$('#ckd-samsung').value.trim()||!$('#ckd-item').value.trim())return {message:target==='item'?'Đã nhận Samsung. Tiếp tục quét ITEM trên box.':'Đã nhận ITEM. Tiếp tục quét Samsung.'};
        const data=body();setTimeout(()=>{camera?.close();showCheck(data).catch(err=>toast(err.message));},0);return {message:'Đã đủ hai mã. Đang đối chiếu…'};
      },onManual:()=>{$('#ckd-samsung').value?$('#ckd-item').focus():$('#ckd-samsung').focus();},onAuthExpired:()=>{camera?.close();location.hash='#account';}
    });
    $('#camera-dialog').classList.add('ckd-camera');
    $('#scanner-result').insertAdjacentHTML('beforebegin',`<div class="ckd-camera-pair">${[['samsung','Samsung'],['item','ITEM']].map(([slot,label])=>`<div class="ckd-camera-slot" id="ckd-camera-${slot}"><button type="button" class="ckd-camera-select" data-slot="${slot}" aria-label="Quét vào ô ${label}"><span class="ckd-camera-label">${label}</span><span class="ckd-camera-code">Chưa quét</span></button><button type="button" class="ckd-camera-clear" data-clear-slot="${slot}" aria-label="Xóa mã ${label}" hidden>×</button></div>`).join('')}</div>`);
    document.querySelectorAll('[data-slot]').forEach(b=>b.onclick=()=>choose(b.dataset.slot));
    document.querySelectorAll('[data-clear-slot]').forEach(b=>b.onclick=()=>choose(b.dataset.clearSlot,true));
    pairUI();camera.open();
  }
  $('#ckd-camera').onclick=startCamera;
  $('#ckd-samsung').oninput=steps;$('#ckd-samsung').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();steps();$('#ckd-item').focus();}};
  $('#ckd-item').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();$('#ckd-pair-form').requestSubmit();}};
  $('#ckd-pair-form').onsubmit=async event=>{event.preventDefault();autoCamera=false;try{await showCheck(body());}catch(err){$('#ckd-pair-error').textContent=err.message;}};
  await sources();
}
