(function(){
"use strict";
const button=document.getElementById("microsoftLogin"),toast=document.getElementById("loginToast");
if(!button||!toast)return;
let toastTimer;
button.addEventListener("click",()=>{
 clearTimeout(toastTimer);
 toast.textContent="Microsoft 365ログインは準備中です。デモから画面を確認できます。";
 toast.dataset.visible="true";
 toastTimer=setTimeout(()=>{delete toast.dataset.visible;toast.textContent="";},6000);
});
})();
