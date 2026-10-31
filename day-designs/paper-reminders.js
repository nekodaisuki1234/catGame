(function(global,factory){
"use strict";
if(typeof module==='object'&&module.exports)module.exports=factory;
else if(global.PaperAttendance)global.PaperReminders=factory(global.PaperAttendance);
})(typeof window!=='undefined'?window:globalThis,function(C){
"use strict";
// Planning only. The authenticated sender owns delivery, employee scope and deduplication.
const policy=Object.freeze({
 timeZone:'Asia/Tokyo',
 missing:Object.freeze({time:'09:00'}),
 submission:Object.freeze({time:'09:00',deadline:'closing-day'})
});
const at=day=>day+'T09:00:00+09:00';
const validNow=now=>!!now&&typeof now==='object'&&!Array.isArray(now)&&typeof now.day==='string'&&C.validDay(now.day)&&Number.isInteger(now.minutes)&&now.minutes>=0&&now.minutes<1440;
const blocked=(kind,reason)=>({kind,reason});
function nextMissingAt(now){
 if(!validNow(now))return null;
 // This is the next future slot: at exactly 09:00 today's slot is already due.
 let day=now.minutes<540?now.day:C.add(now.day,1);
 for(let i=0;i<370&&C.validDay(day);i++,day=C.add(day,1)){
  const workday=C.workday(day);
  if(workday===null)return null;
  if(workday)return {day,time:policy.missing.time};
 }
 return null;
}
function unknownMissingCalendar(state,now){
 for(let day=C.firstDay(state);day<now.day;day=C.add(day,1)){
  const record=state.records[day];
  // These records are complete/exempt regardless of whether the day was a holiday.
  if(C.fullLeave(record)||record?.start&&record.end)continue;
  if(C.workday(day)===null)return true;
 }
 return false;
}
function plan(raw,now,options={}){
 const result={events:[],blocked:[]};
 if(!validNow(now)){result.blocked.push(blocked('all','invalid-now'));return result;}
 if(!raw||typeof raw!=='object'||Array.isArray(raw)){result.blocked.push(blocked('all','invalid-state'));return result;}
 if(raw.mode!=='local'){result.blocked.push(blocked('all','demo-mode'));return result;}
 let state;
 try{state=C.hydrate(raw,now);}catch{}
 if(!state){result.blocked.push(blocked('all','invalid-state'));return result;}
 if(now.minutes<540)return result;
 const workday=C.workday(now.day);
 if(workday===null)result.blocked.push(blocked('missing','calendar-unavailable'));
 else if(workday){
  if(unknownMissingCalendar(state,now))result.blocked.push(blocked('missing','calendar-unavailable'));
  else{
   const missingDays=Array.from(C.pastMissing(state,now));
   if(missingDays.length)result.events.push({
    kind:'missing',key:'missing:'+now.day,scheduledAt:at(now.day),
    title:'SET 勤怠',body:'未入力の勤怠があります。アプリで確認してください。',missingDays
   });
  }
 }
 const month=C.month(now.day);
 const period=now.day.slice(8)==='15'?C.periods(now.day)[0]:now.day===month.end?C.periods(now.day)[2]:null;
 if(period&&period.end>=C.firstDay(state)){
  // Never infer formal submission from local test/export history.
  let status;
  try{if(typeof options?.submissionStatus==='function')status=options.submissionStatus({...period});}catch{}
  if(status==='unsubmitted')result.events.push({
   kind:'submission',key:'submission:'+C.periodKey(period),scheduledAt:at(now.day),
   title:'SET 勤怠',body:'勤務表の提出期限は本日です。アプリで確認してください。',period:{...period}
  });
  else if(status!=='submitted')result.blocked.push(blocked('submission','submission-status-unavailable'));
 }
 return result;
}
return Object.freeze({policy,plan,nextMissingAt});
});
