import {renderHolding} from '/holding.js?v=20261114-28';
import { renderCutting } from '/cutting.js?v=20261114-23';
import { renderCkd } from '/ckd.js?v=20261113-17';
import { PhoneScanner, zxing } from '/scanner.js?v=20261114-27';
const $ = (s, root = document) => root.querySelector(s);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = {
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 1h18"/>',
  settings: '<path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z"/><circle cx="12" cy="12" r="3"/>',
  home: '<path d="m3 10 9-7 9 7v11h-7v-7h-4v7H3Z"/>',
  scan: '<path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5M7 6v12M10 6v12M14 6v12M17 6v12M1 12h22"/>',
  ckd: '<rect x="5" y="5" width="14" height="17" rx="2"/><rect x="9" y="2" width="6" height="5" rx="1"/><path d="m8 13 3 3 5-6"/>',
  cut: '<circle cx="5" cy="6" r="3"/><circle cx="5" cy="18" r="3"/><path d="m7.5 7.5 13 12m-13-3 13-12M14 12l7 7"/>',
  box: '<path d="m12 2 9 5-9 5-9-5Zm-9 5v10l9 5 9-5V7M12 12v10M7.5 4.5l9 5v5"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 7 7M7 8h6m-6 4h4"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  diagonal: '<path d="M6 18 18 6H8m10 0v10"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  camera: '<path d="M3 6h4l2-3h6l2 3h4v15H3Z"/><circle cx="12" cy="13" r="4"/>',
  sync: '<path d="M20 7a9 9 0 0 0-15-3L2 7m0-5v5h5M4 17a9 9 0 0 0 15 3l3-3m0 5v-5h-5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  shield: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z"/><path d="m8 12 3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  assistant: '<path d="m11 3 2.3 6.7L20 12l-6.7 2.3L11 21l-2.3-6.7L2 12l6.7-2.3ZM20 2v5m-2.5-2.5h5"/>',
  logout: '<path d="M9 3H3v18h6m0-9h13m-5-5 5 5-5 5"/>',
  photo: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="2"/><path d="m3 18 6-6 4 4 4-6 4 6"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
  plus: '<path d="M12 4v16M4 12h16"/>'
};
const icon = (name, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${icons[name] || icons.box}</svg>`;
const roleName = role => ({ admin: 'Quản trị viên', inspector: 'Nhân viên kiểm tra', viewer: 'Chỉ xem' }[role] || role);
const number = n => Number(n).toLocaleString('en-US');
const time = value => new Date(value.replace(' ', 'T') + 'Z').toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
const defaultNavigation=['home','scan','assistant','account'];
const state = { user: null, csrf: null, needsSetup: false, page: '', mode: 'Label', image: null, imageName: '', connected: false, scans: [], next: null,navigation:[...defaultNavigation],continuousScan:true,autoCapture:true };
let toastTimer, phoneScanner, renderId = 0, scanLoadRequest = 0;
function toast(message) { const el = $('#toast'); el.textContent = message; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 5500); }
function connection(ok) {
  state.connected = ok; const el = $('#connection');
  el.classList.toggle('offline', !ok); $('span', el).textContent = ok ? 'Server đã kết nối' : 'Chưa kết nối server';
}
async function api(path, { method = 'GET', data, file, timeoutMs = 20000 } = {}) {
  let response;
  try { response = await fetch('/api' + path, { method, credentials: 'same-origin', headers: { ...(file ? { 'Content-Type':'application/octet-stream','X-MM-File-Name':encodeURIComponent(file.name) } : data ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' && state.csrf ? { 'X-CSRF-Token': state.csrf } : {}) }, body: file || (data ? JSON.stringify(data) : undefined), signal: AbortSignal.timeout(timeoutMs) }); }
  catch { connection(false); const error = new Error('Chưa kết nối được server. Vui lòng kiểm tra mạng.'); error.network = true; throw error; }
  if(response.status===401&&path!=='/login'){state.user=null;state.csrf=null;}
  let result;
  try{result=await response.json();if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Invalid response');}
  catch{
    connection(false);
    const messages={408:'Tải file quá thời gian máy chủ cho phép. Kiểm tra mạng và thử lại.',413:'File vượt dung lượng máy chủ cho phép.',502:'Kết nối tới máy chủ bị ngắt. Vui lòng thử lại.',503:'Máy chủ đang bận. Vui lòng thử lại.',504:'Máy chủ xử lý quá thời gian. Vui lòng thử lại.'};
    const error=new Error(messages[response.status]||'Chưa nhận được đầy đủ kết quả từ máy chủ. Vui lòng thử lại.');error.status=response.status;error.network=response.ok||[408,502,503,504].includes(response.status);throw error;
  }
  connection(true);
  if (!response.ok) {
    if (response.status === 401 && path !== '/login') { state.user = null; state.csrf = null; }
    const error = new Error(result.error || 'Không thể thực hiện thao tác.'); error.status = response.status; error.code=result.code; error.count=result.count; throw error;
  }
  return result;
}
async function session() {
  const s = await api('/me'); state.user = s.user; state.csrf = s.csrf; state.needsSetup = s.needsSetup;
  await loadPreferences(); renderNavigation();
}
async function loadPreferences() {
  try {state.autoCapture=localStorage.getItem('wa-auto-capture-u'+state.user?.id)!=='false';}catch{state.autoCapture=true;}
  state.navigation=[...defaultNavigation];state.continuousScan=true;
  if (state.user) try {const result=await api('/preferences');state.navigation=result.navigation;state.continuousScan=result.continuous_scan!==false;} catch(e) {if(!e.network && e.status!==401) toast(e.message);}
}
function updateContinuousUI() {
  document.querySelectorAll('[data-continuous-toggle]').forEach(button=>{button.setAttribute('aria-pressed',String(state.continuousScan));button.classList.toggle('enabled',state.continuousScan);const label='Quét liên tục: '+(state.continuousScan?'Bật':'Tắt');button.setAttribute('aria-label',label);button.title=label;if(button.closest('.capture-actions'))button.innerHTML=icon('sync');else button.textContent=label;});
  if(phoneScanner&&phoneScanner.continuous!==state.continuousScan)phoneScanner.setContinuous(state.continuousScan,false);
}
async function setContinuousScan(on) {
  state.continuousScan=on;updateContinuousUI();
  try{await api('/preferences',{method:'POST',data:{continuous_scan:on}});}catch(e){toast(e.network?'Đã áp dụng chế độ quét trên màn hình này; chưa lưu lên tài khoản vì mất kết nối.':e.message);}
}
function scanFlowBar(target, compact = false) {
  if(compact){
    const toggle=document.createElement('button');toggle.type='button';toggle.className='button scan-square';toggle.dataset.continuousToggle='';
    target.insertBefore(toggle,$('#choose-photo'));toggle.onclick=()=>setContinuousScan(!state.continuousScan);updateContinuousUI();return;
  }
  const row=document.createElement('div');row.className='scan-flow-bar';row.innerHTML='<span>Camera & máy quét</span><button type="button" data-continuous-toggle></button>';
  target.prepend(row);row.querySelector('button').onclick=()=>setContinuousScan(!state.continuousScan);updateContinuousUI();
}
function updateCaptureUI(){
  const button=$('#choose-photo');if(!button)return;
  const label='Tự chụp ảnh khi đọc mã: '+(state.autoCapture?'Bật':'Tắt');
  button.setAttribute('aria-label',label);button.title=label;button.setAttribute('aria-pressed',String(state.autoCapture));button.classList.toggle('enabled',state.autoCapture);
}

function button(text, id, style = '', symbol = '') { return `<button class="button ${style}" ${id ? `id="${id}"` : ''}>${symbol ? icon(symbol) : ''}${text}</button>`; }
function field(label, name, options = {}) {
  const { type = 'text', placeholder = '', value = '', required = true, extra = '', autocomplete = 'off' } = options;
  return `<div class="field"><label for="${escape(name)}">${label}</label><input id="${escape(name)}" name="${escape(name)}" type="${type}" placeholder="${escape(placeholder)}" value="${escape(value)}" autocomplete="${autocomplete}" ${required ? 'required' : ''} ${extra}></div>`;
}
function pageTop(title, subtitle, action = '', backHref = '#home', backLabel = 'Trang chủ') { return `<div class="page-top"><div><a class="back" href="${escape(backHref)}">${icon('back')} ${escape(backLabel)}</a><h1>${title}</h1><p class="lead">${subtitle}</p></div>${action}</div>`; }
function empty(title, detail, symbol = 'box') { return `<div class="empty">${icon(symbol)}<strong>${title}</strong>${detail}</div>`; }
function needsLogin(title) { return `${pageTop(title, 'Không gian làm việc của bạn')}<div class="panel">${empty('Đăng nhập để tiếp tục', 'Sử dụng tài khoản được cấp để truy cập dữ liệu IQC.', 'shield')}<a class="button primary full mt" href="#account">Đăng nhập ${icon('arrow')}</a></div>`; }
function canWrite() { return state.user && state.user.role !== 'viewer'; }
function readOnlyNote() { return canWrite() ? '' : '<div class="notice">Bạn có quyền xem và xuất báo cáo. Liên hệ quản trị viên nếu cần nhập dữ liệu.</div>'; }
function values(form) { return Object.fromEntries(new FormData(form)); }
function formAction(selector, handler) {
  const form = $(selector); if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault(); const submit = $('button[type="submit"]', form); const message = $('.form-message', form);
    if (submit) submit.disabled = true; if (message) message.textContent = '';
    try { await handler(values(form), form); }
    catch (e) { if (message) message.textContent = e.message; else toast(e.message); }
    finally { if (submit) submit.disabled = form.dataset.singleProcessed==='true'; }
  });
}

const routes = [['home', 'home', 'Trang chủ'], ['scan', 'scan', 'Quét mã'], ['ckd', 'ckd', 'Kiểm tra CKD'], ['cut', 'cut', 'Cắt chân linh kiện'], ['holding', 'box', 'Holding room'], ['mm', 'search', 'Tra cứu MM'], ['assistant', 'assistant', 'Trợ lý'], ['account', 'user', 'Tài khoản']];
const shortLabels={home:'Trang chủ',scan:'Quét mã',ckd:'CKD',cut:'Cắt chân',holding:'Holding',mm:'Tra MM',assistant:'Trợ lý',account:'Tài khoản'};
function renderNavigation() {
  const keys=state.user ? state.navigation : defaultNavigation;
  $('.bottom-nav').innerHTML=keys.filter(key=>routes.some(r=>r[0]===key)).map(key=>{const route=routes.find(r=>r[0]===key);return `<a href="#${key}" data-nav="${key}" aria-label="${route[2]}" ${state.page===key?'class="active" aria-current="page"':''}>${icon(route[1])}<span>${shortLabels[key]}</span></a>`;}).join('');
}
$('#menu-links').innerHTML = routes.map(([route, symbol, label]) => `<a class="menu-link" href="#${route}">${icon(symbol)}${label}</a>`).join('');
$('#menu-links').insertAdjacentHTML('beforeend',`<a class="menu-link" href="#account?mm-settings">${icon('settings')} Cài đặt</a>`);
$('#open-menu').onclick = () => $('#menu-dialog').showModal();
document.querySelectorAll('[data-close]').forEach(el => el.onclick = () => el.closest('dialog').close());
document.querySelectorAll('dialog').forEach(el => el.addEventListener('click', e => { if (e.target === el) { const r = el.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) el.close(); } }));
$('#menu-links').onclick = e => { if (e.target.closest('a')) $('#menu-dialog').close(); };
function detail(title, html) { $('#detail-title').textContent = title; $('#detail-content').innerHTML = html; $('#detail-dialog').showModal(); }

async function home(id) {
  $('#main').innerHTML = `<section class="quality-hero quality-workspace" aria-labelledby="workspace-title">
      <div class="quality-welcome"><div class="quality-brands">HANSOL <span>HEVH</span><span class="quality-live"><i></i> WORK AREA</span></div><div class="workspace-eyebrow">QUẢN LÝ & KIỂM TRA</div><h1 id="workspace-title">Không gian làm việc<span>.</span></h1><p class="workspace-intro">Quét mã, kiểm tra và quản lý vật tư.</p></div>
      <div class="quality-copy"><h2>Chất lượng<br>bắt đầu từ <em>IQC.</em></h2><p>Kiểm tra đầu vào.<br>Chính xác trong từng chi tiết.</p><span class="quality-caption"><i></i> INCOMING QUALITY CONTROL</span></div>
      <div class="quality-art" aria-hidden="true"><div class="quality-grid"></div><div class="quality-ring ring-one"></div><div class="quality-ring ring-two"></div><div class="quality-orbit"><i></i></div><div class="quality-core">${icon('shield')}<strong>IQC</strong><span>CHẤT LƯỢNG</span><div class="quality-scan-line"></div></div><span class="quality-chip chip-one">${icon('box')} Vật tư</span><span class="quality-chip chip-two">${icon('check')} Kiểm tra</span><span class="quality-chip chip-three">${icon('scan')} Quét mã</span><div class="quality-particles"><i></i><i></i><i></i></div></div>
      <div class="quality-flow workspace-flow"><span>${icon('scan')} QUÉT MÃ</span><i></i><span>${icon('check')} KIỂM TRA</span><i></i><strong>${icon('box')} QUẢN LÝ</strong></div><button id="quality-motion" class="quality-motion" aria-label="Tạm dừng chuyển động" aria-pressed="false"><span aria-hidden="true">Ⅱ</span></button>
    </section>
    <section class="home-functions"><div class="section-title"><h2>Chức năng làm việc</h2><span>Chọn để bắt đầu</span></div><div class="features home-feature-grid">
      ${[['scan','scan','blue','Quét & thu thập dữ liệu','Barcode · Ảnh label · Excel'],['ckd','ckd','','Kiểm tra CKD','Đối chiếu hai nhãn'],['cut','cut','purple','Cắt chân linh kiện','Tra mã AI ↔ MI'],['holding','box','green','Holding room','Nhập · Xuất · Tồn kho'],['mm','search','cyan','Tra cứu MM','Vật tư & Location'],['account?shortcuts','user','sand','Phím tắt của tôi','Tùy chỉnh theo tài khoản']].map(([route,symbol,color,title,desc]) => `<a class="feature" href="#${route}">${icon('diagonal','class="feature-arrow"')}<div class="feature-icon ${color}">${icon(symbol)}</div><h3>${title}</h3><p>${desc}</p></a>`).join('')}
    </div></section>
    <div class="stats">${[['scans','scan','Lượt quét'],['materials','search','Mã vật tư MM'],['boxes','ckd','Box đã xác nhận'],['holding','box','Vật tư trong Holding']].map(([key,symbol,label]) => `<div class="stat">${icon(symbol)}<div><strong id="stat-${key}">—</strong><span>${label}</span></div></div>`).join('')}</div>
    <div class="home-foot">${icon('shield')} ${state.user ? `Đã đăng nhập · ${escape(state.user.name)} · ${roleName(state.user.role)}` : 'Đăng nhập để xem dữ liệu và bắt đầu làm việc'}</div>`;
  $('#quality-motion').onclick=e=>{const button=e.currentTarget,hero=$('.quality-hero'),paused=hero.dataset.paused!=='true';hero.dataset.paused=String(paused);button.setAttribute('aria-pressed',String(paused));button.setAttribute('aria-label',paused?'Tiếp tục chuyển động':'Tạm dừng chuyển động');$('span',button).textContent=paused?'▷':'Ⅱ';};
  if (state.user) try { const stats = await api('/stats'); if (id !== renderId) return; for (const [k, v] of Object.entries(stats)) { const el = $('#stat-' + k); if (el) el.textContent = number(v); } } catch (e) { if (id === renderId) toast(e.message); }
}

async function account() {
  if (!state.user) {
    $('#main').innerHTML = `${pageTop('Tài khoản', 'Đăng nhập vào Work Area')}<div class="login-layout"><section class="panel"><div class="login-icon">${icon('user')}</div><h2>Chào mừng trở lại</h2><p class="muted">Đăng nhập bằng tài khoản công việc của bạn.</p>${state.needsSetup ? '<div class="notice warning">Quản trị viên chưa thiết lập tài khoản đầu tiên. Vui lòng liên hệ người cài đặt hệ thống.</div>' : ''}<form id="login-form">${field('Tên đăng nhập','username',{placeholder:'Nhập tên đăng nhập',autocomplete:'username',extra:'maxlength="64" autocapitalize="none" spellcheck="false"'})}${field('Mật khẩu','password',{type:'password',placeholder:'Nhập mật khẩu',autocomplete:'current-password',extra:'maxlength="128"'})}<p class="form-message" role="alert"></p><button class="button primary full" type="submit">Đăng nhập ${icon('arrow')}</button></form><div class="mini-meta">${icon('shield')} Tài khoản được cấp bởi quản trị viên</div></section></div>`;
    formAction('#login-form', async body => { const s = await api('/login', { method: 'POST', data: body }); state.user = s.user; state.csrf = s.csrf;await loadPreferences();renderNavigation();toast('Đăng nhập thành công.'); location.hash = '#home'; }); return;
  }
  const u = state.user;
  $('#main').innerHTML = `${pageTop('Tài khoản', 'Hồ sơ & quyền truy cập', button('Đăng xuất','logout','','logout'))}<div class="account-layout"><div class="columns"><section class="panel"><div class="profile"><div class="avatar">${escape(u.name.split(' ').map(x => x[0]).filter(Boolean).slice(-2).join('').toUpperCase())}</div><div><h2>${escape(u.name)}</h2><p>@${escape(u.username)}</p></div></div><span class="badge green">${icon('shield')} ${roleName(u.role)}</span><hr class="divider"><h3>Quyền của bạn</h3><ul class="permissions">${['Tra cứu dữ liệu & xuất báo cáo', ...(canWrite() ? ['Lưu lượt quét & xác nhận CKD','Nhập, xuất vật tư Holding'] : []), ...(u.role === 'admin' ? ['Nhập MM, tạo tài khoản & xóa lượt quét'] : [])].map(x => `<li>${icon('check')}${x}</li>`).join('')}</ul><p class="subtle">Phiên đăng nhập có hiệu lực tối đa 8 giờ.</p></section><section class="panel"><h2>Đổi mật khẩu</h2><form id="password-form">${field('Mật khẩu hiện tại','oldPassword',{type:'password',autocomplete:'current-password'})}${field('Mật khẩu mới','password',{type:'password',autocomplete:'new-password',extra:'minlength="8" maxlength="128"',placeholder:'Ít nhất 8 ký tự'})}${field('Nhập lại mật khẩu mới','confirm',{type:'password',autocomplete:'new-password',extra:'minlength="8" maxlength="128"'})}<p class="form-message" role="alert"></p><button class="button full" type="submit">Lưu mật khẩu mới</button></form></section></div>${u.role === 'admin' ? `<section class="panel"><h2>Cấp tài khoản</h2><p class="muted">Chọn đúng quyền cần thiết cho từng người dùng.</p><form id="user-form"><div class="field-row">${field('Tên đăng nhập','username',{extra:'pattern="[a-z0-9._-]{3,64}" minlength="3" maxlength="64" autocapitalize="none"'})}${field('Họ tên','name',{extra:'maxlength="100"'})}</div><div class="field-row">${field('Mật khẩu ban đầu','password',{type:'password',autocomplete:'new-password',extra:'minlength="8" maxlength="128"'})}<div class="field"><label for="role">Quyền truy cập</label><select id="role" name="role"><option value="inspector">Nhân viên kiểm tra</option><option value="viewer">Chỉ xem</option><option value="admin">Quản trị viên</option></select></div></div><p class="form-message" role="alert"></p><button class="button primary" type="submit">${icon('plus')} Tạo tài khoản</button></form><div id="users-list" class="mt"></div></section>` : ''}</div>`;
  $('#logout').onclick = async () => { try { await api('/logout', { method:'POST' }); state.user = null; state.csrf = null; state.image = null; state.imageName = '';renderNavigation();render(); toast('Đã đăng xuất.'); } catch(e) { toast(e.message); } };
  formAction('#password-form', async b => { if (b.password !== b.confirm) throw Error('Hai mật khẩu mới không khớp.'); await api('/password', { method:'POST', data:b }); state.user = null; state.csrf = null;renderNavigation();render(); toast('Đã đổi mật khẩu. Vui lòng đăng nhập lại.'); });
  formAction('#user-form', async (b, f) => { await api('/users', { method:'POST', data:b }); f.reset(); toast('Đã tạo tài khoản.'); await usersList(); });
  mmImportSettings();
  shortcutSettings();
  if (u.role === 'admin') await usersList();
}
function mmImportSettings(target=$('.account-layout'),open=false){
  if(state.user?.role!=='admin')return;
  const panel=document.createElement('section');panel.className='panel';panel.id='mm-settings';
  panel.innerHTML=`<details id="mm-settings-details"><summary>Cài đặt · Dữ liệu MM</summary><p class="muted">MM dùng chung cho Stock, tra cứu và CKD. Nhập Excel .xls / .xlsx (tối đa 32 MB, đọc tất cả sheet) hoặc CSV UTF-8 (2 MB). File Excel giữ từng barcode, lô, vị trí và QTY thập phân; barcode đã có được cập nhật, các dòng khác được giữ lại.</p><p class="muted">Thêm cột qty và lot_no nếu có dữ liệu Stock. qty riêng với Selling Q’ty và MOQ; ô trống để chưa xác định. Nhãn có QTY / Lot No rõ ràng được ưu tiên khi quét. Lịch sử mới giữ thông tin tại thời điểm quét.</p>${button('Tải CSV mẫu','mm-template','small','download')}<form id="mm-import" class="mt"><div class="field"><label for="mm-file">File MM (.xls, .xlsx, .csv)</label><input id="mm-file" type="file" accept=".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" required></div><p class="form-message" role="alert"></p><button class="button primary" type="submit">Nhập MM</button></form><div id="mm-import-status" class="muted" role="status"></div></details>`;
  target.append(panel);
  $('#mm-template',panel).onclick=()=>downloadText('work-area-mm-template.csv','\uFEFFitem_code,samsung,item,description,maker,vendor,location,selling_qty,moq,qty,lot_no\n');
  formAction('#mm-import',async(_,form)=>{
    const file=$('#mm-file').files[0];if(!file)throw Error('Chọn file MM.');
    const csv=/\.csv$/i.test(file.name);if(file.size>(csv?2_000_000:32*1024*1024))throw Error(csv?'CSV tối đa 2 MB.':'Excel tối đa 32 MB.');
    if(!/\.(xls|xlsx|csv)$/i.test(file.name))throw Error('Chọn file .xls, .xlsx hoặc .csv.');
    $('#mm-import-status',panel).textContent=csv?'Đang nhập CSV…':'Đang tải và đọc tất cả sheet. Vui lòng giữ trang mở…';
    let result;try{result=csv?await api('/materials/import',{method:'POST',data:{csv:await file.text()},timeoutMs:420000}):await api('/materials/import-file',{method:'POST',file,timeoutMs:420000});}catch(e){$('#mm-import-status',panel).textContent='Chưa xác nhận được kết quả nhập.';throw e;}
    form.reset();
    $('#mm-import-status',panel).textContent=`Đã nhập ${number(result.count)} dòng MM.`;
    if(result.sheets){
      const list=document.createElement('ul');
      for(const sheet of result.sheets){const li=document.createElement('li');li.textContent=`${sheet.name}: ${number(sheet.rows)} dòng dữ liệu${sheet.totalRows?' · '+sheet.totalRows+' dòng tổng không tính là vật tư':''}${sheet.empty?' · Sheet trống':''}`;list.append(li);}
      $('#mm-import-status',panel).append(list);
      const note=document.createElement('p');note.textContent=`Thêm mới ${number(result.inserted)} · Cập nhật ${number(result.updated)}. Đã đọc đủ ${result.sheets.length} sheet.`;$('#mm-import-status',panel).append(note);
    }
    toast('Đã cập nhật MM.');
  });
  if(open)$('#mm-settings-details',panel).open=true;
  if(!open&&location.hash.includes('mm-settings')){$('#mm-settings-details',panel).open=true;requestAnimationFrame(()=>panel.isConnected&&panel.scrollIntoView({block:'start'}));}
}
function shortcutSettings() {
  let draft=[...state.navigation]; const owner=state.user.id;
  const panel=document.createElement('section');panel.className='panel preferences-panel';panel.id='shortcut-settings';$('.account-layout').append(panel);
  function draw() {
    panel.innerHTML=`<div class="preferences-heading"><div class="feature-icon cyan">${icon('plus')}</div><div><h2>Thanh phím tắt của tôi</h2><p class="muted no-margin">Lưu riêng theo tài khoản, dùng lại trên các thiết bị.</p></div></div><p class="muted">Chọn từ 3 đến 5 mục. Kéo để sắp xếp hoặc dùng nút lên/xuống.</p><div class="shortcut-choices">${routes.map(([key,symbol,label])=>`<label><input type="checkbox" data-choice="${key}" ${draft.includes(key)?'checked':''}>${icon(symbol)}<span>${label}</span></label>`).join('')}</div><ol class="shortcut-order">${draft.map((key,i)=>`<li draggable="true" data-order-key="${key}"><span class="shortcut-grip" aria-hidden="true">⠿</span>${icon(routes.find(r=>r[0]===key)[1])}<span>${routes.find(r=>r[0]===key)[2]}</span><button class="button small" data-up="${key}" aria-label="Đưa ${routes.find(r=>r[0]===key)[2]} lên" ${i===0?'disabled':''}>↑</button><button class="button small" data-down="${key}" aria-label="Đưa ${routes.find(r=>r[0]===key)[2]} xuống" ${i===draft.length-1?'disabled':''}>↓</button></li>`).join('')}</ol><p class="subtle">Xem trước thanh phím tắt</p><div class="shortcut-preview">${draft.map(key=>`<span>${icon(routes.find(r=>r[0]===key)[1])}<small>${shortLabels[key]}</small></span>`).join('')}</div><div class="actions mt"><button class="button primary" id="save-shortcuts" ${draft.length<3?'disabled':''}>Lưu phím tắt</button><button class="button" id="reset-shortcuts">Dùng mặc định</button></div><p class="form-message" id="shortcuts-message" role="status"></p>`;
    panel.querySelectorAll('[data-choice]').forEach(input=>input.onchange=()=>{if(input.checked){if(draft.length===5){input.checked=false;toast('Chọn tối đa 5 phím tắt.');return;}draft.push(input.dataset.choice);}else draft=draft.filter(key=>key!==input.dataset.choice);draw();});
    const move=(key,step)=>{const i=draft.indexOf(key),j=i+step;if(j>=0&&j<draft.length){[draft[i],draft[j]]=[draft[j],draft[i]];draw();}};
    panel.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>move(b.dataset.up,-1));panel.querySelectorAll('[data-down]').forEach(b=>b.onclick=()=>move(b.dataset.down,1));
    panel.querySelectorAll('[data-order-key]').forEach(li=>{li.ondragstart=e=>e.dataTransfer.setData('text/plain',li.dataset.orderKey);li.ondragover=e=>e.preventDefault();li.ondrop=e=>{e.preventDefault();const from=draft.indexOf(e.dataTransfer.getData('text/plain')),to=draft.indexOf(li.dataset.orderKey);if(from>=0&&to>=0){const [key]=draft.splice(from,1);draft.splice(to,0,key);draw();}};});
    $('#reset-shortcuts',panel).onclick=()=>{draft=[...defaultNavigation];draw();};
    $('#save-shortcuts',panel).onclick=async e=>{const button=e.currentTarget;button.disabled=true;try{const result=await api('/preferences',{method:'POST',data:{navigation:draft}});if(state.user?.id!==owner)return;state.navigation=result.navigation;renderNavigation();$('#shortcuts-message',panel).textContent='Đã lưu phím tắt cho tài khoản của bạn.';toast('Đã cập nhật thanh phím tắt.');}catch(error){$('#shortcuts-message',panel).textContent=error.message;}finally{if(button.isConnected)button.disabled=false;}};
  }
  draw();if(location.hash.includes('?shortcuts'))requestAnimationFrame(()=>panel.isConnected&&panel.scrollIntoView({block:'start'}));
}
async function usersList() {
  try { const { users } = await api('/users'); const el = $('#users-list'); if (el) el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Người dùng</th><th>Quyền</th></tr></thead><tbody>${users.map(u => `<tr><td>${escape(u.name)}<small>@${escape(u.username)}</small></td><td><span class="badge">${roleName(u.role)}</span></td></tr>`).join('')}</tbody></table></div>`; } catch (e) { toast(e.message); }
}

const queueDB = new Promise((resolve, reject) => {
  if (!window.indexedDB) { reject(Error('Thiết bị không hỗ trợ lưu hàng chờ.')); return; }
  const req = indexedDB.open('work-area-offline', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('pending', { keyPath:'request_id' });
  req.onsuccess = () => resolve(req.result); req.onerror = () => reject(Error('Không thể mở bộ nhớ hàng chờ.'));
});
queueDB.catch(() => {});
async function queue(operation, data) {
  const db = await queueDB;
  return new Promise((resolve,reject) => { const tx = db.transaction('pending', operation === 'all' ? 'readonly' : 'readwrite'); const store = tx.objectStore('pending'); const req = operation === 'all' ? store.getAll() : operation === 'put' ? store.put(data) : store.delete(data); let result; req.onsuccess = () => { result = req.result; }; tx.oncomplete = () => resolve(result); tx.onerror = () => reject(Error('Không thể lưu hàng chờ trên thiết bị.')); tx.onabort = () => reject(Error('Thao tác hàng chờ bị hủy.')); });
}
async function pendingRows() { const all = await queue('all'); return all.filter(r => r.owner === state.user?.id && r.username === state.user?.username); }
async function showPending() {
  const el=$('#pending-list');if(!el)return;
  const mode=state.mode;
  try{
    const rows=(await pendingRows()).filter(r=>r.mode===mode);if(!el.isConnected||mode!==state.mode)return;
    el.innerHTML=rows.length?rows.map(r=>`<div class="pending"><span>${escape(r.barcode)}</span><span class="badge ${r.duplicateCount?'red':'amber'}">${r.duplicateCount?'Trùng HS · Chờ lưu':'Chờ đồng bộ'}</span>${r.image?`<button class="button small" data-pending-photo="${escape(r.request_id)}">Xem ảnh</button>`:''}${r.duplicateCount?`<button class="button danger small" data-drop-pending="${escape(r.request_id)}">Bỏ lượt trùng</button>`:''}</div>`).join(''):'<p class="muted no-margin">Không có lượt '+mode+' đang chờ trên thiết bị này.</p>';
    $('#pending-count').textContent=rows.length;
    el.querySelectorAll('[data-pending-photo]').forEach(b=>b.onclick=()=>{const row=rows.find(r=>r.request_id===b.dataset.pendingPhoto);detail('Ảnh chờ đồng bộ',`<img class="photo-full" src="${escape(row.image)}" alt="Ảnh lượt quét đang chờ">`);});
    el.querySelectorAll('[data-drop-pending]').forEach(b=>b.onclick=async()=>{await queue('delete',b.dataset.dropPending);showPending();});
  }catch(e){if(el.isConnected&&mode===state.mode)el.textContent=e.message;}
}
async function scan() {
  if (!state.user) { $('#main').innerHTML = needsLogin('Quét mã'); return; }
  $('#main').innerHTML = `${pageTop('Quét & thu thập dữ liệu', 'Barcode · Ảnh label · Excel')}<div class="columns wide-left"><div><section class="panel">${readOnlyNote()}<div class="tabs" role="tablist" aria-label="Loại quét">${['HS','Stock','Label'].map(mode => `<button class="tab ${mode === state.mode ? 'active' : ''}" role="tab" aria-selected="${mode === state.mode}" data-mode="${mode}">${mode}</button>`).join('')}</div><div class="capture-actions">${button('Quét camera','scan-camera','primary','scan')}<button class="button scan-square" id="choose-photo" aria-label="Tự chụp ảnh khi đọc mã">${icon('camera')}</button></div><p class="scan-caption">${icon('shield')} Lưu dùng chung trên server. Khi mất mạng, lượt quét được giữ trên thiết bị và chờ bạn đồng bộ.</p><details><summary>Thông tin máy scan</summary><p>Dùng Quét camera để đọc mã. Bật biểu tượng camera để tự chụp ảnh đối chiếu mỗi lượt quét được lưu.</p><p>Camera cần HTTPS và quyền truy cập camera. Chọn Barcode hoặc QR để quét liên tục; HS lưu cả mã trùng và báo đỏ; Stock / Label cảnh báo trước khi lưu thêm. Ảnh đối chiếu lưu theo từng lượt quét, kể cả khi chờ đồng bộ. Chưa có OCR.</p></details></section><section class="panel"><div class="table-tools"><h2>Đồng bộ thiết bị</h2>${button('Đồng bộ','sync-queue','','sync')}</div><p class="muted">Dùng chung toàn server · <strong id="pending-count">0</strong> lượt quét chờ đồng bộ</p><div id="pending-list"></div></section></div><section class="panel"><div class="table-tools"><h2 id="scan-history-title">Lịch sử quét</h2><div class="actions">${button('Tải lại','reload-scans','small','sync')}<a id="scan-export" class="button primary small" href="/api/export?kind=scans">${icon('download')} Xuất Excel</a></div></div><p class="muted" id="scan-total">Đang tải lượt quét…</p><div id="scan-list"></div><div class="actions mt">${button('Xem thêm','more-scans','small')}</div><p class="scroll-hint">Vuốt ngang để xem đủ các cột.</p></section></div>`;
  document.querySelectorAll('[data-mode]').forEach(el => el.onclick = () => { if(state.mode===el.dataset.mode)return;state.mode = el.dataset.mode;state.scans=[];state.next=null;$('#scan-list').textContent='Đang tải lịch sử '+state.mode+'…';document.querySelectorAll('[data-mode]').forEach(b => { b.classList.toggle('active', b === el); b.setAttribute('aria-selected', String(b === el)); });Promise.allSettled([loadScans(),showPending()]); });
  $('.capture-actions').insertAdjacentHTML('beforebegin',field('Tên phiên quét (tùy chọn)','scan-session-title',{placeholder:'VD: Sub heatsink',required:false,extra:'maxlength="80"'}));
  scanFlowBar($('.capture-actions'),true);
  $('#scan-camera').onclick = startCamera;
  $('#choose-photo').onclick=()=>{state.autoCapture=!state.autoCapture;try{localStorage.setItem('wa-auto-capture-u'+state.user.id,String(state.autoCapture));}catch{}updateCaptureUI();};
  updateCaptureUI();
  $('#reload-scans').onclick = () => loadScans(); $('#more-scans').onclick = () => loadScans(true);
  $('#sync-queue').onclick=async e=>{
    const btn=e.currentTarget,mode=state.mode;btn.disabled=true;let count=0,repeated=0;
    try{
      for(const row of (await pendingRows()).filter(r=>r.mode===mode)){
        const result=await api('/scans',{method:'POST',data:row});await queue('delete',row.request_id);count++;if(mode==='HS'&&result.is_duplicate)repeated++;
      }
      toast(`Đã đồng bộ ${count} lượt ${mode}.${repeated?' Có '+repeated+' mã HS trùng đã được lưu.':''}`);await loadScans();
    }catch(error){toast(`Đã lưu ${count} lượt. ${error.message}`);}
    finally{btn.disabled=false;showPending();}
  };
  await Promise.allSettled([loadScans(), showPending()]);
}
function hsHistoryHTML(rows){
  if(!rows.length)return empty('Chưa có lượt HS','Lịch sử HS được lưu riêng tại đây.','scan');
  const admin=state.user.role==='admin';
  return `<div class="table-wrap"><table class="hs-history"><thead><tr><th>STT</th><th>ITEM / Barcode</th><th>Ảnh đối chiếu</th><th>Kết quả</th><th>QR / Mã vạch</th><th>Người quét</th>${admin?'<th>Thao tác</th>':''}</tr></thead><tbody>${rows.map((r,i)=>`<tr class="${r.prior_count>0?'hs-duplicate':'hs-unique'}"><td>${number(i+1)}</td><td class="wrap hs-item">${escape(r.item_code||r.barcode)}${r.item_code?`<small>${escape(r.barcode)}</small>`:''}${r.item_name?`<small>${escape(r.item_name)}</small>`:''}</td><td>${r.has_image?`<button class="icon-button" data-photo="${r.id}" aria-label="Xem ảnh HS ${r.id}"><img class="table-thumb" src="/api/scans/${r.id}/image" alt="Ảnh HS" loading="lazy"></button>`:`<span class="thumb-placeholder">${icon('photo')}</span>`}</td><td><span class="badge ${r.prior_count>0?'red':'green'}">${r.prior_count>0?'Trùng':'Không trùng'}</span></td><td><button class="button small" data-text="${r.id}">QR / Mã vạch</button></td><td>${escape(r.scanner)}<small>${time(r.created_at)}</small></td>${admin?`<td><button class="button danger small" data-delete="${r.id}">Xóa</button></td>`:''}</tr>`).join('')}</tbody></table></div>`;
}
async function loadScans(more = false) {
  const el = $('#scan-list'); if (!el) return;
  const mode=state.mode,request=++scanLoadRequest;$('#scan-history-title').textContent='Lịch sử '+mode;$('#scan-export').href='/api/export?kind=scans&mode='+encodeURIComponent(mode);
  try {
    const result = await api('/scans?mode='+encodeURIComponent(mode) + (more && state.next ? `&before=${state.next}` : ''));
    if (!el.isConnected || mode!==state.mode || request!==scanLoadRequest) return;
    state.scans = more ? [...state.scans, ...result.scans] : result.scans; state.next = result.next;
    $('#scan-total').textContent = `Đã lưu ${number(result.total)} lượt quét · Đang hiển thị ${state.scans.length} · ${mode==='Stock' ? (result.total_quantity == null ? 'Chưa có QTY Stock' : 'Tổng QTY Stock: '+number(result.total_quantity)+' ('+number(result.quantity_count)+' lượt có QTY)')+' · ' : ''}Lịch sử riêng ${mode} · Dùng chung toàn server`;
    $('#more-scans').hidden = !state.next;
    el.innerHTML = mode==='HS'?hsHistoryHTML(state.scans):state.scans.length ? `<div class="table-wrap"><table><thead><tr><th>STT</th><th>Người quét</th><th>Ảnh đối chiếu</th><th>Barcode / ITEM</th>${mode==='Stock'?'<th>Item NM</th><th>QTY</th><th>Maker / Vendor</th><th>Lot No</th>':''}<th>QR / Mã vạch</th>${state.user.role === 'admin' ? '<th>Thao tác</th>' : ''}</tr></thead><tbody>${state.scans.map((r,i) => `<tr><td>${number(i+1)}</td><td>${escape(r.scanner)}<small>${time(r.created_at)} · ${escape(r.mode)}</small></td><td>${r.has_image ? `<button class="icon-button" data-photo="${r.id}" aria-label="Xem ảnh label ${r.id}"><img class="table-thumb" src="/api/scans/${r.id}/image" alt="Ảnh label" loading="lazy"></button>` : `<span class="thumb-placeholder">${icon('photo')}</span>`}</td><td class="wrap">${escape(r.barcode)}<small>${r.item_code ? escape(r.item_code) : 'Chưa có ITEM trong MM'}</small></td>${mode==='Stock'?`<td class="wrap">${escape(r.item_name)||'—'}</td><td>${r.quantity==null?'—':number(r.quantity)}<small>${r.quantity_source==='MM'?'Từ MM':r.quantity_source==='barcode'?'Từ mã':''}</small></td><td>${escape(r.maker)||'—'}<small>${escape(r.vendor)}</small></td><td>${escape(r.lot_no)||'—'}</td>`:''}<td><button class="button small" data-text="${r.id}">QR / Mã vạch</button></td>${state.user.role === 'admin' ? `<td><button class="button danger small" data-delete="${r.id}">Xóa</button></td>` : ''}</tr>`).join('')}</tbody></table></div>` : empty('Chưa có lượt quét', 'Lượt quét đầu tiên sẽ xuất hiện tại đây.', 'scan');
    $('#stock-history-tools')?.remove();
    if(mode==='Stock'||mode==='HS')stockHistoryTools(result,el,mode);
    el.querySelectorAll('[data-photo]').forEach(b => b.onclick = () => detail('Ảnh label', `<img class="photo-full" src="/api/scans/${b.dataset.photo}/image" alt="Ảnh label đã lưu">`));
    el.querySelectorAll('[data-text]').forEach(b=>b.onclick=()=>showScanCode(state.scans.find(r=>r.id===Number(b.dataset.text))));
    el.querySelectorAll('[data-delete]').forEach(b => b.onclick = () => {
      detail('Xóa lượt quét?', `<p class="muted">Lượt quét #${b.dataset.delete} và ảnh đi kèm sẽ được xóa khỏi dữ liệu dùng chung.</p><div class="actions equal">${button('Giữ lại','cancel-delete')}${button('Xóa lượt quét','confirm-delete','danger')}</div>`);
      $('#cancel-delete').onclick = () => $('#detail-dialog').close();
      $('#confirm-delete').onclick = async e => { e.currentTarget.disabled = true; try { await api('/scans/' + b.dataset.delete, { method:'DELETE' }); $('#detail-dialog').close(); toast('Đã xóa lượt quét.'); await loadScans(); } catch(e) { toast(e.message); } finally { const btn = $('#confirm-delete'); if (btn) btn.disabled = false; } };
    });
  } catch(e) { if (el.isConnected && mode===state.mode && request===scanLoadRequest) { el.innerHTML = empty('Chưa tải được lịch sử', escape(e.message), 'sync'); $('#scan-total').textContent = 'Chưa thể cập nhật dữ liệu server.'; $('#more-scans').hidden = true; } }
}

function stockHistoryTools(result,el,mode='Stock'){
  const box=document.createElement('div');box.id='stock-history-tools';
  const groups=result.stock_summary||[],known=groups.reduce((s,r)=>s+r.scans,0);
  box.innerHTML=(mode==='Stock'?`<details class="mt" open><summary>Total theo ITEM code</summary>${groups.length?`<div class="table-wrap mt"><table><thead><tr><th>ITEM code</th><th>Item NM</th><th>Lượt quét</th><th>Total QTY</th></tr></thead><tbody>${groups.map(r=>`<tr><td>${escape(r.item_code)}</td><td class="wrap">${escape(r.item_name)||'—'}</td><td>${number(r.scans)}</td><td><strong>${r.total_quantity==null?'—':number(r.total_quantity)}</strong>${r.quantity_count<r.scans?`<small>${number(r.scans-r.quantity_count)} lượt chưa có QTY</small>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Chưa có ITEM để cộng Total.</p>'}${result.total>known?`<p class="muted">${number(result.total-known)} lượt chưa có ITEM, chưa gộp vào Total theo mã.</p>`:''}</details>`:'')+`${state.user.role==='admin'?`<div class="actions mt">${button('Xóa đã chọn (0)','stock-delete-selected','danger small')}${button('Xóa tất cả '+mode,'stock-delete-all','danger small')}</div>`:''}`;
  el.before(box);
  if(state.user.role!=='admin')return;
  const selected=new Set(),table=el.querySelector('table');
  if(table){const th=document.createElement('th');th.innerHTML='<input type="checkbox" id="stock-select-all" aria-label="Chọn tất cả dòng đang hiển thị" style="width:20px;height:20px">';table.querySelector('thead tr').prepend(th);
    table.querySelectorAll('tbody tr').forEach((tr,i)=>{const td=document.createElement('td'),id=state.scans[i].id;td.innerHTML=`<input type="checkbox" data-stock-select="${id}" aria-label="Chọn lượt quét ${id}" style="width:20px;height:20px">`;tr.prepend(td);td.firstChild.onchange=e=>{if(e.target.checked)selected.add(id);else selected.delete(id);update();};});
    $('#stock-select-all').onchange=e=>{el.querySelectorAll('[data-stock-select]').forEach(c=>{c.checked=e.target.checked;if(c.checked)selected.add(Number(c.dataset.stockSelect));else selected.delete(Number(c.dataset.stockSelect));});update();};
  }
  function update(){const b=$('#stock-delete-selected');if(!b)return;b.textContent=`Xóa đã chọn (${selected.size})`;b.disabled=!selected.size;const all=$('#stock-select-all');if(all){all.checked=selected.size===state.scans.length&&selected.size>0;all.indeterminate=selected.size>0&&selected.size<state.scans.length;}}
  $('#stock-delete-all').disabled=!result.total;update();
  function confirm(all){const ids=[...selected],count=all?result.total:ids.length;if(!count)return;
    detail('Xóa lịch sử '+mode+'?',`<p>Xóa ${number(count)} lượt ${mode} ${all?'trong lịch sử hiện tại':'đã chọn'} và ảnh đi kèm khỏi dữ liệu dùng chung?</p><div class="actions equal">${button('Giữ lại','stock-keep')}${button('Xóa','stock-confirm-delete','danger')}</div>`);
    $('#stock-keep').onclick=()=>$('#detail-dialog').close();
    $('#stock-confirm-delete').onclick=async event=>{event.currentTarget.disabled=true;try{const response=await api('/scans/delete',{method:'POST',data:{mode,...(all?{all:true,through_id:result.max_id}:{ids})}});$('#detail-dialog').close();toast(`Đã xóa ${number(response.deleted)} lượt ${mode}.`);await loadScans();}catch(err){toast(err.message);const b=$('#stock-confirm-delete');if(b)b.disabled=false;}};
  }
  $('#stock-delete-selected').onclick=()=>confirm(false);$('#stock-delete-all').onclick=()=>confirm(true);
}

let barcodeWriterPromise;
function barcodeWriter(){
  if(window.JsBarcode)return Promise.resolve(window.JsBarcode);
  if(!barcodeWriterPromise)barcodeWriterPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='/vendor/JsBarcode.code128-3.12.3.min.js';
    script.onload=()=>resolve(window.JsBarcode);script.onerror=()=>{script.remove();barcodeWriterPromise=null;reject(Error('Không tải được bộ tạo mã vạch. Hãy thử lại.'));};document.head.append(script);
  });
  return barcodeWriterPromise;
}
async function showScanCode(row,title){
  detail(title||'Mã đã quét · #'+row.id,`<div class="actions code-formats"><button class="button small primary" data-code-format="qr" aria-pressed="true">QR</button><button class="button small" data-code-format="barcode" aria-pressed="false">Mã vạch</button></div><p class="muted" id="code-status" role="status"></p><div class="generated-code" id="generated-code"></div><pre class="readable">${escape(row.barcode)}</pre>`);
  const host=$('#generated-code'),status=$('#code-status');let generation=0;
  async function draw(format){
    const version=++generation;host.dataset.format=format;host.replaceChildren();status.textContent='Đang tạo mã…';
    document.querySelectorAll('[data-code-format]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.codeFormat===format));b.classList.toggle('primary',b.dataset.codeFormat===format);});
    try{
      const canvas=document.createElement('canvas');canvas.setAttribute('role','img');canvas.setAttribute('aria-label',(format==='qr'?'QR: ':'Mã vạch: ')+row.barcode);
      if(format==='qr'){
        const Z=await zxing(),matrix=new Z.QRCodeWriter().encode(row.barcode,Z.BarcodeFormat.QR_CODE,320,320,new Map([[Z.EncodeHintType.CHARACTER_SET,'UTF-8']]));
        canvas.width=matrix.getWidth();canvas.height=matrix.getHeight();const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#000';
        for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(matrix.get(x,y))ctx.fillRect(x,y,1,1);
      }else{
        if(!/^[\x20-\x7e]+$/.test(row.barcode))throw Error('Code 128 hỗ trợ ký tự ASCII. Chọn QR để giữ đầy đủ nội dung mã này.');
        const writer=await barcodeWriter();writer(canvas,row.barcode,{format:'CODE128',width:2,height:110,margin:24,displayValue:false});
      }
      if(!host.isConnected||generation!==version)return;
      host.append(canvas);status.textContent=format==='qr'?'QR chứa nguyên nội dung đã quét.':'Code 128 chứa nguyên nội dung đã quét. Vuốt ngang nếu mã dài.';
    }catch(e){if(host.isConnected&&generation===version)status.textContent=e.message;}
  }
  document.querySelectorAll('[data-code-format]').forEach(b=>b.onclick=()=>draw(b.dataset.codeFormat));draw('qr');
}
function manualScan(){
  detail('Nhập mã',`<form id="manual-scan-form">${field('Mã cần lưu','manual-barcode',{extra:'maxlength="500"'})}<p class="form-message" role="alert"></p><button type="submit" class="button primary full">Lưu mã</button></form>`);
  formAction('#manual-scan-form',async b=>{
    const payload={request_id:crypto.randomUUID(),barcode:b['manual-barcode'],mode:state.mode,image:null,reject_duplicate:true};
    try{const result=await api('/scans',{method:'POST',data:payload});toast(state.mode==='HS'&&result.is_duplicate?'HS · Trùng · Đã lưu lượt này.':'Đã lưu mã.');}catch(e){if(!e.network)throw e;await queue('put',{...payload,reject_duplicate:false,owner:state.user.id,username:state.user.username});toast('Đã giữ mã để đồng bộ.');}
    $('#detail-dialog').close();await Promise.allSettled([loadScans(),showPending()]);
  });$('#manual-barcode').focus();
}
function startCamera() {
  if (!canWrite()) { toast('Cần quyền ghi dữ liệu để sử dụng quét camera.'); return; }
  stopCamera(); const owner=state.user.id, username=state.user.username;
  phoneScanner=new PhoneScanner($('#camera-dialog'),{
    mode:state.mode,title:$('#scan-session-title')?.value.trim() || `Scan ${state.mode}`,accountKey:'u'+owner,continuous:state.continuousScan,autoCapture:state.autoCapture,onContinuousChange:setContinuousScan,api,pending:pendingRows,
    enqueue:row=>queue('put',{...row,owner,username}),
    onChanged:()=>{if (state.page === 'scan') Promise.allSettled([loadScans(),showPending()]);},
    onManual:manualScan,onAuthExpired:()=>{stopCamera();location.hash='#account';}
  });
  phoneScanner.open();
}
function stopCamera() { phoneScanner?.close(); phoneScanner=null; }
function fieldCamera(inputId,title,onRead,{singleShot=false}={}) {
  const input=$('#'+inputId);if(!input)return;
  const button=document.createElement('button');button.type='button';button.className='button small field-camera-button';button.dataset.cameraFor=inputId;button.innerHTML=icon('camera')+' Quét camera';input.insertAdjacentElement('afterend',button);
  button.onclick=()=>{
    if(!state.user)return;stopCamera();
    phoneScanner=new PhoneScanner($('#camera-dialog'),{title,accountKey:'u'+state.user.id,continuous:singleShot?false:state.continuousScan,hideContinuous:singleShot,onContinuousChange:singleShot?undefined:setContinuousScan,
      onCode:async code=>{if(!input.isConnected)throw Error('Màn hình đã thay đổi. Hãy mở lại camera.');input.value=code;const result=await onRead?.(code,input);if(singleShot)phoneScanner?.close();return {message:result||'Đã điền mã. Tiếp tục quét hoặc đóng camera để kiểm tra.'};},
      onManual:()=>input.isConnected&&input.focus(),onAuthExpired:()=>{stopCamera();location.hash='#account';}
    });phoneScanner.open();
  };
}
function scanFieldEnter(ids) {
  for(let i=0;i<ids.length;i++){const input=$('#'+ids[i]);if(!input)continue;input.addEventListener('keydown',event=>{if(event.key!=='Enter')return;event.preventDefault();if(state.continuousScan){const next=$('#'+ids[i+1]);if(next){next.focus();next.select?.();}}});}
}
async function fillItemCode(code,input) {
  const result=await api('/materials?q='+encodeURIComponent(code));if(!input.isConnected)return;
  const match=result.materials.find(m=>m.item_code===code||m.samsung===code);if(match)input.value=match.item_code;
  return match?'Đã tra và điền ITEM. Kiểm tra thông tin trước khi xác nhận.':'Đã điền mã; cần kiểm tra ITEM trong MM trước khi xác nhận.';
}
document.addEventListener('visibilitychange', () => { if (document.hidden && $('#camera-dialog').open) $('#camera-dialog').close(); });

async function materials(id) {
  if(!state.user){$('#main').innerHTML=needsLogin('Tra cứu MM');return;}
  const modes={location:'Location',item_code:'Item code',spec:'Spec'};
  const view=new URLSearchParams(location.hash.split('?')[1]||'').get('view');
  if(!view||(!Object.hasOwn(modes,view)&&view!=='import')){
    const folders=[['location','Location','Tra cứu vị trí vật tư','teal'],['item_code','Item code','Tra cứu theo mã hàng','blue'],['spec','Spec','Tra cứu thông số, mô tả','violet']];
    if(state.user.role==='admin')folders.push(['import','Nhập file','Thêm, cập nhật danh mục MM','amber']);
    $('#main').innerHTML=`${pageTop('Tra cứu MM','Chọn thư mục để tiếp tục')}<nav class="mm-folder-grid" aria-label="Các thư mục MM">${folders.map(([key,label,note,tone])=>`<a class="mm-folder ${tone}" href="#mm?view=${key}" data-mm-folder="${key}"><span class="mm-folder-icon">${icon('folder')}</span><h2>${label}</h2><p>${note}</p><span class="mm-folder-arrow">${icon('arrow')}</span></a>`).join('')}</nav>`;
    return;
  }
  if(view==='import'){
    $('#main').innerHTML=`${pageTop('Nhập file MM','Cập nhật danh mục dùng chung','','#mm','Tra cứu MM')}<div id="mm-import-page"></div>`;
    if(state.user.role==='admin')mmImportSettings($('#mm-import-page'),true);
    else $('#mm-import-page').innerHTML='<section class="panel"><p>Chỉ quản trị viên được nhập file MM.</p></section>';
    return;
  }
  const mmLookupField=view;
  let request=0,loaded=[],next=null,lastQuery='';
  $('#main').innerHTML=`${pageTop(modes[view],'Tra cứu MM · '+modes[view],'','#mm','Tra cứu MM')}<section class="panel"><form id="mm-search"><div class="search-row"><input id="mm-q" name="q" placeholder="Nhập ${modes[view]} cần tìm" aria-label="Tìm theo ${modes[view]}" maxlength="200" autocomplete="off"><button class="button primary" type="submit">${icon('search')} Xem</button></div><p class="form-message" role="alert"></p></form><p class="muted mm-field-note">${view==='spec'?'Spec dùng cột mô tả (description / spec) trong file MM.':'Tra cứu theo '+modes[view]+'. Để trống rồi chọn Xem để xem danh sách.'}</p><div id="mm-results" aria-live="polite"></div></section>`;
  const search=async(q,more=false)=>{
    const field=mmLookupField,version=++request,el=$('#mm-results');
    if(!more){loaded=[];next=null;lastQuery=q;el.textContent='Đang tra cứu '+modes[field]+'…';}
    try{
      const result=await api('/materials?field='+field+'&q='+encodeURIComponent(q)+(more&&next!==null?'&offset='+next:''));
      if(id!==renderId||!el.isConnected||version!==request||field!==mmLookupField)return;
      loaded=more?[...loaded,...result.materials]:result.materials;next=result.next;result.materials=loaded;
      const columns=[['location','Location'],['item_code','Item code / Samsung'],['spec','Spec'],['item','Item NM'],['maker','Maker / Vendor'],['qty','QTY Stock / Lot No'],['selling_qty','Selling Q’ty / MOQ']];
      const first=columns.findIndex(([key])=>key===field);columns.unshift(...columns.splice(first,1));
      const cell=(m,key)=>key==='item_code'?`${escape(m.item_code)}<small>${escape(m.samsung)}</small>${m.source_sheet?`<small>Sheet: ${escape(m.source_sheet)} · dòng ${m.source_row}</small>`:''}`:key==='spec'?escape(m.description)||'—':key==='maker'?`${escape(m.maker)||'—'}<small>${escape(m.vendor)}</small>`:key==='qty'?`${m.qty==null?'—':number(m.qty)}<small>${escape(m.lot_no)||'—'}</small>`:key==='selling_qty'?`${m.selling_qty==null?'—':number(m.selling_qty)}<small>MOQ ${m.moq==null?'—':number(m.moq)}</small>`:escape(m[key])||'—';
      el.innerHTML=`<p class="muted">${modes[field]} · ${number(result.materials.length)} / ${number(result.matched)} kết quả · ${number(result.total)} dòng trong MM${result.matched>result.materials.length?' · Nhập từ khóa cụ thể hơn để thu hẹp.':''}</p>`+(result.materials.length?`<div class="table-wrap"><table><thead><tr>${columns.map(([,label])=>`<th>${label}</th>`).join('')}</tr></thead><tbody>${result.materials.map(m=>`<tr>${columns.map(([key])=>`<td class="wrap">${cell(m,key)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="scroll-hint">Vuốt ngang để xem đủ các cột.</p>`:empty('Chưa có kết quả',result.total?'Không có '+modes[field]+' phù hợp. Thử từ khóa khác.':state.user.role==='admin'?'Chọn Nhập file để thêm danh mục MM.':'Quản trị viên cần nhập danh mục MM.','search'));
      if(next!==null){const moreButton=document.createElement('button');moreButton.className='button full mt';moreButton.id='mm-more';moreButton.textContent='Xem thêm';moreButton.onclick=()=>{moreButton.disabled=true;search(lastQuery,true).catch(e=>toast(e.message));};el.append(moreButton);}
    }catch(e){if(id===renderId&&el.isConnected&&version===request)el.innerHTML=empty('Chưa tải được MM',escape(e.message),'sync');throw e;}
  };
  fieldCamera('mm-q','Tra cứu MM',async code=>{await search(code);return 'Đã tra cứu theo '+modes[mmLookupField]+'.';},{singleShot:true});
  formAction('#mm-search',async b=>{await search(b.q);});
  try{await search('');}catch{}
}

function downloadText(name, text) { const url = URL.createObjectURL(new Blob([text], { type:'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

async function ckd() {
  if (!state.user) { $('#main').innerHTML = needsLogin('CKD'); return; }
  await renderCkd({api,PhoneScanner,state,escape,number,field,button,icon,pageTop,toast,detail,canWrite,scanFlowBar,setContinuousScan,stopCamera,updateCaptureUI,showScanCode});
}

async function holding(){
 if(!state.user){$('#main').innerHTML=needsLogin('Holding room');return;}
 await renderHolding({api,state,escape,number,time,button,pageTop,detail,toast,icon,canWrite,updateCaptureUI,setContinuousScan,
 openScanner:options=>{stopCamera();phoneScanner=new PhoneScanner($('#camera-dialog'),options);phoneScanner.open();return phoneScanner;}});
}

function assistant() {
  $('#main').innerHTML = `${pageTop('Trợ lý công việc', 'Hướng dẫn sử dụng Work Area')}<div class="help-grid">${[
    ['scan','Quét mã & ảnh label','Vào Quét mã, chọn HS, Stock hoặc Label. Nhập mã bằng tay, máy scan USB/Bluetooth hoặc camera trên thiết bị hỗ trợ. Bật biểu tượng camera để tự chụp ảnh đối chiếu khi đọc mã. Biểu tượng mũi tên vòng bật/tắt quét liên tục. Lịch sử có QR / Mã vạch và tổng QTY nếu mã chứa số lượng rõ ràng; chưa có OCR.'],
    ['sync','Khi mất kết nối','Lượt quét có thể được giữ trong bộ nhớ trình duyệt sau khi bạn đã đăng nhập. Không xóa dữ liệu trình duyệt trước khi đồng bộ. Đăng nhập lại đúng tài khoản, vào Quét mã → Đồng bộ để gửi các lượt đang chờ lên server.'],
    ['ckd','Kiểm tra CKD','Nhập phiếu/lô, ITEM, hai nhãn, Maker, số lượng box và mã box riêng. Nhấn đối chiếu để xem kết quả. Chỉ khi bạn nhấn Xác nhận box, dữ liệu mới được lưu. Hệ thống chặn nhãn sai, box trùng và số lượng vượt.'],
    ['search','Nhập danh mục MM','Quản trị viên mở Cài đặt → Dữ liệu MM, tải CSV mẫu. Điền dữ liệu thật và lưu CSV UTF-8 từ Excel. Mỗi mã ITEM và Samsung phải duy nhất; Selling Q’ty và MOQ là số nguyên dương.'],
    ['box','Holding room','Nhập Holding: quét Barcode-no, tra file PBA32 / PMD32 hoặc nhập tay, nhớ Location theo tài khoản. Tủ Holding: xem từng box hoặc tổng theo ITEM; xuất một phần hoặc toàn bộ có lý do. Báo cáo Excel gồm tổng quan, ITEM, barcode và nhật ký.'],
    ['shield','Tài khoản & quyền','Hai biểu tượng Tài khoản đều mở cùng trang đăng nhập hoặc hồ sơ. Quản trị viên cấp tài khoản; nhân viên được ghi nhận dữ liệu; tài khoản chỉ xem được tra cứu và xuất báo cáo.']
  ].map(([symbol,title,description]) => `<article class="help-card"><h3>${icon(symbol)}${title}</h3><p>${description}</p></article>`).join('')}</div><p class="muted mt">Đây là hướng dẫn sử dụng, chưa có chatbot AI được kết nối.</p>`;
}
async function cutting() {
  if(!state.user){$('#main').innerHTML=needsLogin('Cắt chân linh kiện');return;}
  await renderCutting({api,state,escape,number,time,icon,button,field,pageTop,canWrite,detail,toast,scanFlowBar,setContinuousScan,updateCaptureUI,
    showCode:code=>showScanCode({barcode:code},'Mã quy đổi AI ↔ MI'),
    openScanner:options=>{stopCamera();phoneScanner=new PhoneScanner($('#camera-dialog'),options);phoneScanner.open();return phoneScanner;}
  });
}

async function render() {
  const id = ++renderId; const page = location.hash.slice(1).split('?')[0] || 'home'; state.page = page;
  stopCamera(); document.querySelectorAll('dialog[open]').forEach(d => d.close());
  document.querySelectorAll('[data-nav]').forEach(a => { const active = a.dataset.nav === page; a.classList.toggle('active',active); if (active) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current'); });
  const route = { home, account, scan, mm:materials, ckd, holding, assistant, cut:cutting }[page];
  document.title = `${routes.find(r => r[0] === page)?.[2] || 'Trang chủ'} · Work Area`;
  try { await (route || home)(id); } catch(e) { if (id === renderId) $('#main').innerHTML = `<section class="panel">${empty('Chưa mở được chức năng',escape(e.message),'sync')}<a class="button full mt" href="#account">Kiểm tra tài khoản</a></section>`; }
}
window.addEventListener('hashchange', () => { window.scrollTo(0,0); render(); });
window.addEventListener('offline', () => { connection(false); toast('Thiết bị đã mất mạng. Kiểm tra hàng chờ trước khi đóng trình duyệt.'); });
window.addEventListener('online', () => { api('/health').then(() => toast('Đã có kết nối. Vào Quét mã → Đồng bộ để lưu các lượt đang chờ.')).catch(() => {}); });
window.addEventListener('pagehide', stopCamera);
try { await session(); } catch(e) { toast(e.message); }
await render();
