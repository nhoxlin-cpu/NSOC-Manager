import {openDeviceDatabase} from './database.mjs';
import {read,change,addOperation} from './storage.mjs';
import {businessApi,queuePaths,stampOfflineTime} from '../lib/offline-business.mjs';
import {zipSync} from 'fflate';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const message=error=>error?.message||'Chưa kết nối được máy chủ.';
const fail=(text,status=400)=>{throw Object.assign(Error(text),{status});};
const names={'/scans':'Quét mã','/scans/delete':'Xóa lịch sử','/ckd/pair/save':'Check CKD','/ckd/history/delete':'Xóa CKD','/holding/v2/receive':'Nhập Holding','/holding/v2/withdraw':'Xuất Holding','/holding/v2/edit':'Sửa Holding','/holding/v2/edit-group':'Sửa nhóm ITEM','/holding/v2/delete':'Xóa khỏi Holding','/cutting/scans':'Cắt chân','/materials/lookup':'Lưu tra cứu MM','/preferences':'Phím tắt','/holding/v2/preferences':'Location Holding'};
class OfflineClient{
 constructor(){this.enabled=true;this.meta={active:false,maps:{}};this.ops=[];this.db=null;this.online=navigator.onLine;this.csrf=null;this.notice='';this.chain=Promise.resolve();this.images=new Map();this.generation=0;this.nextAttempt=0;}
 async ready(){
  try{this.meta=await read('meta','active')||this.meta;this.ops=await read('ops')||[];const base=await read('base','active');if(base&&this.meta.baseUserId===this.meta.profile?.id){this.db=await openDeviceDatabase(base);for(const op of this.ops){try{this.apply(op);if(op.ack)this.applyReceipt(op);}catch(error){this.notice='Không dựng lại được hàng chờ: '+message(error);this.replayError=true;break;}}}}
  catch(error){this.notice='Không đọc được bộ nhớ offline: '+message(error);}
  this.install();return this;
 }
 install(){
  const strip=document.createElement('div');strip.id='device-offline-strip';strip.className='device-offline-strip';document.body.prepend(strip);this.paint();
  document.addEventListener('click',event=>{const a=event.target.closest('a');if(!a||!this.db||!this.meta.active)return;const url=new URL(a.href,location.href);if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return;if(/\/(?:export|report\.zip)(?:\/|$)|\/image(?:\/|$)/.test(url.pathname)){event.preventDefault();this.downloadResource(url.pathname.slice(4)+url.search).catch(error=>this.notify(message(error)));}},true);
  let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;this.localImages();});}).observe(document.body,{childList:true,subtree:true});
  window.addEventListener('online',()=>{this.online=true;this.paint();this.sync().then(()=>this.refreshIfDue()).catch(()=>{});});window.addEventListener('offline',()=>{this.online=false;this.paint();});
  this.timer=setInterval(()=>{if(document.visibilityState==='visible'&&this.meta.active&&navigator.onLine&&!this.conflict)this.sync().then(()=>this.refreshIfDue()).catch(()=>{});},15000);
  if(this.meta.active&&this.db)setTimeout(()=>this.probe().then(()=>this.sync()).then(()=>this.refreshIfDue()).catch(()=>{}),500);
 }
 pending(){return this.ops.filter(op=>!op.ack);}
 serial(fn){const next=this.chain.then(fn,fn);this.chain=next.catch(()=>{});return next;}
 async persist(){await change(['meta'],tx=>tx.objectStore('meta').put(this.meta,'active'));}
 notify(text){this.notice=text;this.paint();if(document.querySelector('#offline-message'))document.querySelector('#offline-message').textContent=text;}
 paint(){const strip=document.querySelector('#device-offline-strip');if(!strip)return;const count=this.pending().length;strip.dataset.waiting=String(count>0||!this.online);strip.dataset.error=String(!!this.conflict||!!this.replayError);strip.innerHTML=`<span>${!this.meta.active?'Work Area · Online + Offline':!this.db?'Chưa tải dữ liệu offline':this.online?'Dữ liệu trên máy':'Đang offline'}${count?' · '+count+' chờ đồng bộ':''}${this.conflict?' · Cần kiểm tra':''}</span><a href="#offline">Đồng bộ</a>`;}
 async remote(path,{method='GET',data,timeout=10000}={}){
  let response;try{response=await fetch('/api'+path,{method,credentials:'same-origin',headers:data?{'Content-Type':'application/json','X-CSRF-Token':this.csrf||''}:{},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(timeout)});}catch(error){this.online=false;this.nextAttempt=Date.now()+15000;this.paint();throw Object.assign(Error('Không kết nối được server. Dữ liệu vẫn giữ trên điện thoại.'),{network:true});}
  if(response.status>=500){this.online=false;this.nextAttempt=Date.now()+15000;this.paint();throw Object.assign(Error('Máy chủ đang gặp vấn đề. Dữ liệu vẫn giữ trên điện thoại.'),{network:true,status:response.status});}
  let value;try{value=await response.json();}catch{this.online=false;this.nextAttempt=Date.now()+15000;throw Object.assign(Error('Phản hồi server chưa đầy đủ; giữ giao dịch để gửi lại.'),{network:true});}if(!response.ok)throw Object.assign(Error(value.error||'Máy chủ từ chối thao tác.'),{status:response.status});this.online=true;this.paint();return value;
 }
 async probe(){const value=await this.remote('/me');if(!value.user||value.user.id!==this.meta.profile?.id){this.csrf=null;this.authNeeded=true;throw Object.assign(Error('Đăng nhập lại server để đồng bộ đúng tài khoản.'),{status:401});}this.csrf=value.csrf;this.authNeeded=false;this.meta.profile=value.user;await this.persist();return value;}
 async verifier(password,salt){const bytes=new TextEncoder().encode(password),key=await crypto.subtle.importKey('raw',bytes,'PBKDF2',false,['deriveBits']);const value=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new Uint8Array(salt),iterations:210000,hash:'SHA-256'},key,256);return [...new Uint8Array(value)];}
 async login(data){
  if(this.pending().length&&this.meta.profile?.username.toLowerCase()!==String(data.username).toLowerCase())fail('Còn hàng chờ của tài khoản '+this.meta.profile.username+'. Đồng bộ trước khi đổi tài khoản.');
  let result;try{result=await this.remote('/login',{method:'POST',data});}catch(error){if(!error.network)throw error;const v=this.meta.verifier;if(!this.db||!v||String(data.username).toLowerCase()!==this.meta.profile?.username.toLowerCase())fail('Cần đăng nhập và tải dữ liệu khi có mạng ít nhất một lần.');const actual=await this.verifier(data.password,v.salt);let difference=0;for(let i=0;i<actual.length;i++)difference|=actual[i]^v.hash[i];if(difference)fail('Tên đăng nhập hoặc mật khẩu không đúng.',401);this.meta.active=true;await this.persist();this.paint();return {user:this.meta.profile,csrf:'device-workspace'};}
  const same=this.meta.profile?.id===result.user.id;if(!same&&(this.pending().length||(this.db&&this.meta.profile?.username.toLowerCase()===result.user.username.toLowerCase()))){this.csrf=null;this.authNeeded=true;this.conflict='Tài khoản server không còn cùng định danh với dữ liệu trên máy. Hàng chờ được giữ nguyên; hãy xuất dự phòng và khôi phục đúng dữ liệu server.';this.notify(this.conflict);fail(this.conflict,409);}if(!same){this.db?.close();this.db=null;this.ops=[];this.meta.maps={};this.conflict=null;}
  this.meta.profile=result.user;this.meta.active=true;this.csrf=result.csrf;this.authNeeded=false;const salt=[...crypto.getRandomValues(new Uint8Array(16))];this.meta.verifier={salt,hash:await this.verifier(data.password,salt)};await this.persist();
  if(!this.db){try{await this.prepare();}catch(error){this.notify('Đăng nhập thành công. Chưa tải xong dữ liệu offline: '+message(error));}}
  this.paint();return result;
 }
 async api(path,options={},network){
  const method=options.method||'GET';
  if(path==='/login')return this.login(options.data);
  if(path==='/logout'){this.meta.active=false;await this.persist();if(this.csrf)this.remote('/logout',{method:'POST',data:{}}).catch(()=>{});this.csrf=null;this.paint();return {ok:true};}
  if(path==='/me'){
   if(this.meta.active&&this.db&&!this.replayError)return {user:this.meta.profile,csrf:'device-workspace',needsSetup:false};
   if(this.meta.profile&&!this.meta.active)return {user:null,csrf:null,needsSetup:false};
   const value=await network();if(value.user){this.meta.profile=value.user;this.meta.active=true;this.csrf=value.csrf;await this.persist();}return value;
  }
  if(!this.db||!this.meta.active||this.replayError){if(path==='/scans'&&options.data?.mode==='HS')fail('Cần đăng nhập và tải lịch sử về điện thoại trước khi so trùng HS trên máy.',503);if(!navigator.onLine||this.replayError)fail(this.notice||'Đăng nhập và tải dữ liệu offline trước khi làm việc.',503);return network();}
  if(method==='DELETE'&&/^\/scans\/\d+$/.test(path)){const id=Number(path.split('/').at(-1)),row=this.db.prepare('SELECT mode FROM scans WHERE id=?').get(id);if(!row)fail('Không còn lượt quét.',404);path='/scans/delete';options={method:'POST',data:{mode:row.mode,ids:[id]}};}
  const verb=options.method||'GET';
  if(verb==='POST'&&queuePaths.has(path)){
   const committed=await this.serial(()=>this.commit(path,options.data||{}));if(!committed.op)return committed.result;
   if(path==='/scans'&&options.data?.mode==='HS'){
    // A durable device comparison is final for HS. Network receipts cannot replace it.
    if(navigator.onLine&&this.online&&!this.conflict&&!this.syncing&&Date.now()>=this.nextAttempt)this.sync().catch(()=>{});
    return {...committed.result,duplicate_scope:'device',offline:true};
   }
   if(navigator.onLine&&this.online&&!this.conflict&&!this.syncing&&Date.now()>=this.nextAttempt){let timer;await Promise.race([this.sync().catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,1200);})]);clearTimeout(timer);}
   return {...committed.result,...(committed.op.serverResult||{}),...(committed.result.id?{id:committed.result.id}:{}),offline:!committed.op.ack};
  }
  if(path==='/users'&&verb==='GET'&&navigator.onLine&&this.online){try{if(!this.csrf)await this.probe();return await network();}catch(error){if(!error.network&&!(error.status>=500))throw error;}}
  try{return businessApi(this.db,this.meta.profile,path,options);}catch(error){if(error.status!==503)throw error;if(!navigator.onLine)throw error;if(!this.csrf)await this.probe();const result=await network();if(path==='/password'){const salt=[...crypto.getRandomValues(new Uint8Array(16))];this.meta.verifier={salt,hash:await this.verifier(options.data.password,salt)};this.meta.active=false;this.csrf=null;await this.persist();}if(verb!=='GET')this.notice='Dữ liệu server đã thay đổi. Vào Đồng bộ để tải bản mới sau khi gửi hết hàng chờ.';return result;}
 }
 prepareBody(path,value){const b=structuredClone(value);
  if(path==='/scans/delete'&&b.all){b.ids=this.db.prepare('SELECT id FROM scans WHERE mode=? AND id<=? ORDER BY id').all(b.mode,b.through_id).map(r=>r.id);delete b.all;}
  if(path==='/scans/delete'){b.expected=(b.ids||[]).map(id=>({id,request_id:this.db.prepare('SELECT request_id FROM scans WHERE id=?').get(id)?.request_id}));}
  if(path==='/ckd/history/delete'&&b.all){b.ids=this.db.prepare('SELECT id FROM ckd_checks WHERE id<=? AND (?=1 OR workbook_id=?)').all(b.through_id,b.scope==='all'?1:0,Number(b.workbook_id)||0).map(r=>r.id);delete b.all;}
  if(path==='/ckd/history/delete')b.expected=(b.ids||[]).map(id=>({id,request_id:this.db.prepare('SELECT request_id FROM ckd_checks WHERE id=?').get(id)?.request_id}));
  return b;
 }
 apply(op){const result=businessApi(this.db,op.actor||this.meta.profile,op.path,{method:'POST',data:op.body});this.preserveIds(op,result);stampOfflineTime(this.db,op.path,op.body,result,op.at,(op.actor||this.meta.profile).id);return result;}
 preserveIds(op,result){
  const table={'/scans':'scans','/ckd/pair/save':'ckd_checks','/holding/v2/receive':'holding_entries','/cutting/scans':'cutting_scans','/materials/lookup':'mm_lookup_saved'}[op.path],key=op.path==='/materials/lookup'?'saved_id':'id',wanted=op.localResult?.[key],actual=result[key];if(!table||!wanted||!actual||wanted===actual)return;
  this.db.exec('SAVEPOINT stable_device_ids; PRAGMA defer_foreign_keys=ON');try{this.db.prepare('UPDATE '+table+' SET id=? WHERE id=?').run(wanted,actual);if(table==='scans')this.db.prepare('UPDATE scan_stock SET scan_id=? WHERE scan_id=?').run(wanted,actual);if(table==='ckd_checks')this.db.prepare('UPDATE ckd_check_images SET check_id=? WHERE check_id=?').run(wanted,actual);if(table==='holding_entries'){this.db.prepare("UPDATE holding_events SET entry_id=?,response=json_set(response,'$.id',?) WHERE entry_id=?").run(wanted,wanted,actual);}this.db.exec('RELEASE SAVEPOINT stable_device_ids');result[key]=wanted;}catch(error){this.db.exec('ROLLBACK TO SAVEPOINT stable_device_ids; RELEASE SAVEPOINT stable_device_ids');throw error;}
 }
 async commit(path,value){
  const body=this.prepareBody(path,value);if((path==='/scans/delete'||path==='/ckd/history/delete')&&!body.ids?.length)return {result:{ok:true,deleted:0}};
  const op={id:crypto.randomUUID(),path,body,at:new Date().toISOString(),actor:{...this.meta.profile},realm:this.meta.realm,ack:false};this.db.exec('SAVEPOINT device_write');
  try{const result=this.apply(op);op.localResult=result;if(path==='/materials/lookup'&&result.saved_id)op.wireBody={...body,_offline_saved:JSON.parse(this.db.prepare('SELECT snapshot FROM mm_lookup_saved WHERE id=?').get(result.saved_id).snapshot)};op.seq=await addOperation(op);this.db.exec('RELEASE SAVEPOINT device_write');this.ops.push(op);this.generation++;this.paint();return {result,op};}catch(error){this.db.exec('ROLLBACK TO SAVEPOINT device_write; RELEASE SAVEPOINT device_write');if(error.name==='QuotaExceededError')fail('Bộ nhớ điện thoại đầy. Lượt này chưa lưu; hãy đồng bộ hoặc giải phóng dung lượng rồi thử lại.',507);throw error;}
 }
 wire(op){const b=structuredClone(op.wireBody||op.body),map=(entity,id)=>this.meta.maps?.[entity+':'+id]??id;
  if(op.path.startsWith('/holding/v2/')){if(b.entry_id)b.entry_id=map('holding',b.entry_id);if(b.rows)b.rows=b.rows.map(row=>({...row,id:map('holding',row.id)}));}
  if(op.path==='/scans/delete'||op.path==='/ckd/history/delete'){const entity=op.path==='/scans/delete'?'scan':'ckd';b.ids=b.ids.map(id=>map(entity,id));if(b.expected)b.expected=b.expected.map(row=>({...row,id:map(entity,row.id)}));}
  return b;
 }
 applyReceipt(op){if(op.path!=='/scans'||!op.serverResult)return;const r=op.serverResult;if(op.body.mode!=='HS')this.db.prepare('UPDATE scans SET prior_count=? WHERE request_id=? AND user_id=?').run(r.prior_count||0,op.body.request_id,op.actor.id);if(r.stock){const s=r.stock;this.db.prepare('UPDATE scans SET quantity=? WHERE request_id=? AND user_id=?').run(s.quantity,op.body.request_id,op.actor.id);this.db.prepare('UPDATE scan_stock SET item_code=?,item_name=?,maker=?,vendor=?,lot_no=?,quantity_source=? WHERE scan_id=?').run(s.item_code,s.item_name,s.maker,s.vendor,s.lot_no,s.quantity_source,op.localResult.id);}}
 async refreshIfDue(){if(this.db&&this.meta.active&&this.online&&!this.pending().length&&!this.preparing&&!this.conflict&&!document.querySelector('#camera-dialog[open]')&&Date.now()-Date.parse(this.meta.snapshotAt||0)>15*60000)await this.prepare();}
 async sync(){
  if(this.syncing)return this.syncing;if(!this.meta.active||!this.db||this.replayError)return;
  if(!this.pending().length){this.notice='Không có thao tác chờ đồng bộ.';this.paint();return;}
  this.syncing=(async()=>{try{
   if(!this.csrf)await this.probe();
   while(this.pending().length){const op=this.pending()[0];
    const receipt=await this.remote('/offline/replay',{method:'POST',data:{request_id:op.id,path:op.path,body:this.wire(op),captured_at:op.at,realm:op.realm||this.meta.realm},timeout:15000});
    if(!receipt.result||receipt.request_id!==op.id)throw Object.assign(Error('Chưa nhận được xác nhận đồng bộ đầy đủ.'),{network:true});
    await this.serial(async()=>{op.ack=true;op.serverResult=receipt.result;op.error=null;const entity={'/scans':'scan','/ckd/pair/save':'ckd','/holding/v2/receive':'holding','/cutting/scans':'cut'}[op.path];if(entity&&op.localResult.id&&receipt.result.id){this.meta.maps??={};this.meta.maps[entity+':'+op.localResult.id]=receipt.result.id;}this.meta.lastUpload=new Date().toISOString();await change(['meta','ops'],tx=>{tx.objectStore('ops').put(op);tx.objectStore('meta').put(this.meta,'active');});this.applyReceipt(op);this.paint();});
   }
   this.conflict=null;this.notice=this.pending().length?'Còn lượt chờ đồng bộ.':'Đã gửi hết hàng chờ lên server.';
  }catch(error){if(error.status===401||error.status===403){this.csrf=null;this.authNeeded=true;}if(!error.network){const op=this.pending()[0];if(op){op.error=message(error);await change(['ops'],tx=>tx.objectStore('ops').put(op));}this.conflict=message(error);}this.notice=message(error);throw error;}finally{this.paint();this.syncing=null;}})();return this.syncing;
 }
 async prepare(){
  if(this.preparing)return;if(this.pending().length)fail('Gửi hết hàng chờ trước khi thay bản dữ liệu offline.');if(!this.meta.active)fail('Đăng nhập trước khi tải dữ liệu.');this.preparing=true;const version=this.generation;this.notify('Đang tải dữ liệu offline. Giữ app mở…');
  try{
   await this.probe();let response;try{response=await fetch('/api/offline/snapshot',{credentials:'same-origin',signal:AbortSignal.timeout(180000)});}catch{throw Error('Không tải được dữ liệu offline. Kiểm tra mạng rồi thử lại.');}if(!response.ok){const error=await response.json();throw Error(error.error||'Server chưa chuẩn bị được dữ liệu.');}
   const actor=JSON.parse(decodeURIComponent(response.headers.get('X-WorkArea-User')||'')),at=response.headers.get('X-WorkArea-Snapshot-At'),bytes=new Uint8Array(await response.arrayBuffer());if(actor.id!==this.meta.profile.id)fail('Bản dữ liệu thuộc tài khoản khác.');const next=await openDeviceDatabase(bytes);if(next.prepare('PRAGMA quick_check').get().quick_check!=='ok'){next.close();fail('Bản dữ liệu không hợp lệ.');}const realm=next.prepare("SELECT value FROM offline_settings WHERE name='realm'").get()?.value;if(this.db&&this.meta.realm&&realm!==this.meta.realm){next.close();fail('Server đang dùng bộ dữ liệu khác. Bản trên máy được giữ nguyên; cần quản trị khôi phục đúng bản sao lưu.',409);}
   await this.serial(async()=>{if(this.pending().length||this.generation!==version){next.close();fail('Có thao tác mới trong khi tải. Hàng chờ vẫn giữ nguyên; tải lại sau khi đồng bộ.');}const previous=this.db;this.meta.baseUserId=actor.id;this.meta.profile=actor;this.meta.snapshotAt=at;this.meta.realm=next.prepare("SELECT value FROM offline_settings WHERE name='realm'").get()?.value;this.meta.maps={};await change(['base','meta','ops'],tx=>{tx.objectStore('base').put(bytes,'active');tx.objectStore('meta').put(this.meta,'active');tx.objectStore('ops').clear();});this.db=next;this.ops=[];previous?.close();for(const url of this.images.values())URL.revokeObjectURL(url);this.images.clear();this.replayError=false;this.conflict=null;});
   this.notify('Đã tải xong. App có thể làm việc khi mất mạng hoặc server lỗi.');this.localImages();
  }catch(error){if(error.status===409)this.conflict=message(error);throw error;}finally{this.preparing=false;this.paint();}
 }
 cancellationGroup(target){
  const selected=new Set([target.id]),affected=new Set(),holding=op=>op.path==='/holding/v2/receive'?[op.localResult.id]:op.path.startsWith('/holding/v2/')&&op.body.rows?(op.body.rows||[]).map(row=>row.id):op.path.startsWith('/holding/v2/')&&op.body.entry_id?[op.body.entry_id]:[];
  for(const id of holding(target))affected.add(id);
  for(const op of this.pending().filter(v=>v.seq>target.seq)){
   const ids=holding(op),dependent=ids.some(id=>affected.has(id))||(target.path==='/holding/v2/delete'&&op.path.startsWith('/holding/v2/'))||(target.path.startsWith('/ckd/')&&op.path.startsWith('/ckd/'))||(target.path==='/scans/delete'&&op.path.startsWith('/scans'))||(target.path==='/scans'&&op.path==='/scans/delete'&&(op.body.expected||[]).some(v=>v.request_id===target.body.request_id));
   if(dependent){selected.add(op.id);for(const id of ids)affected.add(id);}
  }
  return this.pending().filter(op=>selected.has(op.id));
 }
 async cancelFailed(id){
  if(this.syncing)fail('Đợi lượt đồng bộ hiện tại hoàn tất trước khi hủy.');
  return this.serial(async()=>{const target=this.pending().find(op=>op.id===id);if(!target?.error)fail('Chỉ hủy lượt đã được server báo lỗi rõ ràng.');const group=this.cancellationGroup(target);if(!confirm('Hủy '+group.length+' thao tác chưa gửi gồm lượt lỗi và các lượt phụ thuộc? Các lượt đã được server nhận vẫn giữ nguyên. Hãy tải bản dự phòng hàng chờ trước.'))return;
   const ids=new Set(group.map(op=>op.id)),keep=this.ops.filter(op=>!ids.has(op.id)),bytes=await read('base','active'),fresh=await openDeviceDatabase(bytes),old=this.db;this.db=fresh;
   try{for(const op of keep){this.apply(op);if(op.ack)this.applyReceipt(op);}await change(['ops','canceled'],tx=>{for(const op of group){tx.objectStore('ops').delete(op.seq);tx.objectStore('canceled').put({...op,canceled_at:new Date().toISOString(),id_mappings:structuredClone(this.meta.maps)});}});this.ops=keep;old.close();this.generation++;this.conflict=null;this.notice='Đã hủy '+group.length+' thao tác chưa gửi. Bản lưu lượt hủy vẫn giữ trên máy và có trong file dự phòng.';for(const url of this.images.values())URL.revokeObjectURL(url);this.images.clear();this.paint();}
   catch(error){this.db=old;fresh.close();throw Error('Chưa hủy được vì có thao tác phụ thuộc. Bản gốc vẫn giữ nguyên: '+message(error));}
  });
 }
 localImages(){if(!this.db||!this.meta.active)return;for(const image of document.querySelectorAll('img[src^="/api/"]')){const path=image.getAttribute('src').slice(4);if(!/\/image(?:\/|$)/.test(path))continue;try{let url=this.images.get(path);if(!url){const data=businessApi(this.db,this.meta.profile,path);if(!data.binary)continue;url=URL.createObjectURL(new Blob([new Uint8Array(data.bytes)],{type:data.mime}));this.images.set(path,url);}image.src=url;}catch{}}}
 async saveFile(name,mime,bytes){
  if(window.WorkAreaNative?.beginFile){const bridge=window.WorkAreaNative,id=bridge.beginFile(name,mime);if(!id)fail('Hoàn tất hộp thoại lưu file trước hoặc kiểm tra dung lượng điện thoại.');try{for(let offset=0;offset<bytes.length;offset+=65536){if(!bridge.appendFile(id,Buffer.from(bytes.subarray(offset,offset+65536)).toString('base64')))fail('Chưa ghi được file. Kiểm tra dung lượng điện thoại.');if(offset%(32*65536)===0)await new Promise(resolve=>setTimeout(resolve,0));}bridge.finishFile(id);}catch(error){bridge.abortFile(id);throw error;}return;}
  const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:mime})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }
 async downloadResource(path){const value=businessApi(this.db,this.meta.profile,path);if(!value.binary)fail('Không phải file báo cáo.');let bytes=value.bytes;if(value.zip){const files={};for await(const file of value.zip())files[file.name]=file.data;bytes=zipSync(files);}await this.saveFile(value.name||'WorkArea-Offline',value.mime,bytes);}
 async render({target='#main',embedded=false}={}){
  const main=document.querySelector(target),profile=this.meta.profile,pending=this.pending();
  if(!this.meta.active){main.innerHTML='<section class="panel"><h1>Online & Offline</h1><p>Đăng nhập để mở dữ liệu và hàng chờ của tài khoản.</p><a class="button primary" href="#account">Đăng nhập</a></section>';return;}
  main.innerHTML=`<div class="page-top"><a class="back-link" href="#home">← Trang chủ</a><h1>Online & Offline</h1><p class="lead">Dữ liệu trên điện thoại · Đồng bộ với server</p></div><section class="panel device-sync-page"><span class="badge ${this.db?'green':'amber'}">${this.db?'Đã có dữ liệu offline':'Chưa tải dữ liệu offline'}</span><p>${esc(profile?.name||'Cần đăng nhập tài khoản')}</p><p class="device-sync-time">Dữ liệu tải lúc: ${this.meta.snapshotAt?esc(new Date(this.meta.snapshotAt).toLocaleString('vi-VN')):'Chưa tải'}</p><p><strong>${pending.length}</strong> thao tác chờ đồng bộ.</p><p class="notice">QTY, tiến độ SO và tồn Holding trên máy là tạm tính đến khi server xác nhận. Chỉ tải được dữ liệu của lần đồng bộ gần nhất.</p><div class="device-sync-buttons"><button class="button primary" id="offline-sync">Gửi hàng chờ lên server</button><button class="button" id="offline-prepare">Tải / cập nhật dữ liệu offline</button><button class="button" id="offline-export">Xuất bản dự phòng hàng chờ</button></div><p id="offline-message" class="muted device-sync-message" role="status">${esc(this.notice)}</p><details class="mt"><summary>Đăng nhập server để đồng bộ</summary><form id="offline-login"><label class="field">Tên đăng nhập<input name="username" autocomplete="username" required value="${esc(profile?.username||'')}"></label><label class="field">Mật khẩu<input name="password" type="password" autocomplete="current-password" required></label><button class="button primary" type="submit">Đăng nhập</button></form></details><ul class="device-sync-list">${pending.slice(0,100).map(op=>`<li><strong>${esc(names[op.path]||op.path)}</strong><small>${esc(op.body.barcode||op.body.samsung||op.body.code||op.body.item_code||op.body.location||'')} · ${esc(new Date(op.at).toLocaleString('vi-VN'))}</small>${op.error?`<p class="notice error">${esc(op.error)}</p>`:''}</li>`).join('')}</ul><p class="muted">Không xóa dữ liệu hoặc gỡ app khi còn hàng chờ. Nhập file dữ liệu và quản lý tài khoản cần mạng. App chỉ tự gửi khi đang mở; bản cũ trên điện thoại không thay cho bản sao lưu server.</p></section>`;
  if(embedded){main.querySelector('.page-top')?.remove();main.querySelector('.device-sync-page')?.insertAdjacentHTML('afterbegin','<h2>\u0110\u1ed3ng b\u1ed9 offline</h2>');}
  const run=(id,fn)=>document.querySelector('#'+id).onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{await fn();if(main.isConnected&&(embedded||location.hash==='#offline'))await this.render({target,embedded});}catch(error){this.notify(message(error));}finally{if(button.isConnected)button.disabled=false;}};
  run('offline-sync',async()=>{this.conflict=null;await this.sync();});run('offline-prepare',()=>this.prepare());run('offline-export',async()=>{const canceled=(await read('canceled')||[]).filter(op=>op.actor?.id===profile.id),data={format:1,exported_at:new Date().toISOString(),owner:profile,snapshot_at:this.meta.snapshotAt,realm:this.meta.realm,id_mappings:this.meta.maps,pending:this.pending(),acknowledged:this.ops.filter(op=>op.ack),canceled};await this.saveFile('WorkArea-Hang-Cho-'+Date.now()+'.json','application/json',Buffer.from(JSON.stringify(data,null,2)));});
  for(const op of pending.filter(v=>v.error)){const button=document.createElement('button');button.className='button danger mt full';button.textContent='Hủy lượt lỗi và '+Math.max(0,this.cancellationGroup(op).length-1)+' lượt phụ thuộc';button.onclick=async()=>{button.disabled=true;try{await this.cancelFailed(op.id);await this.render({target,embedded});}catch(error){this.notify(message(error));}finally{if(button.isConnected)button.disabled=false;}};document.querySelector('.device-sync-page').append(button);}
  document.querySelector('#offline-login').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;try{await this.login(Object.fromEntries(new FormData(form)));form.reset();this.conflict=null;await this.sync();await this.render({target,embedded});}catch(error){this.notify(message(error));}finally{if(button.isConnected)button.disabled=false;}};
 }
}
export const offlineClient=new OfflineClient();
window.WorkAreaOffline=offlineClient;
