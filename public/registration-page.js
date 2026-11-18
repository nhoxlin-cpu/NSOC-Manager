const form=document.querySelector('#web-register-form'),submit=document.querySelector('#signup-submit'),progress=document.querySelector('#signup-progress'),error=document.querySelector('#signup-error');
let busy=false,completed=false;
form.addEventListener('submit',async event=>{
 event.preventDefault();if(busy||completed)return;
 const values=Object.fromEntries(new FormData(form));error.textContent='';
 if(values.password!==values.confirm){error.textContent='Mật khẩu xác nhận chưa khớp.';document.querySelector('#signup-confirm').focus();return;}
 busy=true;submit.disabled=true;progress.hidden=false;form.setAttribute('aria-busy','true');
 try{
  let response;try{response=await fetch('/api/register',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(values),signal:AbortSignal.timeout(20000)});}catch{throw Error('Chưa kết nối được server. Đăng ký cần có mạng; vui lòng thử lại.');}
  let result;try{result=await response.json();}catch{throw Error('Chưa nhận được đầy đủ kết quả đăng ký. Vui lòng kiểm tra kết nối rồi thử lại.');}
  if(!response.ok)throw Error(result.error||'Chưa đăng ký được. Vui lòng thử lại.');
  if(!result.ok||typeof result.username!=='string')throw Error('Chưa xác nhận được kết quả đăng ký. Vui lòng thử đăng nhập hoặc kiểm tra lại.');
  completed=true;form.reset();document.querySelector('#signup-card').hidden=true;document.querySelector('#signup-success').hidden=false;
  document.querySelector('#signup-result').textContent=result.pending?`Tài khoản ${result.username} đang chờ quản trị viên duyệt. Bạn có thể đăng nhập sau khi được duyệt.`:`Tài khoản ${result.username} đã được tự động duyệt. Bạn có thể đăng nhập ngay.`;
  document.querySelector('#signup-success').scrollIntoView({block:'start'});
 }catch(e){error.textContent=e.message;}
 finally{busy=false;submit.disabled=completed;progress.hidden=true;form.removeAttribute('aria-busy');}
});
fetch('/api/registration',{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000)}).then(async response=>{if(!response.ok)throw Error();return response.json();}).then(policy=>{document.querySelector('#signup-policy').textContent=policy.mode==='manual'?'Admin duyệt thủ công: tài khoản mới cần được duyệt trước khi đăng nhập.':'Tự động duyệt: đăng ký thành công có thể đăng nhập ngay.';}).catch(()=>{document.querySelector('#signup-policy').textContent='Cần kết nối server để kiểm tra chế độ duyệt và đăng ký.';});
