(function(){
"use strict";
const button=document.getElementById("microsoftLogin"),toast=document.getElementById("loginToast");
if(!button||!toast)return;
const returningLocal=new URLSearchParams(location.search).get('from')==='local';
if(returningLocal){
 document.getElementById('loginDemo').hidden=true;
 document.getElementById('loginReturn').hidden=false;
}
let toastTimer;
button.addEventListener("click",()=>{
 clearTimeout(toastTimer);
 toast.textContent=returningLocal?"Microsoft 365ログインは準備中です。下のリンクから元の勤怠画面に戻れます。":"Microsoft 365ログインは準備中です。デモから画面を確認できます。";
 toast.dataset.visible="true";
 toastTimer=setTimeout(()=>{delete toast.dataset.visible;toast.textContent="";},6000);
});
})();
