let release,lastCheck=0,pending;
const bridge=()=>globalThis.WorkAreaUpdates;
const installed=()=>{try{return JSON.parse(bridge()?.version()||'null');}catch{return null;}};
export async function checkAppUpdate(force=false){
 if(pending)return pending;
 if(!force&&Date.now()-lastCheck<3600000)return release;
 pending=(async()=>{try{const response=await fetch('/api/app-release',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Chưa kiểm tra được bản mới.');const value=await response.json();if(value.package_id!=='vn.hansol.workarea.offline'||!Number.isSafeInteger(value.version_code)||!/^\d+\.\d+\.\d+$/.test(value.version)||value.url!=='/downloads/WorkArea-Offline-1.0.0.apk')throw Error('Thông tin cập nhật không hợp lệ.');release=value;lastCheck=Date.now();paintBanner();return value;}finally{pending=null;}})();return pending;
}
function paintBanner(){
 const current=installed();document.querySelector('#app-update-banner')?.remove();
 if(!current||!release||release.version_code<=current.code)return;
 const box=document.createElement('aside');box.id='app-update-banner';box.className='app-update-banner';box.setAttribute('role','status');
 const text=document.createElement('span');text.textContent='Work Area '+release.version+' đã sẵn sàng.';
 const go=document.createElement('button');go.type='button';go.className='button primary small';go.textContent='Cập nhật';go.onclick=()=>startUpdate();
 const later=document.createElement('button');later.type='button';later.className='button small';later.textContent='Để sau';later.onclick=()=>box.remove();box.append(text,go,later);document.body.append(box);
}
export function startUpdate(){if(bridge()?.installLatest){bridge().installLatest();}else{location.href=release?.url||'/downloads/WorkArea-Offline-1.0.0.apk';}}
export async function renderAppUpdate(target){
 if(!target)return;target.innerHTML='<h2>Cập nhật ứng dụng</h2>';
 const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Đang kiểm tra phiên bản…';
 const notes=document.createElement('p');notes.className='muted';
 const check=document.createElement('button');check.type='button';check.className='button';check.textContent='Kiểm tra cập nhật';
 const update=document.createElement('button');update.type='button';update.className='button primary';update.textContent='Tải / cập nhật APK';update.onclick=()=>startUpdate();
 const actions=document.createElement('div');actions.className='actions';actions.append(check,update);target.append(status,notes,actions);
 const refresh=async()=>{check.disabled=true;try{const r=await checkAppUpdate(true);if(!target.isConnected)return;const c=installed();status.textContent=c?'Đang dùng '+c.name+' · Mới nhất '+r.version+(c.code>=r.version_code?' · Đã cập nhật':' · Có bản mới'):'Bản APK mới nhất: '+r.version;notes.textContent=r.notes;update.hidden=Boolean(c&&c.code>=r.version_code);update.textContent=bridge()?'Cập nhật ngay':'Tải APK '+r.version;}catch{status.textContent='Chưa có kết nối để kiểm tra. Bạn vẫn có thể làm việc như bình thường.';}finally{check.disabled=false;}};check.onclick=refresh;await refresh();
}
const auto=()=>checkAppUpdate().catch(()=>{});
if(bridge()){setTimeout(auto,2500);addEventListener('online',auto);document.addEventListener('visibilitychange',()=>{if(!document.hidden)auto();});}
