(function(global){
"use strict";
const nav=global.navigator,base=new URL('./',global.document.currentScript?.src||global.location.href);
const workerUrl=new URL('paper-notifications-sw.js',base),appUrl=new URL('a-paper-app.html?v=paper-push33',base);
const TIMEOUT=8000;
let pending=null;
const failed=reason=>({ok:false,reason});
function getState(){
 const ios=/iPad|iPhone|iPod/.test(nav.userAgent||'')||(nav.platform==='MacIntel'&&nav.maxTouchPoints>1);
 const matches=query=>typeof global.matchMedia==='function'&&global.matchMedia(query).matches;
 const standalone=nav.standalone===true||matches('(display-mode: standalone)')||matches('(display-mode: fullscreen)');
 const supported=global.isSecureContext===true&&typeof nav.serviceWorker?.register==='function'&&typeof global.Notification?.requestPermission==='function'&&'PushManager' in global;
 const permission=global.Notification?.permission||'default';
 const reason=ios&&!standalone?'home-screen':!supported?'unsupported':permission==='denied'?'denied':null;
 return {supported,ios,standalone,permission,canTest:!reason,...(reason?{reason}:{})};
}
function within(promise){
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('timeout')),TIMEOUT);
  Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
 });
}
function activeRegistration(registration){
 if(registration.active?.state==='activated')return Promise.resolve(registration);
 return new Promise((resolve,reject)=>{
  const workers=new Set();
  const done=error=>{
   clearTimeout(timer);
   registration.removeEventListener?.('updatefound',check);
   for(const worker of workers)worker.removeEventListener('statechange',check);
   if(error)reject(error);else resolve(registration);
  };
  const check=()=>{
   for(const worker of [registration.installing,registration.waiting,registration.active]){
    if(worker&&!workers.has(worker)){workers.add(worker);worker.addEventListener('statechange',check);}
   }
   if(registration.active?.state==='activated')done();
  };
  const timer=setTimeout(()=>done(new Error('activation timeout')),TIMEOUT);
  registration.addEventListener?.('updatefound',check);
  check();
 });
}
async function run(permissionRequest){
 let permission;
 try{permission=await permissionRequest;}catch{return failed('dismissed');}
 if(permission!=='granted')return failed(permission==='denied'?'denied':'dismissed');
 let registration;
 try{
  registration=await within(nav.serviceWorker.register(workerUrl.href,{scope:base.href,updateViaCache:'none'}));
  await activeRegistration(registration);
 }catch{return failed('worker');}
 try{
  await within(registration.showNotification('SET 勤怠',{
   body:'これはSET勤怠のテスト通知です。定期通知は本番接続後に利用できます。',
   icon:new URL('paper-icon-192.png',base).href,tag:'paper-manual-test',
   data:{url:appUrl.href}
  }));
  return {ok:true};
 }catch{return failed('display');}
}
function testNotification(){
 if(pending)return pending;
 const state=getState();if(!state.canTest)return Promise.resolve(failed(state.reason));
 // Keep the permission prompt in the user's click, before any awaited worker operation.
 let permissionRequest;
 try{permissionRequest=state.permission==='granted'?'granted':global.Notification.requestPermission();}
 catch{return Promise.resolve(failed('dismissed'));}
 pending=run(permissionRequest).finally(()=>{pending=null;});
 return pending;
}
global.PaperPush=Object.freeze({getState,testNotification});
})(window);
