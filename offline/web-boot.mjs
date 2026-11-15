export async function lockWebWorkspace(){
 if(!navigator.locks){document.querySelector('#main').textContent='Cập nhật trình duyệt để dùng Work Area offline.';throw Error('Web Locks required');}
 const granted=await new Promise((resolve,reject)=>navigator.locks.request('work-area-offline-workspace',{ifAvailable:true},async lock=>{resolve(Boolean(lock));if(lock)await new Promise(()=>{});}).catch(reject));
 if(!granted){document.querySelector('#main').innerHTML='<section class="panel"><h2>Work Area đang mở ở tab khác</h2><p>Đóng tab Work Area còn lại rồi tải lại trang này để bảo vệ các lượt đang chờ đồng bộ.</p><button class="button" id="workspace-reload">Tải lại</button></section>';document.querySelector('#workspace-reload').onclick=()=>location.reload();throw Error('Workspace already open');}
 window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
}
export function enableWebOffline(client){
 const state=window.WorkAreaWebOffline={ready:false,message:'Đang lưu giao diện để mở khi mất mạng.'};
 const originalPaint=client.paint.bind(client);client.paint=()=>{originalPaint();if(!state.ready){const label=document.querySelector('#device-offline-strip span');if(label)label.textContent+=' · Giao diện chưa lưu offline';}};
 const paint=()=>{const node=document.querySelector('#web-offline-status');if(node)node.textContent=state.message;client.paint();};
 if(!navigator.serviceWorker)state.message='Trình duyệt chưa hỗ trợ lưu giao diện offline. Cần HTTPS và trình duyệt mới.';
 else navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).then(registration=>{
  const check=async()=>{if(registration.active){const channel=new MessageChannel();state.ready=await new Promise(resolve=>{const timeout=setTimeout(()=>resolve(false),5000);channel.port1.onmessage=event=>{clearTimeout(timeout);resolve(event.data?.ready===true);};registration.active.postMessage({type:'SHELL_READY'},[channel.port2]);});state.message=state.ready?'Giao diện đã lưu trên trình duyệt. '+(client.db?'Dữ liệu offline đã sẵn sàng.':'Chọn Tải / cập nhật dữ liệu offline trước khi mất mạng.'):'Chưa lưu đủ giao diện offline. Giữ mạng, đóng các tab Work Area rồi mở lại.';}if(registration.waiting)state.message+=' Có bản mới: đóng các tab Work Area rồi mở lại khi có mạng.';paint();};
  check();registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='activated'||worker.state==='installed')check();if(worker.state==='redundant'&&!registration.active){state.message='Chưa lưu xong giao diện. Giữ mạng và tải lại trang.';paint();}});});
  navigator.serviceWorker.ready.then(()=>check());
 }).catch(()=>{state.message='Chưa lưu được giao diện offline. Kiểm tra dung lượng và tải lại trang khi có mạng.';paint();});
 const render=client.render.bind(client);client.render=async()=>{await render();const main=document.querySelector('#main');if(location.hash==='#offline'&&main){const panel=document.createElement('section');panel.className='panel';panel.innerHTML='<h2>Web offline</h2><p id="web-offline-status"></p><p>Lần đầu cần đăng nhập có mạng và tải xong dữ liệu. Không xóa dữ liệu trình duyệt khi còn hàng chờ. Chỉ mở một tab Work Area để làm việc; giữ trang mở khi đồng bộ.</p>';main.prepend(panel);paint();}};
 const prepare=client.prepare.bind(client);client.prepare=async()=>{try{await navigator.storage?.persist?.();}catch{}const result=await prepare();if(state.ready)state.message='Giao diện và dữ liệu offline đã sẵn sàng.';paint();return result;};
}
