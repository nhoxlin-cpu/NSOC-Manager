// APK-only advanced settings. Origin isolation keeps IndexedDB and cookies separate.
if(window.WorkAreaNative?.chooseServer){
 const install=()=>{const root=document.querySelector('#mm-settings-details');if(!root||root.querySelector('[data-server-settings]'))return;
 const panel=document.createElement('details');panel.dataset.serverSettings='true';panel.className='mt';
 const title=document.createElement('summary');title.textContent='Cài đặt nâng cao';panel.append(title);
 const button=document.createElement('button');button.type='button';button.className='button small';button.textContent='Đổi server';
 button.onclick=async()=>{const {offlineClient}=await import('/offline-runtime.js');if(offlineClient.pending().length){alert('Còn lượt chờ đồng bộ. Gửi hết hàng chờ hoặc xuất bản dự phòng trước khi đổi server.');return;}window.WorkAreaNative.chooseServer();};
 panel.append(button);root.append(panel);};
 new MutationObserver(install).observe(document.querySelector('#main'),{subtree:true,childList:true});install();
}
