export async function renderCkd(ctx){
  const {api,PhoneScanner,state,escape:e,number:n,field,button,icon,pageTop,toast,detail,canWrite,scanFlowBar,setContinuousScan,stopCamera,updateCaptureUI,showScanCode}=ctx;
  const $=s=>document.querySelector(s);let camera=null,autoCamera=false,current=null,images={},checkEpoch=0,checkTimer=null;
  const owner=state.user.id,key='wa-ckd-workbook-u'+owner;
  $('#main').innerHTML=pageTop('Kiểm tra CKD','')+`
    <section class="panel ckd-source"><div class="table-tools"><h2>Đơn hàng SO</h2><a id="ckd-export" class="button small">${icon('download')} Xuất báo cáo</a></div><label class="field"><select id="ckd-workbook" aria-label="Đơn hàng SO"><option value="">Đang tải…</option></select></label><details><summary>Nhập Excel</summary><input type="file" id="ckd-file" accept=".xlsx" ${canWrite()?'':'disabled'}><p id="ckd-import-status" role="status"></p></details></section>
    <div class="columns"><section class="panel ckd-capture"><h2>Quét hai mã cho một box</h2><div class="ckd-steps"><span id="ckd-step-samsung" class="active">1 · Samsung</span><span id="ckd-step-item">2 · ITEM</span></div><button class="button primary full" id="ckd-camera">${icon('scan')} Quét camera · Samsung → ITEM</button><form id="ckd-pair-form">${field('1. Mã Samsung','ckd-samsung',{extra:'maxlength="500" autocapitalize="characters"',placeholder:'Quét mã Samsung trước'})}${field('2. ITEM code','ckd-item',{extra:'maxlength="500" autocapitalize="characters"',placeholder:'Quét mã ITEM trên box'})}<p class="form-message" id="ckd-pair-error" role="alert"></p><div class="actions equal"><button class="button" type="button" id="ckd-reset">Quét lại</button><button class="button primary" type="submit">Đối chiếu</button></div></form></section>
    <section class="panel"><h2>Tiến độ</h2><div id="ckd-progress"></div></section></div>
    <section class="panel"><div class="table-tools"><h2>Lịch sử</h2><button class="button small" id="ckd-reload">${icon('sync')} Tải lại</button></div><div id="ckd-history"></div></section>`;
  const source=$('.ckd-source'),sourceBody=document.createElement('div'),soDetails=document.createElement('details');
  source.querySelector('details').id='ckd-import-details';
  while(source.firstChild)sourceBody.append(source.firstChild);
  soDetails.id='ckd-so-settings';soDetails.innerHTML='<summary><span>Đơn hàng SO</span><span id="ckd-so-summary">Chọn đơn hàng</span></summary>';soDetails.append(sourceBody);source.append(soDetails);
  const history=$('#ckd-history').closest('.panel');history.before(source);
  history.querySelector('.table-tools').insertBefore($('#ckd-export'),$('#ckd-reload'));sourceBody.querySelector('.table-tools').remove();
  $('.ckd-capture h2').textContent='Quét mã';$('#main .page-top .lead')?.remove();
  $('#ckd-camera').outerHTML=`${field('Phiên quét','ckd-session-title',{placeholder:'Tùy chọn',required:false,extra:'maxlength="80"'})}<div class="capture-actions"><button class="button primary" id="ckd-camera">${icon('scan')} Quét camera</button><button class="button scan-square" type="button" id="choose-photo">${icon('camera')}</button></div><button class="button small" type="button" id="ckd-change-order">Chọn SO</button>`;
  scanFlowBar($('.ckd-capture .capture-actions'),true);updateCaptureUI();
  $('#choose-photo').onclick=()=>{state.autoCapture=!state.autoCapture;try{localStorage.setItem('wa-auto-capture-u'+owner,String(state.autoCapture));}catch{}updateCaptureUI();};
  $('#ckd-change-order').onclick=()=>{soDetails.open=true;source.scrollIntoView({behavior:'smooth',block:'start'});};
  const manual=document.createElement('details');manual.id='ckd-manual-entry';manual.innerHTML='<summary>Nhập mã</summary>';$('#ckd-pair-form').before(manual);manual.append($('#ckd-pair-form'));
  $('#ckd-history').insertAdjacentHTML('beforebegin','<div class="tabs ckd-history-tabs" role="tablist"><button class="tab active" role="tab" data-ckd-tab="scan" aria-selected="true">Lượt scan</button><button class="tab" role="tab" data-ckd-tab="samsung" aria-selected="false">Theo Samsung</button><button class="tab" role="tab" data-ckd-tab="unsold" aria-selected="false">SO chưa scan</button></div>');
  document.querySelectorAll('[data-ckd-tab]').forEach(b=>b.onclick=()=>{historyTab=b.dataset.ckdTab;paintHistory();});
  history.insertAdjacentHTML('afterend','<section class="panel ckd-reports"><h2>Báo cáo</h2><select id="ckd-report-scope" aria-label="Phạm vi báo cáo"><option value="current">Đơn hiện tại</option><option value="all">Tất cả đơn</option></select><div class="actions mt" id="ckd-report-actions"><a class="button primary" id="ckd-report-zip">ZIP báo cáo + ảnh</a></div></section>');
  $('#ckd-report-actions').prepend($('#ckd-export'));$('#ckd-report-scope').onchange=reportLinks;
  function workbook(){return Number($('#ckd-workbook').value);}
  function body(){return {workbook_id:workbook(),session_name:$('#ckd-session-title').value,samsung:$('#ckd-samsung').value,item_code:$('#ckd-item').value};}
  function steps(){const done=Boolean($('#ckd-samsung').value.trim());$('#ckd-step-samsung').classList.toggle('done',done);$('#ckd-step-item').classList.toggle('active',done);}
  function reset(){checkEpoch++;clearTimeout(checkTimer);current=null;images={};$('#ckd-pair-form').reset();$('#ckd-pair-error').textContent='';steps();if(manual.open)$('#ckd-samsung').focus();}
  let historyTab='scan',historyData=null,historyLoadEpoch=0;const selectedChecks=new Set(),canDelete=state.user.role==='admin';
  function historyHTML(r){
    if(historyTab==='samsung')return r.summary.length?`<div class="table-wrap"><table><thead><tr><th>Samsung / ITEM</th><th>Lượt / Box</th><th>Đã bán / SO</th><th>Trạng thái</th></tr></thead><tbody>${r.summary.map(g=>`<tr><td>${e(g.samsung)}<small>${e(g.items.join(' / '))}</small></td><td>${n(g.scans)} lượt<small>${n(g.boxes)} PASS · ${n(g.ng)} NG</small></td><td>${n(g.total)} / ${n(g.target)}</td><td><span class="badge ${g.quantity_status==='Đủ'?'green':g.quantity_status==='Dư'?'red':'amber'}">${e(g.quantity_status)}</span></td></tr>`).join('')}</tbody></table></div>`:'Chưa có lượt quét.';
    if(historyTab==='unsold')return r.unsold.length?`<div class="table-wrap"><table><thead><tr><th>Samsung</th><th>ITEM</th><th>SO Maker</th><th>Selling Qty</th></tr></thead><tbody>${r.unsold.map(g=>`<tr><td>${e(g.samsung)}</td><td>${e(g.items.join(' / '))}</td><td>${e(g.so_makers.join(' / '))}</td><td>${n(g.target)}</td></tr>`).join('')}</tbody></table></div>`:'Tất cả mã SO đã có dữ liệu scan.';
    return r.checks.length?`<p class="muted ckd-history-count">${n(r.count)} lượt</p><div class="table-wrap"><table><thead><tr><th>Kết quả</th><th>Samsung / ITEM</th><th>QTY</th><th>Maker bán</th><th>Ảnh / QR</th><th>Description</th><th>Người quét</th></tr></thead><tbody>${r.checks.map(row=>`<tr><td><span class="badge ${row.status==='PASS'?'green':'red'}">${e(row.status)}</span><span class="ckd-qty-badge" data-qty="${row.check.quantity_status==='Đủ'?'full':row.check.quantity_status==='Dư'?'over':'under'}">${e(row.check.quantity_status||'')}</span></td><td>${e(row.samsung)}<small>${e(row.item_code)}</small></td><td>${n(row.qty)}<small>${e(row.check.session_name||'')}</small></td><td><span class="badge ${row.check.maker_match===undefined?'amber':row.check.maker_match?'green':'red'}">${e(row.check.selling_maker||'—')}</span></td><td><div class="ckd-evidence">${['samsung','item'].map(slot=>row[slot+'_image']?`<button class="icon-button" data-ckd-photo="${row.id}/${slot}" aria-label="Ảnh ${slot}"><img class="table-thumb" src="/api/ckd/checks/${row.id}/image/${slot}" alt="${slot}" loading="lazy"></button>`:'').join('')}</div><button class="button small" data-ckd-code="${row.id}" data-ckd-code-slot="samsung">QR Samsung</button><button class="button small" data-ckd-code="${row.id}" data-ckd-code-slot="item">QR ITEM</button></td><td class="wrap">${e(row.check.model?.description||'—')}</td><td>${e(row.scanner)}<small>${e(row.created_at)}</small></td></tr>`).join('')}</tbody></table></div>`:'Chưa có lượt quét.';
  }
  function paintHistory(){
    if(!historyData)return;$('#ckd-history').innerHTML=historyHTML(historyData);
    if(historyTab==='scan'&&canDelete)deleteControls();
    if(historyTab==='scan'&&historyData.next){$('#ckd-history').insertAdjacentHTML('beforeend','<button class="button small mt" id="ckd-history-more">Xem th\u00eam</button>');$('#ckd-history-more').onclick=async event=>{const button=event.currentTarget,id=workbook(),data=historyData,epoch=historyLoadEpoch,node=$('#ckd-history');button.disabled=true;try{const page=await api('/ckd/history?workbook_id='+id+'&before='+data.next);if(!node.isConnected||epoch!==historyLoadEpoch||workbook()!==id||historyData!==data)return;historyData={...page,checks:[...data.checks,...page.checks]};paintHistory();}catch(err){toast(err.message);if(button.isConnected)button.disabled=false;}};}
    document.querySelectorAll('[data-ckd-tab]').forEach(b=>{const active=b.dataset.ckdTab===historyTab;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));});
    document.querySelectorAll('[data-ckd-photo]').forEach(b=>b.onclick=()=>detail('Ảnh CKD',`<img class="photo-full" src="/api/ckd/checks/${b.dataset.ckdPhoto.replace('/', '/image/')}" alt="CKD">`));
    document.querySelectorAll('[data-ckd-code]').forEach(b=>b.onclick=()=>{const row=historyData.checks.find(x=>String(x.id)===b.dataset.ckdCode);showScanCode({id:row.id,barcode:b.dataset.ckdCodeSlot==='item'?row.item_code:row.check.raw_samsung||row.samsung});});
  }
  function deleteControls(){
    const root=$('#ckd-history');root.insertAdjacentHTML('afterbegin',`<div class="actions mt ckd-delete-actions">${button('Xóa đã chọn (0)','ckd-delete-selected','danger small')}${button('Xóa tất cả trong SO này','ckd-delete-all','danger small')}</div>`);
    const table=root.querySelector('table');if(table){const th=document.createElement('th');th.innerHTML='<input type="checkbox" id="ckd-select-all" aria-label="Chọn tất cả lượt CKD đã tải">';table.querySelector('thead tr').prepend(th);const action=document.createElement('th');action.textContent='Thao tác';table.querySelector('thead tr').append(action);
      table.querySelectorAll('tbody tr').forEach((tr,i)=>{const row=historyData.checks[i],cell=document.createElement('td');cell.innerHTML=`<input type="checkbox" data-ckd-select="${row.id}" aria-label="Chọn lượt CKD ${row.id}" ${selectedChecks.has(row.id)?'checked':''}>`;tr.prepend(cell);cell.firstChild.onchange=event=>{if(event.target.checked)selectedChecks.add(row.id);else selectedChecks.delete(row.id);update();};const actions=document.createElement('td');actions.innerHTML=`<button class="button danger small" type="button" data-ckd-delete="${row.id}">Xóa</button>`;tr.append(actions);actions.firstChild.onclick=()=>confirmDelete([row.id]);});
      $('#ckd-select-all').onchange=event=>{for(const row of historyData.checks)if(event.target.checked)selectedChecks.add(row.id);else selectedChecks.delete(row.id);root.querySelectorAll('[data-ckd-select]').forEach(c=>c.checked=selectedChecks.has(Number(c.dataset.ckdSelect)));update();};
    }
    function update(){const selected=$('#ckd-delete-selected');selected.textContent=`Xóa đã chọn (${n(selectedChecks.size)})`;selected.disabled=!selectedChecks.size;$('#ckd-delete-all').disabled=!historyData.count;const all=$('#ckd-select-all');if(all){all.checked=historyData.checks.length>0&&historyData.checks.every(r=>selectedChecks.has(r.id));all.indeterminate=historyData.checks.some(r=>selectedChecks.has(r.id))&&!all.checked;}}
    $('#ckd-delete-selected').onclick=()=>confirmDelete([...selectedChecks]);$('#ckd-delete-all').onclick=()=>confirmDelete(null);update();
  }
  function confirmDelete(ids){
    if(!canDelete||!historyData)return;const id=workbook(),data=historyData,count=ids?ids.length:data.count,node=$('#ckd-history');if(!count)return;
    checkEpoch++;clearTimeout(checkTimer);const name=$('#ckd-workbook').selectedOptions[0]?.textContent||'SO đang chọn';
    detail('Xóa lịch sử Check CKD?',`<p><strong>${e(name)}</strong></p><p>Xóa ${n(count)} lượt ${ids?'đã chọn':'trong SO này'} và ảnh đi kèm? Tiến độ, tổng QTY và trạng thái đủ/thiếu/dư sẽ được tính lại.</p><div class="actions equal">${button('Giữ lại','ckd-keep-history')}${button('Xóa lịch sử','ckd-confirm-delete','danger')}</div>`);
    $('#ckd-keep-history').onclick=()=>$('#detail-dialog').close();$('#ckd-confirm-delete').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{const result=await api('/ckd/history/delete',{method:'POST',data:{workbook_id:id,...(ids?{ids}:{all:true,through_id:data.max_id})}});if(button.isConnected)$('#detail-dialog').close();if(node.isConnected&&workbook()===id){current=null;await loadHistory();}toast(`Đã xóa ${n(result.deleted)} lượt CKD.`);}catch(err){toast(err.message);if(button.isConnected)button.disabled=false;}};
  }
  function reportLinks(){const scope=$('#ckd-report-scope').value==='all'?'&scope=all':'';$('#ckd-export').href='/api/ckd/export?workbook_id='+workbook()+scope;$('#ckd-report-zip').href='/api/ckd/report.zip?workbook_id='+workbook()+scope;}
  async function loadHistory(){
    reportLinks();const id=workbook(),epoch=++historyLoadEpoch,node=$('#ckd-history');selectedChecks.clear();historyData=null;node.textContent='Đang tải lịch sử…';
    if(!id){historyData=null;$('#ckd-history').textContent='Chọn SO.';$('#ckd-progress').closest('.panel').hidden=true;return;}
    const r=await api('/ckd/history?workbook_id='+id);if(!node.isConnected||epoch!==historyLoadEpoch||workbook()!==id)return;historyData=r;
    $('#ckd-progress').closest('.panel').hidden=!r.totals.length;
    $('#ckd-progress').innerHTML=r.totals.map(t=>`<div class="ckd-progress-row"><strong>${e(t.samsung)}</strong><span>${n(t.boxes)} box · ${n(t.total)} / ${n(t.target)}</span></div>`).join('');paintHistory();
  }
  function orderUI(){const name=$('#ckd-workbook').selectedOptions[0]?.textContent||'Chọn đơn hàng';$('#ckd-so-summary').textContent=name;}
  async function sources(selectId){const r=await api('/ckd/workbooks');if(!$('#ckd-workbook'))return;$('#ckd-workbook').innerHTML='<option value="">Chọn đơn hàng</option>'+r.workbooks.map(w=>`<option value="${w.id}">${e(w.name)}</option>`).join('');let saved;try{saved=localStorage.getItem(key);}catch{}$('#ckd-workbook').value=String(selectId||saved||r.workbooks[0]?.id||'');orderUI();await loadHistory();}
  $('#ckd-workbook').onchange=()=>{try{localStorage.setItem(key,String(workbook()));}catch{}reset();orderUI();loadHistory().catch(err=>toast(err.message));};
  $('#ckd-reload').onclick=()=>loadHistory().catch(err=>toast(err.message));$('#ckd-reset').onclick=reset;
  $('#ckd-file').onchange=async event=>{
    const file=event.target.files[0];if(!file)return;const status=$('#ckd-import-status');event.target.disabled=true;
    try{if(!/\.xlsx$/i.test(file.name)||file.size>18*1024*1024)throw Error('Chọn file .xlsx tối đa 18 MB.');status.textContent='Đang đọc và nhập hai sheet…';const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Không đọc được file.'));reader.readAsDataURL(file);});const r=await api('/ckd/import',{method:'POST',data:{file:data,name:file.name}});status.textContent=`Đã nhập ${r.orders} dòng SO, ${r.models} model. ${r.missing_moq} model cần kiểm tra MOQ khi sử dụng.`;await sources(r.id);reset();}catch(err){status.textContent=err.message;}finally{event.target.disabled=!canWrite();event.target.value='';}
  };
  async function showCheck(data,requestId=crypto.randomUUID(),evidence={...images},edit={open:[],qtyOverride:Object.hasOwn(data,'qty')}){
    if(!$('#ckd-pair-form')||state.user?.id!==owner)return;
    const version=++checkEpoch;
    const r=await api('/ckd/pair/check',{method:'POST',data});
    if(version!==checkEpoch||!$('#ckd-pair-form'))return;
    current={data,requestId};$('#ckd-samsung').value=data.samsung;$('#ckd-item').value=data.item_code;steps();
    const pencil='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z M14 5l5 5"/></svg>';
    const code=(slot,label,value)=>`<div class="ckd-result-code"><span>${label}</span><strong id="ckd-result-${slot}" role="textbox" aria-label="${label}" aria-readonly="true" contenteditable="false" tabindex="-1">${e(value)}</strong><button type="button" class="ckd-edit-qty" data-edit-code="${slot}" aria-label="Sửa ${label}">${pencil}</button></div>`;
    detail('Bảng check CKD',`<div class="result-banner ${r.pass?'':'fail'}" title="${e(r.reason)}">${r.pass?'PASS · Hai mã khớp':'NG · Cần kiểm tra'}</div><div class="result-info">${code('samsung','Samsung',r.raw_samsung||r.samsung)}${code('item','ITEM',r.item_code)}</div><dl class="detail-list ckd-details">${[['Item',r.model?.item||'—'],['Description',r.model?.description||'—'],['SO Maker',r.order?.so_maker||'—'],['Maker bán',r.selling_maker||'MM trống'],['Vendor',r.selling_vendor||r.order?.vendor||'—'],['Type',r.order?.type||'—'],['Selling Q’ty',n(r.target)],['MOQ',r.qty?n(r.qty):'—'],['Đã xác nhận',n(r.boxes)+' box · '+n(r.total)],['Sau box này',n(r.pass?r.after:r.total)]].map(([k,v])=>`<dt>${k}</dt><dd>${k==='Maker bán'?`<span id="ckd-selling-maker" class="badge ${r.maker_match?'green':'red'}">${e(v)}</span>`:k==='MOQ'?`<span id="ckd-qty-value">${e(v)}</span><button type="button" id="ckd-edit-qty" class="ckd-edit-qty" aria-label="Sửa MOQ">${pencil}</button><input type="number" id="ckd-qty" aria-label="MOQ" value="${r.qty||''}" min="1" max="1000000000" step="1" inputmode="numeric" hidden>`:e(v)}</dd>`).join('')}</dl><div class="notice ${r.over?'error':'warning'}">${r.pass?(r.over?'VƯỢT '+n(r.after-r.target)+' so với Selling Qty.':r.after===r.target?'Đủ số lượng cần bán.':'Còn '+n(Math.max(0,r.target-r.after))+' sau box này.'):'NG không cộng số lượng SO.'}</div><p id="ckd-calculating" class="muted" role="status"></p><p id="ckd-save-error" class="form-message" role="alert">${r.needs_qty?'Nhập số lượng box.':''}</p><div class="actions equal mt"><button class="button" id="ckd-skip">Không lưu</button><button class="button ${r.pass?'primary':'danger'}" id="ckd-save" ${canWrite()&&(!r.pass||r.qty)?'':'disabled'}>${r.pass?'Xác nhận lưu box':'Lưu NG'}</button></div>`);
    let qtyOverrideState=edit.qtyOverride;const open=new Set(edit.open||[]);if(r.needs_qty)open.add('qty');
    function reveal(slot,focus=true){
      const input=$('#'+(slot==='qty'?'ckd-qty':'ckd-result-'+slot)),close=focus&&open.has(slot);
      if(close)open.delete(slot);else open.add(slot);
      if(slot==='qty'){input.hidden=close;if(!close&&focus){input.focus();input.select();}return;}
      input.contentEditable=close?'false':'plaintext-only';input.setAttribute('aria-readonly',String(close));input.classList.toggle('editing',!close);
      if(!close&&focus){input.focus({preventScroll:true});const range=document.createRange();range.selectNodeContents(input);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);}
    }
    for(const slot of open)reveal(slot,false);
    $('#ckd-edit-qty').onclick=()=>reveal('qty');document.querySelectorAll('[data-edit-code]').forEach(b=>b.onclick=()=>reveal(b.dataset.editCode));
    function calculate(id,immediate=false){
      clearTimeout(checkTimer);checkEpoch++;$('#ckd-save').disabled=true;
      if(id==='ckd-qty')qtyOverrideState=true;const quantity=$('#ckd-qty').value,override=qtyOverrideState;
      const nextData={...data,samsung:$('#ckd-result-samsung').textContent,item_code:$('#ckd-result-item').textContent};if(override)nextData.qty=quantity;else delete nextData.qty;
      if(override&&(!quantity||!Number.isSafeInteger(Number(quantity))||Number(quantity)<=0)){ $('#ckd-calculating').textContent='Nhập số lượng lớn hơn 0.';return; }
      $('#ckd-calculating').textContent='Đang tính…';
      checkTimer=setTimeout(async()=>{
        const active=document.activeElement,focus=active?.id,selection=active?.isContentEditable?window.getSelection()?.focusOffset:active?.selectionStart,scroll=$('#detail-dialog').scrollTop;
        try{await showCheck(nextData,requestId,evidence,{open:[...open],qtyOverride:override,focus,selection,scroll});}
        catch(err){if($('#ckd-save-error')){$('#ckd-save-error').textContent=err.message;$('#ckd-calculating').textContent='';}}
      },immediate?0:350);
    }
    for(const id of ['ckd-qty','ckd-result-samsung','ckd-result-item']){$('#'+id).oninput=()=>calculate(id);$('#'+id).onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();calculate(id,true);}};}
    $('#detail-dialog').scrollTop=edit.scroll||0;
    if(edit.focus){const input=$('#'+edit.focus);if(input){input.focus({preventScroll:true});try{if(edit.selection!==null&&edit.selection!==undefined){if(input.isContentEditable){const range=document.createRange();range.setStart(input.firstChild||input,Math.min(edit.selection,input.textContent.length));range.collapse(true);const selected=window.getSelection();selected.removeAllRanges();selected.addRange(range);}else input.setSelectionRange(edit.selection,edit.selection);}}catch{}}}
    $('#detail-dialog').onclose=()=>{checkEpoch++;clearTimeout(checkTimer);};
    async function next(){reset();await loadHistory();if(autoCamera&&state.continuousScan&&$('#ckd-pair-form'))startCamera();}
    $('#ckd-skip').onclick=()=>{$('#detail-dialog').close();next().catch(err=>toast(err.message));};
    $('#ckd-save').onclick=async event=>{
      const btn=event.currentTarget;btn.disabled=true;
      try{
        const result=await api('/ckd/pair/save',{method:'POST',data:{...data,qty:r.qty||undefined,images:evidence,request_id:requestId,accept_ng:!r.pass,accept_over:r.pass&&r.over}});
        $('#detail-dialog').close();toast(result.duplicate?'Đã lưu trước đó.':r.pass?'Đã lưu box PASS.':'Đã lưu NG.');await next();
      }catch(err){if($('#ckd-save-error'))$('#ckd-save-error').textContent=err.message;btn.disabled=false;}
    };
  }
  function startCamera(){
    if(!workbook()){toast('Chọn file SO / CKD model list trước.');soDetails.open=true;source.scrollIntoView({behavior:'smooth'});return;}stopCamera();camera?.close();autoCamera=true;
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
      if(clear){input(slot).value='';delete images[slot];}target=slot;steps();pairUI();camera.resumeSingle();
      // Clear the held result too: the next deliberate read may be the same code.
      camera.lastCode='';camera.lastRead='';
    }
    camera=new PhoneScanner($('#camera-dialog'),{title:$('#ckd-samsung').value?'CKD · 2/2 Quét ITEM':'CKD · 1/2 Quét Samsung',accountKey:'u'+owner,continuous:state.continuousScan,onContinuousChange:setContinuousScan,
      onCode:async code=>{
        if(!$('#ckd-pair-form'))throw Error('Màn hình đã thay đổi.');
        if(state.autoCapture){const video=camera.video;if(!video?.videoWidth||video.readyState<2)throw Error('Chưa chụp được ảnh. Giữ mã trong khung rồi quét lại.');const canvas=document.createElement('canvas'),scale=Math.min(1,960/video.videoWidth);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);const thumb=document.createElement('canvas');thumb.width=128;thumb.height=Math.max(1,Math.round(canvas.height*128/canvas.width));thumb.getContext('2d').drawImage(canvas,0,0,thumb.width,thumb.height);images[target]={source:canvas.toDataURL('image/jpeg',.75),thumbnail:thumb.toDataURL('image/jpeg',.65)};}else delete images[target];
        input(target).value=code;steps();target=$('#ckd-samsung').value.trim()?'item':'samsung';pairUI();
        if(!$('#ckd-samsung').value.trim()||!$('#ckd-item').value.trim())return {message:target==='item'?'Đã nhận Samsung. Tiếp tục quét ITEM trên box.':'Đã nhận ITEM. Tiếp tục quét Samsung.'};
        const data=body();setTimeout(()=>{camera?.close();showCheck(data).catch(err=>toast(err.message));},0);return {message:'Đã đủ hai mã. Đang đối chiếu…'};
      },onManual:()=>{manual.open=true;$('#ckd-samsung').value?$('#ckd-item').focus():$('#ckd-samsung').focus();},onAuthExpired:()=>{camera?.close();location.hash='#account';}
    });
    $('#camera-dialog').classList.add('ckd-camera');
    $('#scanner-result').insertAdjacentHTML('beforebegin',`<div class="ckd-camera-pair">${[['samsung','Samsung'],['item','ITEM']].map(([slot,label])=>`<div class="ckd-camera-slot" id="ckd-camera-${slot}"><button type="button" class="ckd-camera-select" data-slot="${slot}" aria-label="Quét vào ô ${label}"><span class="ckd-camera-label">${label}</span><span class="ckd-camera-code">Chưa quét</span></button><button type="button" class="ckd-camera-clear" data-clear-slot="${slot}" aria-label="Xóa mã ${label}" hidden>×</button></div>`).join('')}</div>`);
    document.querySelectorAll('[data-slot]').forEach(b=>b.onclick=()=>choose(b.dataset.slot));
    document.querySelectorAll('[data-clear-slot]').forEach(b=>b.onclick=()=>choose(b.dataset.clearSlot,true));
    pairUI();camera.open();
  }
  $('#ckd-camera').onclick=startCamera;
  $('#ckd-samsung').oninput=()=>{delete images.samsung;steps();};$('#ckd-item').oninput=()=>{delete images.item;};$('#ckd-samsung').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();steps();$('#ckd-item').focus();}};
  $('#ckd-item').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();$('#ckd-pair-form').requestSubmit();}};
  $('#ckd-pair-form').onsubmit=async event=>{event.preventDefault();autoCamera=false;try{await showCheck(body());}catch(err){$('#ckd-pair-error').textContent=err.message;}};
  await sources();
}
