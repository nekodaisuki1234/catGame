"use strict";
// Notification reception only. This worker never intercepts requests or caches app data.
const appUrl=new URL('./a-paper-app.html?v=paper-reminders34',self.location.href);
const iconUrl=new URL('./paper-icon-192.png',self.location.href);
self.addEventListener('push',event=>{
 // Keep lock-screen content generic, including empty or malformed incoming payloads.
 event.waitUntil(self.registration.showNotification('SET 勤怠',{
  body:'勤怠のお知らせがあります。アプリで内容を確認してください。',
  icon:iconUrl.href,tag:'paper-attendance',data:{url:appUrl.href}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const client=windows.find(item=>{
   try{const url=new URL(item.url);return url.origin===appUrl.origin&&url.pathname===appUrl.pathname;}
   catch{return false;}
  });
  if(client){try{await client.focus();return;}catch{}}
  await self.clients.openWindow(appUrl.href);
 })());
});
