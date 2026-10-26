(function(){
"use strict";
let C=window.AttendanceCore;
const $=id=>document.getElementById(id),h=value=>C.xml(value);
const STORAGE="day-attendance-app-v1";
let state=C.seed();
try{state=C.hydrate(JSON.parse(localStorage.getItem(STORAGE)||"null"))||state;}catch{}
const ui={role:"employee",tab:"home",employee:"E001",offset:0,monthOffset:0,recordsView:"list",selectedDay:C.TODAY,filter:"all",query:"",department:"all",onlyMissing:false,detail:null};
const paths={
home:"M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9",
calendar:"M5 5h14v16H5zM8 3v4m8-4v4M5 10h14",
menu:"M4 6h16M4 12h16M4 18h16",
edit:"m4 16-1 5 5-1L20 8l-4-4L4 16M14 6l4 4",
arrow:"M5 12h14m-5-5 5 5-5 5",
chevron:"m9 5 7 7-7 7",back:"m15 5-7 7 7 7",
download:"M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5",
search:"M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
people:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-7a4 4 0 0 1 0 7.75",
settings:"M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
clock:"M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
check:"m5 12 4 4L19 6",close:"m6 6 12 12M6 18 18 6",
info:"M12 11v6m0-10v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
pause:"M8 5v14M16 5v14"
};
const icon=(name,size=20)=>'<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[name]||paths.info)+'"/></svg>';
const now=()=>C.clockAt().minutes;
const employee=()=>state.employees.find(e=>e.id===ui.employee)||state.employees[0];
const period=()=>C.periodAt(C.TODAY,state.settings.cutoff,ui.offset);
const current=()=>C.periodFor(C.TODAY,state.settings.cutoff);
const md=d=>Number(d.slice(5,7))+"/"+Number(d.slice(8,10));
const periodLabel=p=>md(p.start)+"〜"+md(p.end);
const cutoffLabel=n=>n===0?"月末":n+"日";
const stamp=d=>md(d)+"（"+C.WEEK[C.weekday(d)]+"）";
const cls=s=>["missing","incomplete"].includes(s)?"warning":["working","break"].includes(s)?"active":s==="complete"?"good":"quiet";
const badge=s=>'<span class="badge '+cls(s)+'">'+h(C.statusText(s))+'</span>';
const action=(name,text,extra="",className="button")=>'<button type="button" class="'+className+'" data-action="'+name+'" '+extra+'>'+text+'</button>';
let toastTimer,confirmCallback=null,editContext=null,punchOperation=null,punchSequence=0,punchError=null,breakEdit=null,breakError=null,breakOpen=null,homeOvernight=null,homeTimeGuard=null,recordWriteBusy=false;
const PUNCH_FEEDBACK_MS=650,PUNCH_SWITCH_MS=140,BREAK_PRESETS=[0,30,45,60,90];
function recordIsSaving(){return recordWriteBusy||punchOperation?.phase==="saving";}
function punchLocked(punch,id,day){
 return recordIsSaving()||!!(punchOperation&&punchOperation.id===id&&punchOperation.day===day&&punchOperation.punch===punch);
}
function refreshPunchButtons(clock=C.clockAt()){
 if(ui.role!=="employee"||ui.tab!=="home"||!$("punchActions"))return;
 const r=state.records[C.key(ui.employee,clock.day)];
 $("punchActions").innerHTML=punchButton("start",r,clock)+punchButton("end",r,clock);
}
function toast(message){$("toast").textContent=message;$("toast").classList.add("visible");clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("toast").classList.remove("visible"),3600);}
function persist(message,candidate=state){try{localStorage.setItem(STORAGE,JSON.stringify(candidate));if(message)toast(message);return true;}catch{toast("保存できませんでした。空き容量やブラウザの保存設定を確認して、もう一度お試しください。");return false;}}
function openDialog(dialog){if(!dialog.open)dialog.showModal();}
function ask(title,message,callback,label="実行する"){$("confirmTitle").textContent=title;$("confirmText").textContent=message;$("confirmAction").textContent=label;$("confirmAction").disabled=false;confirmCallback=callback;openDialog($("confirmDialog"));}
function periodControl(){
 const p=period(),prev=C.periodAt(C.TODAY,state.settings.cutoff,ui.offset-1);
 return '<section class="period-control"><div class="period-selector">'+action("period",icon("back",17),'data-direction="-1" '+(prev.start<C.FIRST?"disabled":""),"icon-button")+'<div><strong>'+periodLabel(p)+'</strong><small>'+p.start.slice(0,4)+'年・'+cutoffLabel(p.cutoff)+'締め</small></div>'+action("period",icon("chevron",17),'data-direction="1" '+(ui.offset>=0?"disabled":""),"icon-button")+'</div>'+(ui.offset!==0?action("current-period","今の期間へ","","text-button"):"")+'</section>';
}
function nav(){
 const items=ui.role==="employee"?[["home","home","ホーム"],["records","calendar","勤怠"],["menu","menu","メニュー"]]:[["summary","clock","集計"],["people","people","社員"],["settings","settings","設定"]];
 return '<nav class="bottom-nav" aria-label="メインナビゲーション">'+items.map(([tab,ic,label])=>'<button type="button" class="nav-item '+(ui.tab===tab?"selected":"")+'" data-action="tab" data-tab="'+tab+'" '+(ui.tab===tab?'aria-current="page"':"")+'>'+icon(ic,21)+'<span>'+label+'</span></button>').join("")+'</nav>';
}


function weekGraphic(id,clock){
 const monday=C.add(C.TODAY,-((C.weekday(C.TODAY)+6)%7)),days=Array.from({length:7},(_,i)=>C.add(monday,i));
 const items=days.map(day=>{
  const r=state.records[C.key(id,day)],s=C.status(r,day),future=day>C.TODAY,started=r?.kind==="work"&&C.timeToMin(r.start)!=null;
  const kind=future?"future":day===C.TODAY&&!r?"unstarted":s==="missing"||s==="incomplete"?"missing":s==="leave"?"leave":s==="holiday"?"holiday":"work";
  return {day,r,s,kind,minutes:future?0:C.worked(r,day,clock.minutes),started};
 }),scale=Math.max(480,...items.map(x=>Math.ceil(x.minutes/120)*120)),total=items.reduce((sum,x)=>sum+x.minutes,0);
 const chart=items.map(x=>{
  const value=x.kind==="work"?C.shortDuration(x.minutes):({future:"未来",unstarted:"未打刻",missing:x.s==="incomplete"?"要確認":"未入力",leave:"有休",holiday:"休み"}[x.kind]);
  const aria=stamp(x.day)+" "+(x.kind==="work"?C.statusText(x.s)+"、実働 "+C.duration(x.minutes):value);
  const mark=x.kind==="work"?'<span class="week-graphic-bar" style="height:'+(x.minutes/scale*60).toFixed(2)+'px"></span>':'<span class="week-graphic-mark" aria-hidden="true">'+(x.kind==="missing"?"!":x.kind==="future"?"···":x.kind==="unstarted"?"○":"—")+'</span>';
  return '<button type="button" class="week-graphic-day kind-'+x.kind+(x.day===C.TODAY?" is-today":"")+'" data-action="edit" data-date="'+x.day+'" data-employee="'+id+'" '+(x.kind==="future"||x.day<C.FIRST?"disabled ":"")+'aria-label="'+h(aria)+'" '+(x.day===C.TODAY?'aria-current="date"':"")+'><span class="week-graphic-track" aria-hidden="true">'+mark+'</span><span class="week-graphic-value">'+value+'</span><span class="week-graphic-date">'+C.WEEK[C.weekday(x.day)]+' <b>'+Number(x.day.slice(8,10))+'</b></span></button>';
 }).join("");
 return '<section class="home-week" aria-labelledby="weekHeading"><div class="graphic-heading"><h2 id="weekHeading">今週の記録</h2><span class="graphic-total">計 <strong>'+C.shortDuration(total)+'</strong></span></div><div id="weekGraphic" class="week-graphic" aria-label="'+stamp(monday)+'からの実働時間。各日を選んで入力・修正">'+chart+'</div><p class="graphic-note">日付を選んで確認・修正 <span>実働・時間:分</span></p></section>';
}
function punchButton(punch,record,clock){
 const started=record?.kind==="work"&&C.timeToMin(record.start)!=null,finished=started&&!!record.end,undo=punch==="start"?started:finished;
 const id=punch==="start"?"startPunch":"endPunch",label=punch==="start"?"出勤":"退勤",recorded=undo?(punch==="start"?record.start:record.end):"";
 const active=punchOperation&&punchOperation.id===ui.employee&&punchOperation.day===clock.day&&punchOperation.punch===punch;
 const success=active&&punchOperation.phase==="success"&&["start","end"].includes(punchOperation.punch),saving=active&&punchOperation.phase==="saving";
 let disabled=punch==="end"&&!started,hint=disabled?"出勤後に使えます":"";
 if(punch==="start"&&undo){
  const check=C.cancelPunch(record,"start",clock.day,clock.minutes);
  if(!check.ok){disabled=true;hint=record.end?"先に退勤を取消":record.openBreak!=null||record.breaks?.length||record.breakMode!=="total"&&record.breakMinutes>0?"休憩の記録あり":"メモの記録あり";}
 }
 if(punchLocked(punch,ui.employee,clock.day)||homeButtonsGuarded(ui.employee,clock.day))disabled=true;
 const primary=!undo&&(punch==="start"?!started:started&&!finished);
 const nextDay=punch==="end"&&record?.overnight;
 const successMessage=recorded+"に"+(punch==="start"?"出勤しました":"退勤しました");
 const accessible=undo?(success?successMessage:label+" "+(nextDay?"翌日 ":"")+recorded+"。"+(saving?"保存中":hint||"取り消す")):saving?"保存中":label;
 const attrs='id="'+id+'" data-punch="'+punch+'" data-date="'+clock.day+'" data-employee="'+ui.employee+'" aria-label="'+h(accessible)+'" '+(disabled?"disabled ":"")+(recordIsSaving()?'aria-busy="true" ':"");
 const stamp=undo?'<span class="punch-stamp">'+(success?icon("check",13):"")+'<span>'+label+'</span><time class="punch-record-time" datetime="'+h(recorded)+'">'+(nextDay?'<small>翌</small>':"")+h(recorded)+'</time></span>':"";
 const content=undo?stamp+(success?'<span class="punch-feedback-text">'+h(successMessage)+'</span>':saving?'<small class="punch-state-note">保存中…</small>':hint?'<small class="punch-state-note">'+hint+'</small>':'<span class="punch-label punch-undo-label">取り消す</span>'):
 saving?'<span class="punch-label">保存中…</span>':'<span class="punch-label">'+label+'</span>'+(hint?'<small class="punch-state-note">'+hint+'</small>':"")+(!disabled?icon("arrow",20):"");
 return action(undo?"cancel-punch":"punch",content,attrs,"punch-button "+(primary?"is-primary":"is-secondary")+(undo?" is-undo is-recorded":"")+(success?" is-feedback":"")+(active&&punchOperation.phase==="switching"?" is-switching":""));
}
function homeBreakValue(id,day){
 const form=$("breakForm");
 if(form?.dataset.employee===id&&form.dataset.date===day)return C.parseBreakDuration($("breakHours").value,$("breakMinutes").value);
 if(breakEdit?.id===id&&breakEdit.day===day)return C.parseBreakDuration(breakEdit.hours,breakEdit.minutes);
 return {ok:true,value:C.breakTotal(state,id,day)};
}
function breakFields(prefix,total,disabled=false,draft=null){
 const hours=draft?draft.hours:Math.floor(total/60),minutes=draft?draft.minutes:String(total%60).padStart(2,"0"),off=disabled?"disabled ":"";
 return '<div class="break-duration" role="group" aria-label="休憩時間">'+
 '<label class="sr-only" for="'+prefix+'Hours">休憩の時間</label><input id="'+prefix+'Hours" type="number" inputmode="numeric" min="0" max="24" step="1" value="'+h(hours)+'" '+off+'required><span aria-hidden="true">時間</span>'+
 '<label class="sr-only" for="'+prefix+'Minutes">休憩の分</label><input id="'+prefix+'Minutes" type="number" inputmode="numeric" min="0" max="59" step="1" value="'+h(minutes)+'" '+off+'required><span aria-hidden="true">分</span></div>';
}
function restPresetButtons(scope,total,disabled=false){
 return '<div class="rest-presets" role="group" aria-label="休憩時間の候補">'+BREAK_PRESETS.map(minutes=>action("rest-preset",minutes+"分",'id="'+scope+'BreakPreset'+minutes+'" data-scope="'+scope+'" data-minutes="'+minutes+'" aria-pressed="'+(minutes===total)+'" '+(disabled?"disabled":""),"")).join("")+'</div>';
}
function syncRestPresets(scope){
 const prefix=scope==="home"?"break":"editBreak";
 if(!$(prefix+"Hours")||!$(prefix+"Minutes"))return;
 const input=C.parseBreakDuration($(prefix+"Hours").value,$(prefix+"Minutes").value);
 for(const minutes of BREAK_PRESETS)$(scope+"BreakPreset"+minutes)?.setAttribute("aria-pressed",String(input.ok&&input.value===minutes));
}
function applyRestPreset(scope,total){
 if(recordIsSaving()||!BREAK_PRESETS.includes(total))return;
 if(scope==="home"){
  const form=$("breakForm"),clock=C.clockAt();
  if(!form||ui.role!=="employee"||ui.tab!=="home")return;
  if(form.dataset.employee!==ui.employee||form.dataset.date!==clock.day){refreshClock(clock);return reportBreakError("表示する社員か日付が変わりました。今日の休憩時間から操作してください。");}
  $("breakHours").value=Math.floor(total/60);$("breakMinutes").value=String(total%60).padStart(2,"0");
  breakEdit={id:form.dataset.employee,day:form.dataset.date,hours:$("breakHours").value,minutes:$("breakMinutes").value};
  breakError=null;if($("breakError"))$("breakError").textContent="";
 }else if(scope==="editor"&&editContext){
  $("editBreakHours").value=Math.floor(total/60);$("editBreakMinutes").value=String(total%60).padStart(2,"0");
 }else return;
 syncRestPresets(scope);
}
function dailyBreakEditor(id,clock){
 const opened=breakOpen?.id===id&&breakOpen.day===clock.day;
 const draft=breakEdit?.id===id&&breakEdit.day===clock.day?breakEdit:null,total=C.breakTotal(state,id,clock.day);
 const error=breakError?.id===id&&breakError.day===clock.day?breakError.message:"";
 const attrs='data-employee="'+id+'" data-date="'+clock.day+'" aria-expanded="'+opened+'" '+(recordIsSaving()?"disabled":"");
 const summary='<div class="daily-break-row"><span class="daily-break-label">休憩時間</span><strong class="daily-break-total">'+C.duration(total)+'</strong>'+action("toggle-break",opened?"やめる":"変更",attrs,"text-button break-toggle")+'</div>';
 const form=opened?'<form id="breakForm" class="daily-break-form" data-employee="'+id+'" data-date="'+clock.day+'" novalidate><div class="daily-break-row">'+breakFields("break",total,recordIsSaving(),draft)+'<button type="submit" class="break-save" '+(recordIsSaving()?"disabled":"")+'>保存</button></div>'+restPresetButtons("home",draft?C.parseBreakDuration(draft.hours,draft.minutes).value:total,recordIsSaving())+'<p id="breakError" class="punch-error" role="alert">'+h(error)+'</p></form>':"";
 return '<div class="daily-break">'+summary+form+'</div>';
}
function reportBreakError(message){
 const clock=C.clockAt();breakOpen={id:ui.employee,day:clock.day};breakError={id:ui.employee,day:clock.day,message};render();toast(message);
}
function saveBreakInput(id,day){
 if(recordIsSaving()||$("confirmDialog").open||ui.role!=="employee"||ui.tab!=="home")return;
 const input=homeBreakValue(id,day),clock=C.clockAt();refreshClock(clock);
 if(id!==ui.employee||day!==clock.day)return reportBreakError("表示する社員か日付が変わりました。今日の休憩時間から操作してください。");
 if(!input.ok)return reportBreakError(input.error);
 const result=C.setBreakTotal(state.records[C.key(id,day)],input.value);
 if(!result.ok)return reportBreakError(result.error);
 if(!storePunchRecord(id,day,result.value,input.value))return reportBreakError("休憩時間を保存できませんでした。保存済みの時間は変更していません。もう一度お試しください。");
 punchOperation=null;breakEdit=null;breakError=null;breakOpen=null;punchError=null;render();toast("休憩時間を"+C.duration(input.value)+"で保存しました");
}
function homeButtonsGuarded(id,day){
 return homeTimeGuard?.id===id&&homeTimeGuard.day===day&&Date.now()<homeTimeGuard.until;
}
function guardHomeButtons(id,day){
 const guard={id,day,until:Date.now()+250};homeTimeGuard=guard;
 setTimeout(()=>releaseHomeTimeGuard(guard),250);
}
function releaseHomeTimeGuard(guard=homeTimeGuard){
 if(!guard||homeTimeGuard!==guard||Date.now()<guard.until)return;
 homeTimeGuard=null;
 const clock=C.clockAt(),{id,day}=guard;
 if(ui.role==="employee"&&ui.tab==="home"&&ui.employee===id&&clock.day===day&&$("punchActions")){
  const record=state.records[C.key(id,day)];
  $("punchActions").innerHTML=punchButton("start",record,clock)+punchButton("end",record,clock);
 }
}
function homeOvernightValue(id,day){
 return homeOvernight?.id===id&&homeOvernight.day===day?homeOvernight.value:!!state.records[C.key(id,day)]?.overnight;
}
function homeTimeLabel(punch,record){
 const label=punch==="start"?"出勤時刻":"退勤時刻";
 const recorded=record?.kind==="work"&&C.timeToMin(record[punch])!=null;
 return label+"を"+(recorded?"編集":"入力");
}
function homeTimeEditor(id,record,clock){
 const started=record?.kind==="work"&&C.timeToMin(record.start)!=null;
 const fields=[["start","homeStartTime"],["end","homeEndTime"]].map(([punch,field])=>{
  const value=started?(record[punch]||""):"",disabled=recordIsSaving()||punch==="end"&&!started,label=homeTimeLabel(punch,record);
  return '<label class="home-time-field" for="'+field+'"><span id="'+field+'Label">'+label+'</span><input id="'+field+'" class="home-time-input" type="time" step="60" aria-describedby="homeTimeHelp" value="'+h(value)+'" data-punch="'+punch+'" data-employee="'+id+'" data-date="'+clock.day+'" aria-label="今日の'+label+'" '+(disabled?"disabled":"")+'></label>';
 }).join("");
 return '<div class="home-time-editor" aria-label="今日の時刻を直接編集"><p id="homeTimeHelp" class="home-time-help"><span>時刻は手入力・修正できます</span><small>自動保存</small></p><div class="home-time-fields">'+fields+'</div><label class="home-nextday"><input id="homeOvernight" type="checkbox" data-employee="'+id+'" data-date="'+clock.day+'" '+(homeOvernightValue(id,clock.day)?"checked ":"")+(recordIsSaving()||!started?"disabled":"")+'>翌日に退勤</label></div>';
}
function refreshHomeAfterTimeEdit(clock){
 const id=ui.employee,r=state.records[C.key(id,clock.day)],started=r?.kind==="work"&&C.timeToMin(r.start)!=null;
 if($("punchActions"))$("punchActions").innerHTML=punchButton("start",r,clock)+punchButton("end",r,clock);
 if($("todayPunchState"))$("todayPunchState").textContent=started?(r.end?"退勤済み":"勤務中"):r?.kind==="leave"?"有休":r?.kind==="holiday"?"休み":"出勤前";
 for(const [field,punch] of [["homeStartTime","start"],["homeEndTime","end"]]){
  const input=$(field);if(!input)continue;
  const value=started?(r[punch]||""):"";
  if(input.value!==value)input.value=value;
  const label=homeTimeLabel(punch,r);
  if($(field+"Label"))$(field+"Label").textContent=label;
  input.setAttribute("aria-label","今日の"+label);
  input.disabled=recordIsSaving()||punch==="end"&&!started;
 }
 if($("homeOvernight")){$("homeOvernight").checked=homeOvernightValue(id,clock.day);$("homeOvernight").disabled=recordIsSaving()||!started;}
 if($("dailyBreak"))$("dailyBreak").innerHTML=dailyBreakEditor(id,clock);
 if($("punchError"))$("punchError").textContent="";
 if($("homeWeek"))$("homeWeek").innerHTML=weekGraphic(id,clock);
}
function saveHomeTime(punch,value,id,day,nextDay=homeOvernightValue(id,day)){
 if(recordIsSaving()||$("confirmDialog").open||$("editDialog").open||ui.role!=="employee"||ui.tab!=="home")return false;
 const clock=C.clockAt();refreshClock(clock);
 if(id!==ui.employee||day!==clock.day){reportPunchError("表示する社員か日付が変わりました。今日の時刻欄から操作してください。");return false;}
 if(!["start","end"].includes(punch))return false;
 if(C.timeToMin(value)==null){reportPunchError("時刻を入力してください。記録を消すときは打刻ボタンの「取り消す」を使えます。");return false;}
 const record=state.records[C.key(id,day)],input=homeBreakValue(id,day);
 if(!input.ok){reportBreakError(input.error);return false;}
 let base=record;
 if(record?.kind!=="work"||C.timeToMin(record.start)==null){
  if(punch!=="start"){reportPunchError("出勤時刻を先に記録してください。");return false;}
  const start=C.punch(record,"start",C.timeToMin(value),input.value);
  if(!start.ok){reportPunchError(start.error);return false;}base=start.value;
 }
 const candidate={...base,[punch]:value,breakMinutes:input.value,overnight:punch==="end"?!!nextDay:!!base.overnight};
 const result=C.validate(candidate,day,clock.minutes);
 if(!result.ok){reportPunchError(result.error,result.code==="break-exceeds-span");return false;}
 const updated={...base,...result.value};
 const timingChanged=base.start!==updated.start||base.end!==updated.end||!!base.overnight!==updated.overnight;
 if(timingChanged||base.breakMinutes!==updated.breakMinutes)delete updated.breaks;
 if(base.start!==updated.start)delete updated.startAt;
 if(base.end!==updated.end||!!base.overnight!==updated.overnight)delete updated.endAt;
 const unchanged=record?.kind==="work"&&["start","end","breakMinutes","overnight"].every(field=>record[field]===updated[field]);
 if(!unchanged){
  const op={token:++punchSequence,id,day,punch:"edit-"+punch,phase:"saving"};
  punchOperation=op;
  if(!storePunchRecord(id,day,updated)){
   punchOperation=null;reportPunchError("時刻を保存できませんでした。保存済みの記録は変更していません。もう一度お試しください。");return false;
  }
  punchOperation=null;guardHomeButtons(id,day);
 }
 breakEdit=null;breakError=null;breakOpen=null;punchError=null;
 if(updated.end)homeOvernight=null;
 // Keep the native time input mounted so choosing hours/minutes does not lose focus.
 refreshHomeAfterTimeEdit(clock);
 if(!unchanged)toast((punch==="start"?"出勤":"退勤")+"時刻を"+(punch==="end"&&updated.overnight?"翌日 ":"")+value+"で保存しました");
 return true;
}
function changeHomeOvernight(input){
 if(recordIsSaving()||$("confirmDialog").open||$("editDialog").open||ui.role!=="employee"||ui.tab!=="home")return;
 const id=input.dataset.employee,day=input.dataset.date,clock=C.clockAt();refreshClock(clock);
 if(id!==ui.employee||day!==clock.day)return reportPunchError("表示する社員か日付が変わりました。今日の時刻欄から操作してください。");
 const record=state.records[C.key(id,day)];
 if(record?.kind!=="work"||C.timeToMin(record.start)==null)return;
 if(record.end)saveHomeTime("end",record.end,id,day,input.checked);
 else homeOvernight={id,day,value:input.checked};
}
function homeView(){
 const e=employee(),r=state.records[C.key(e.id,C.TODAY)],clock=C.clockAt();
 const started=r?.kind==="work"&&C.timeToMin(r.start)!=null,finished=started&&!!r.end;
 const punchState=started?(finished?"退勤済み":"勤務中"):r?.kind==="leave"?"有休":r?.kind==="holiday"?"休み":"出勤前";
 const month=C.monthFor(C.TODAY),missing=C.visibleDates(month).filter(day=>day<C.TODAY&&["missing","incomplete"].includes(C.status(state.records[C.key(e.id,day)],day)));
 const firstMissing=missing[0],firstStatus=firstMissing?C.status(state.records[C.key(e.id,firstMissing)],firstMissing):null;
 const buttons=punchButton("start",r,clock)+punchButton("end",r,clock);
 const breakInput=dailyBreakEditor(e.id,clock);
 const issue=firstMissing?'<button type="button" class="home-issue" data-action="edit" data-date="'+firstMissing+'" data-employee="'+e.id+'"><span><strong>未入力の勤怠が'+missing.length+'日あります</strong><small>'+stamp(firstMissing)+(firstStatus==="incomplete"?"・退勤時刻の確認":"・記録が未入力")+'</small></span><span class="issue-action">確認する '+icon("chevron",14)+'</span></button>':"";
 const error=punchError&&punchError.id===e.id&&punchError.day===clock.day?punchError:null;
 const errorContent=error?h(error.message)+(error.canEditBreak?action("fix-break","休憩時間を変更",'id="fixBreakError" data-employee="'+e.id+'" data-date="'+clock.day+'"',"text-button punch-error-action"):""):"";
 const fullTime=clock.time+":"+clock.secondsText;
 return '<div class="home-heading"><h1>今日の勤怠</h1><p id="homeDate" class="home-date">'+liveDateLabel(clock.day)+'</p></div>'+
 '<section class="punch-box" aria-label="今日の打刻"><div class="punch-topline"><h2>今日の打刻</h2><strong id="todayPunchState" class="punch-state">'+h(punchState)+'</strong></div><div class="clock-layout"><time id="liveClock" class="home-clock" role="timer" aria-live="off" datetime="'+clock.iso+'" aria-label="現在の時刻 '+fullTime+'（日本時間）"><span id="clockMain" class="clock-main" aria-hidden="true">'+clock.time+'</span><span id="clockSeconds" class="clock-seconds" aria-hidden="true">:'+clock.secondsText+'</span></time><p class="punch-clock-label">現在時刻・日本時間</p></div><div id="punchActions" class="hero-actions clock-actions" role="group" aria-label="出退勤の打刻">'+buttons+'</div>'+homeTimeEditor(e.id,r,clock)+'<div id="dailyBreak">'+breakInput+'</div><p id="punchError" class="punch-error" role="alert">'+errorContent+'</p></section>'+
 issue+'<div id="homeWeek">'+weekGraphic(e.id,clock)+'</div>'+
 '<section class="home-records"><h2>記録の確認・修正</h2>'+action("records-all",'<span><strong>今月の勤怠を開く</strong><small>リスト／カレンダー</small></span>'+icon("chevron",17),"","home-record-link")+'</section>';
}
function reportPunchError(message,canEditBreak=false){
 const clock=C.clockAt();punchError={id:ui.employee,day:clock.day,message,canEditBreak};render();toast(message);
}
function storePunchRecord(id,day,value,draftMinutes){
 const records={...state.records},key=C.key(id,day);
 if(value==null)delete records[key];else records[key]=value;
 const breakDrafts={...state.breakDrafts};
 if(value?.kind==="work")delete breakDrafts[key];else if(draftMinutes!=null)breakDrafts[key]=draftMinutes;
 const candidate={...state,records,breakDrafts};
 if(recordWriteBusy)return false;
 recordWriteBusy=true;
 try{if(!persist(null,candidate))return false;state=candidate;return true;}
 finally{recordWriteBusy=false;}
}
function finishPunch(token){
 const op=punchOperation;
 if(!op||op.token!==token||recordIsSaving())return;
 if(op.phase==="success"&&Date.now()<op.releaseAt){
  op.phase="switching";op.until=op.releaseAt;
  refreshPunchButtons();
  setTimeout(()=>finishPunch(token),Math.max(0,op.until-Date.now()));return;
 }
 const focused=document.activeElement,buttonId=op.punch==="start"?"startPunch":"endPunch";
 const restoreFocus=op.restoreFocus&&(!focused||focused===document.body||focused.id===buttonId);
 punchOperation=null;refreshPunchButtons();
 if(restoreFocus&&ui.role==="employee"&&ui.tab==="home"&&ui.employee===op.id&&C.TODAY===op.day)$(buttonId)?.focus({preventScroll:true});
}
function settlePunch(op,phase){
 op.phase=phase;op.until=Date.now()+PUNCH_FEEDBACK_MS;op.releaseAt=op.until+(phase==="success"?PUNCH_SWITCH_MS:0);
 if(ui.role==="employee"&&ui.tab==="home")refreshHomeAfterTimeEdit(C.clockAt());
 setTimeout(()=>finishPunch(op.token),PUNCH_FEEDBACK_MS);
}
function beginPunch(punch,expectedDay,expectedEmployee){
 if(recordIsSaving()||$("confirmDialog").open||ui.role!=="employee"||ui.tab!=="home")return;
 const clock=C.clockAt();refreshClock(clock);
 if(punchLocked(punch,ui.employee,clock.day)||homeButtonsGuarded(ui.employee,clock.day))return;
 if(expectedDay&&expectedDay!==clock.day||expectedEmployee&&expectedEmployee!==ui.employee)return reportPunchError("表示する日付か社員が変わりました。現在の画面からもう一度操作してください。");
 if(!["start","end"].includes(punch))return;
 const id=ui.employee,key=C.key(id,clock.day),input=homeBreakValue(id,clock.day);
 if(!input.ok)return reportBreakError(input.error);
 const source=punch==="end"?C.setBreakTotal(state.records[key],input.value):{ok:true,value:state.records[key]};
 if(!source.ok)return reportBreakError(source.error);
 const result=C.punch(source.value,punch,clock.minutes,input.value);
 if(!result.ok)return reportPunchError(result.error,result.code==="break-exceeds-span");
 if(punch==="start")result.value.startAt=clock.iso;
 if(punch==="end")result.value.endAt=clock.iso;
 const op={token:++punchSequence,id,day:clock.day,punch,phase:"saving",restoreFocus:document.activeElement?.id===(punch==="start"?"startPunch":"endPunch")};
 punchOperation=op;punchError=null;breakError=null;$("punchAnnouncement").textContent="";render();
 if(!storePunchRecord(id,clock.day,result.value)){
  punchOperation=null;return reportPunchError("打刻を保存できませんでした。記録は変更していません。もう一度お試しください。");
 }
 breakEdit=null;breakOpen=null;
 if(punch==="end")homeOvernight=null;
 $("punchAnnouncement").textContent=(punch==="start"?result.value.start:result.value.end)+"に"+(punch==="start"?"出勤しました":"退勤しました");
 settlePunch(op,"success");
}
function requestPunchCancellation(id,day,punch){
 if(recordIsSaving()||$("confirmDialog").open||ui.role!=="employee"||id!==ui.employee||ui.tab!=="home")return;
 const clock=C.clockAt();refreshClock(clock);
 if(punchLocked(punch,id,clock.day)||homeButtonsGuarded(id,clock.day))return;
 if(day!==clock.day)return reportPunchError("日付が変わりました。今日の打刻から操作してください。");
 const key=C.key(id,day),record=state.records[key],result=C.cancelPunch(record,punch,day,clock.minutes);
 if(!result.ok)return reportPunchError(result.error);
 const op={token:++punchSequence,id,day,punch,phase:"saving",restoreFocus:true};
 punchOperation=op;punchError=null;$("punchAnnouncement").textContent="";render();
 if(!storePunchRecord(id,day,result.value,punch==="start"&&record.breakMode==="total"?record.breakMinutes:undefined)){
  punchOperation=null;return reportPunchError("取り消しを保存できませんでした。記録は変更していません。もう一度お試しください。");
 }
 homeOvernight=null;
 const message=punch==="end"?"退勤を取り消し、勤務中に戻しました":"出勤を取り消しました";
 toast(message);settlePunch(op,"cooldown");
}

function monthRange(offset=ui.monthOffset){return C.monthFor(C.TODAY,offset);}
function monthTitle(p){return p.start.slice(0,4)+"年"+Number(p.start.slice(5,7))+"月";}
function alignRecordMonth(day){
 const target=C.date(day),current=C.date(C.TODAY);
 ui.monthOffset=(target.getUTCFullYear()-current.getUTCFullYear())*12+target.getUTCMonth()-current.getUTCMonth();
 ui.selectedDay=day;
}
function monthControl(){
 const p=monthRange(),prev=monthRange(ui.monthOffset-1);
 return '<section class="period-control"><div class="period-selector month-selector">'+action("month-nav",icon("back",17),'data-direction="-1" aria-label="前の月" '+(prev.start<C.FIRST?"disabled":""),"icon-button")+'<div><strong>'+monthTitle(p)+'</strong><small>'+periodLabel(p)+'</small></div>'+action("month-nav",icon("chevron",17),'data-direction="1" aria-label="次の月" '+(ui.monthOffset>=0?"disabled":""),"icon-button")+'</div></section>';
}
function recordsViewSwitch(){
 return '<div class="records-view-switch" aria-label="勤怠の表示形式">'+action("records-view",icon("menu",16)+"リスト",'id="records-view-list" data-view="list" aria-pressed="'+(ui.recordsView==="list")+'"',ui.recordsView==="list"?"selected":"")+action("records-view",icon("calendar",16)+"カレンダー",'id="records-view-calendar" data-view="calendar" aria-pressed="'+(ui.recordsView==="calendar")+'"',ui.recordsView==="calendar"?"selected":"")+'</div>';
}
function recordRow(id,d){
 const r=state.records[C.key(id,d)],s=C.status(r,d),future=d>C.TODAY,work=C.worked(r,d,now());
 const range=future?'— <span class="range-arrow">→</span> —':r?.kind==="work"?(r.start||"—")+' <span class="range-arrow">→</span> '+(r.end?r.end+(r.overnight?" 翌日":""):"—"):s==="missing"?"時刻を入力":C.statusText(s);
 return '<button type="button" id="record-'+id+'-'+d+'" class="record-row '+(d===C.TODAY?"is-today ":"")+(future?"is-future":"")+'" data-action="edit" data-employee="'+id+'" data-date="'+d+'" '+(future?'disabled aria-label="'+stamp(d)+' これから。未来の日付は表示のみです"':d===C.TODAY?'aria-current="date"':"")+'><span class="record-date"><strong>'+md(d)+'</strong><small>'+C.WEEK[C.weekday(d)]+'曜日</small></span><span class="record-middle"><span class="'+(s==="missing"?"blue":"")+'">'+range+'</span><small>'+badge(s)+(!future&&r?.note?' <span class="note-dot" title="メモあり">メモ</span>':"")+'</small></span><span class="record-hours">'+(!future&&r?.kind==="work"?C.shortDuration(work):"—")+'</span>'+icon("chevron",15)+'</button>';
}
function calendarView(id,p){
 const selected=ui.selectedDay>=p.start&&ui.selectedDay<=p.end&&ui.selectedDay<=C.TODAY?ui.selectedDay:p.end<C.TODAY?p.end:C.TODAY;
 const grid=C.monthGrid(p).map(cell=>{
  const d=cell.day,n=Number(d.slice(8,10));
  if(!cell.inMonth)return '<div class="calendar-day outside-month" aria-hidden="true"><span class="calendar-number">'+n+'</span></div>';
  const r=state.records[C.key(id,d)],s=C.status(r,d),future=d>C.TODAY,work=C.worked(r,d,now()),weekend=C.weekday(d)===0||C.weekday(d)===6;
  const label=future?"—":["complete","working","break"].includes(s)?C.shortDuration(work):s==="missing"?"未入力":s==="incomplete"?"要確認":s==="leave"?"有休":"休み";
  const aria=stamp(d)+" "+C.statusText(s)+(r?.kind==="work"&&!future?" "+C.duration(work):"");
  return '<button type="button" id="calendar-day-'+id+'-'+d+'" class="calendar-day state-'+s+(d===C.TODAY?" is-today":"")+(d===selected?" is-selected":"")+(weekend?" is-weekend":"")+'" data-action="edit" data-date="'+d+'" data-employee="'+id+'" aria-label="'+h(aria)+'" '+(d===C.TODAY?'aria-current="date" ':"")+(future?"disabled":"")+'><span class="calendar-number">'+n+'</span><span class="calendar-day-label">'+label+'</span><span class="calendar-dot" aria-hidden="true"></span></button>';
 }).join("");
 return '<section class="month-calendar" aria-label="'+monthTitle(p)+'の勤怠カレンダー"><div class="calendar-weekdays" aria-hidden="true">'+["月","火","水","木","金","土","日"].map(d=>'<span>'+d+'</span>').join("")+'</div><div class="calendar-grid">'+grid+'</div><div class="calendar-legend"><span><i class="legend-blue"></i>記録あり</span><span><i class="legend-amber"></i>未入力</span><span><i class="legend-gray"></i>休み・これから</span></div></section>'+
 '<section class="calendar-selected"><div class="calendar-selected-heading"><h2>選択した日</h2><span>タップして入力・修正</span></div>'+recordRow(id,selected)+'</section>';
}
function recordsView(){
 const e=employee(),p=monthRange(),sum=C.summary(state,e.id,p,now()),all=C.dates(p.start,p.end);
 const days=ui.filter==="missing"?all.filter(d=>["missing","incomplete"].includes(C.status(state.records[C.key(e.id,d)],d))):all;
 const editDay=p.end<C.TODAY?p.end:C.TODAY,calendar=ui.recordsView==="calendar";
 const heading='<div class="page-title"><div><p class="eyebrow">あなたの勤怠</p><h1>'+(ui.monthOffset===0?"今月の勤怠":"月ごとの勤怠")+'</h1></div>'+action("export-own",icon("download",20),'aria-label="表示中の月のExcelを出力"',"icon-button outlined")+'</div>'+monthControl()+recordsViewSwitch();
 const summary=calendar?'<div class="month-quick-summary"><span>実働 <b>'+C.shortDuration(sum.minutes)+'</b></span><span>出勤 <b>'+sum.days+'日</b></span><span>未入力 <b class="'+(sum.missing?"amber":"")+'">'+sum.missing+'日</b></span></div>':'<section class="panel compact"><div class="mini-stats"><div><span>実働</span><strong>'+C.shortDuration(sum.minutes)+'<small>時間</small></strong></div><div><span>出勤</span><strong>'+sum.days+'<small>日</small></strong></div><div><span>未入力</span><strong class="'+(sum.missing?"amber":"")+'">'+sum.missing+'<small>日</small></strong></div></div></section>';
 if(calendar)return heading+summary+'<div class="calendar-tools"><span>日付をタップして入力・修正</span>'+action("jump-today","今日","","text-button")+'</div>'+calendarView(e.id,p)+'<p class="helper">未来の日付は表示のみです。<br>管理者の集計は、設定した締め日で区切ります。</p>';
 return heading+summary+'<div class="list-toolbar"><div class="segmented">'+action("record-filter","すべて",'data-filter="all" aria-pressed="'+(ui.filter==="all")+'"',ui.filter==="all"?"selected":"")+action("record-filter","未入力 "+sum.missing,'data-filter="missing" aria-pressed="'+(ui.filter==="missing")+'"',ui.filter==="missing"?"selected":"")+'</div><div class="record-actions">'+action("jump-today","今日","","text-button")+action("edit",icon("edit",16)+"入力",'data-date="'+editDay+'" data-employee="'+e.id+'" data-work="true"',"text-button")+'</div></div>'+
 '<div class="list-count"><span>'+days.length+'日分を表示</span><span class="muted small">日付をタップして編集</span></div><section class="records-list">'+(days.length?days.map(d=>recordRow(e.id,d)).join(""):'<div class="empty">'+icon("check",32)+'<h3>未入力はありません</h3><p>この月の記録は入力できています。</p></div>')+'</section><p class="helper">未入力・休み・これからの日も1ヶ月分表示します。<br>未来の日付は表示のみです。</p>';
}
function employeeMenu(){
 const e=employee();
 return '<div class="page-title"><div><p class="eyebrow">アカウント</p><h1>メニュー</h1></div></div>'+
 '<section class="panel profile"><span class="avatar">'+h(e.name[0])+'</span><div><h2>'+h(e.name)+'</h2><p>'+h(e.department)+' · '+e.id+'</p></div></section>'+
 '<section class="panel menu-list">'+action("records-all",icon("calendar",19)+'<span>勤怠の記録</span>'+icon("chevron",16),"","menu-row")+action("export-own",icon("download",19)+'<span>締め期間のExcel</span>'+icon("chevron",16),"","menu-row")+action("about",icon("info",19)+'<span>このモックについて</span>'+icon("chevron",16),"","menu-row")+'</section>'+
 '<section class="panel"><h2>ほかの社員で試す</h2><p class="helper">サンプルの社員を切り替えられます。</p><label class="field-label" for="employeeSelect">表示する社員</label><select id="employeeSelect">'+state.employees.map(item=>'<option value="'+item.id+'" '+(item.id===ui.employee?"selected":"")+'>'+h(item.name)+'（'+h(item.department)+'）</option>').join("")+'</select></section>'+
 '<section class="panel"><h2>サンプルデータ</h2><p class="helper">変更はこのブラウザに保存されます。勤務先には送信されません。</p>'+action("reset-demo","初期状態に戻す","","button subtle")+'</section>';
}


function filteredEmployees(){
 const query=ui.query.trim().toLocaleLowerCase(),p=period();
 return state.employees.filter(e=>(ui.department==="all"||e.department===ui.department)&&(!query||(e.name+" "+e.id+" "+e.department).toLocaleLowerCase().includes(query))&&(!ui.onlyMissing||C.summary(state,e.id,p,now()).missing>0));
}
function rosterRows(list){
 const p=period();
 if(!list.length)return '<div class="empty">'+icon("search",30)+'<h3>該当する社員がいません</h3><p>検索条件を変えてみてください。</p></div>';
 return list.map(e=>{
  const sum=C.summary(state,e.id,p,now());
  return '<button type="button" class="staff-row" data-action="detail" data-employee="'+e.id+'"><span class="avatar small-avatar">'+h(e.name[0])+'</span><span class="staff-main"><strong>'+h(e.name)+'</strong><small>'+h(e.department)+' · '+e.id+'</small></span><span class="staff-numbers"><strong>'+C.shortDuration(sum.minutes)+'</strong><small>出勤 '+sum.days+'日</small></span><span class="staff-state"><span class="badge '+(sum.missing?"warning":"good")+'">'+(sum.missing?"未入力 "+sum.missing+"日":"入力済み")+'</span></span>'+icon("chevron",15)+'</button>';
 }).join("");
}
function adminSummary(){
 const p=period(),summaries=state.employees.map(e=>C.summary(state,e.id,p,now())),total=summaries.reduce((n,s)=>n+s.minutes,0),missing=summaries.filter(s=>s.missing).length;
 const list=state.employees.filter((e,i)=>summaries[i].missing).slice(0,4);
 return '<div class="page-title"><div><p class="eyebrow">管理者</p><h1>勤怠の集計</h1></div>'+action("export-admin",icon("download",18)+"Excel","","button primary")+'</div>'+periodControl()+
 '<div class="admin-stats"><section class="stat-card"><span>対象社員</span><strong>50<small>名</small></strong></section><section class="stat-card"><span>未入力がある社員</span><strong class="'+(missing?"amber":"")+'">'+missing+'<small>名</small></strong></section><section class="stat-card"><span>実働合計</span><strong class="stat-time">'+C.shortDuration(total)+'<small>時間</small></strong></section></div>'+
 '<div class="admin-columns"><section class="panel export-card"><span class="feature-icon">'+icon("download",23)+'</span><h2>勤怠表をExcelに</h2><p>50名分の社員別集計と日別明細を、<br>ひとつのExcelファイルにまとめます。</p>'+action("export-admin","Excelをダウンロード "+icon("arrow",17),"","button primary full")+'<p class="fine">モック用の仮レイアウトで出力します。</p></section>'+
 '<section class="panel"><div class="section-heading"><h2>入力状況</h2><span class="muted small">'+(50-missing)+' / 50名</span></div><div class="completion-track"><span style="width:'+((50-missing)/50*100)+'%"></span></div><p class="helper">未入力がない社員は'+(50-missing)+'名です。<br>出勤日は平日としたサンプルで確認しています。</p>'+action("people-missing","未入力のある社員を見る "+icon("arrow",17),"","button subtle full")+'</section></div>'+
 '<section class="panel no-padding"><div class="section-heading padded"><h2>確認が必要な社員</h2>'+action("people-all","すべて見る "+icon("chevron",14),"","text-button")+'</div>'+(list.length?rosterRows(list):'<div class="empty"><h3>全員の入力がそろっています</h3><p>この期間に未入力の社員はいません。</p></div>')+'</section>'+
 '<p class="helper">実働には勤務中の記録を含みます。集計時刻：'+C.time(now())+'</p>';
}
function peopleView(){
 const list=filteredEmployees();
 return '<div class="page-title"><div><p class="eyebrow">管理者</p><h1>社員の勤怠</h1></div>'+action("export-admin",icon("download",18)+"Excel","","button primary")+'</div>'+periodControl()+
 '<section class="filter-panel"><label class="search-field">'+icon("search",18)+'<input id="adminSearch" type="search" placeholder="氏名・社員IDで検索" value="'+h(ui.query)+'" autocomplete="off" aria-label="氏名・社員IDで検索"></label><div class="filter-row"><select id="departmentFilter" aria-label="所属で絞り込む"><option value="all">すべての所属</option>'+["営業","企画","管理"].map(d=>'<option '+(ui.department===d?"selected":"")+'>'+d+'</option>').join("")+'</select><label class="check-label"><input id="missingFilter" type="checkbox" '+(ui.onlyMissing?"checked":"")+'>未入力あり</label></div></section>'+
 '<div class="list-count"><span id="rosterCount">'+list.length+'名を表示</span><span class="muted small">タップで日別の記録へ</span></div><section id="rosterList" class="records-list">'+rosterRows(list)+'</section>';
}
function updateRoster(){
 const list=filteredEmployees();if($("rosterList"))$("rosterList").innerHTML=rosterRows(list);if($("rosterCount"))$("rosterCount").textContent=list.length+"名を表示";
}
function settingsView(){
 const p=current(),choice=state.settings.pending??state.settings.cutoff;
 return '<div class="page-title"><div><p class="eyebrow">管理者</p><h1>締め日・設定</h1></div></div>'+
 '<section class="panel"><div class="section-heading"><h2>現在の締め日</h2><span class="setting-value">'+cutoffLabel(state.settings.cutoff)+'</span></div><p class="helper">現在の対象期間：'+periodLabel(p)+'</p></section>'+
 '<section class="panel"><h2>次の期間から変更する</h2><p class="helper">現在・過去の期間はそのまま残ります。<br>変更後、最初の対象期間を確認して保存してください。</p><form id="settingsForm"><label class="field-label" for="cutoffSelect">新しい締め日</label><select id="cutoffSelect"><option value="0" '+(choice===0?"selected":"")+'>月末</option>'+Array.from({length:31},(_,i)=>i+1).map(n=>'<option value="'+n+'" '+(choice===n?"selected":"")+'>'+n+'日</option>').join("")+'</select><div id="periodPreview" class="period-preview"></div><button type="submit" class="button primary full">変更を予約する</button></form>'+
 (state.settings.pending!=null?'<p class="reserved">予約中：次の期間から '+cutoffLabel(state.settings.pending)+'締め</p>'+action("cancel-cutoff","変更予約を取り消す","","text-button"):"")+'</section>'+
 '<section class="panel"><h2>Excelの出力形式</h2><p class="helper">このモックでは、社員別集計と日別明細を仮のレイアウトで出力します。今の勤怠表の書式は、サンプル確認後に合わせる想定です。</p></section>'+
 '<section class="panel menu-list">'+action("about",icon("info",19)+'<span>このモックについて</span>'+icon("chevron",16),"","menu-row")+action("reset-demo",icon("settings",19)+'<span>サンプルを初期状態へ</span>'+icon("chevron",16),"","menu-row")+'</section>';
}
function updatePreview(){
 const select=$("cutoffSelect");if(!select)return;
 const n=C.nextPeriod(current(),Number(select.value)),count=C.dates(n.start,n.end).length;
 $("periodPreview").innerHTML='<span>変更後、最初の対象期間</span><strong>'+periodLabel(n)+'</strong><small>'+count+'日間 · '+n.start.slice(0,4)+'年</small><p>締め日の移行により、最初の期間の日数が変わる場合があります。</p>';
}
function detailView(id){
 const e=state.employees.find(item=>item.id===id);if(!e)return;
 ui.detail=id;const p=period(),sum=C.summary(state,id,p,now());
 $("detailTitle").textContent=e.name+"さんの勤怠";
 $("detailMeta").textContent=e.department+" · "+periodLabel(p);
 $("detailBody").innerHTML='<div class="detail-summary"><span>実働 <b>'+C.shortDuration(sum.minutes)+'</b></span><span>出勤 <b>'+sum.days+'日</b></span><span>未入力 <b>'+sum.missing+'日</b></span></div>'+action("export-person",icon("download",17)+"この社員のExcel",'data-employee="'+e.id+'"',"button subtle full")+'<div class="detail-records">'+C.visibleDates(p).reverse().map(d=>recordRow(id,d)).join("")+'</div>';
 openDialog($("detailDialog"));
}



function liveDateLabel(day){return Number(day.slice(5,7))+"月"+Number(day.slice(8,10))+"日（"+C.WEEK[C.weekday(day)]+"）";}
function refreshClock(clock=C.clockAt()){
 releaseHomeTimeGuard();
 if(punchOperation?.until&&Date.now()>=punchOperation.until)finishPunch(punchOperation.token);
 if(clock.day!==C.TODAY){
  const next=window.createAttendanceCore(new Date(clock.iso)),nextState=next.hydrate(state);
  C=next;window.AttendanceCore=C;
  if(nextState)state=nextState;
  ui.offset=0;ui.monthOffset=0;ui.selectedDay=C.TODAY;$("editDate").min=C.FIRST;$("editDate").max=C.TODAY;
  render();if($("detailDialog").open&&ui.detail)detailView(ui.detail);persist();return;
 }
 const main=$("clockMain"),seconds=$("clockSeconds"),time=$("liveClock"),day=$("homeDate");
 if(main&&main.textContent!==clock.time)main.textContent=clock.time;
 if(seconds&&seconds.textContent!==":"+clock.secondsText)seconds.textContent=":"+clock.secondsText;
 if(time){time.setAttribute("datetime",clock.iso);time.setAttribute("aria-label","現在の時刻 "+clock.time+":"+clock.secondsText+"（日本時間）");}
 if(day)day.textContent=liveDateLabel(clock.day);
 if(main&&main.dataset.graphicMinute!==clock.day+"T"+clock.time){
  main.dataset.graphicMinute=clock.day+"T"+clock.time;
  // Restore focus after updating live work totals.
  if($("homeWeek")){
   const active=document.activeElement,activeDay=active?.closest?.(".week-graphic-day")?.dataset.date;
   $("homeWeek").innerHTML=weekGraphic(ui.employee,clock);
   if(activeDay)document.querySelector('.week-graphic-day[data-date="'+activeDay+'"]')?.focus?.({preventScroll:true});
  }
 }
}

function render(){
 const admin=ui.role==="admin";
 let content;
 if(admin)content=ui.tab==="people"?peopleView():ui.tab==="settings"?settingsView():adminSummary();
 else content=ui.tab==="records"?recordsView():ui.tab==="menu"?employeeMenu():homeView();
 $("app").innerHTML='<div class="shell '+(admin?"admin":ui.tab==="home"?"home-shell":"")+'"><header class="app-header"><div class="header-row">'+action("brand-home",'day<span>.</span>',"","brand")+'<div class="mode-switch" aria-label="表示モード">'+action("role","社員",'data-role="employee" aria-pressed="'+(!admin)+'"',!admin?"selected":"")+action("role","管理者",'data-role="admin" aria-pressed="'+admin+'"',admin?"selected":"")+'</div></div><div class="demo-strip"><span><i></i>操作モック · サンプルデータ</span>'+action("about","このモックについて","","text-button")+'</div></header><main class="main-content">'+content+'</main>'+nav()+'</div>';
 $("browserTheme")?.setAttribute("content","#f3f5f7");
 if(admin&&ui.tab==="settings")updatePreview();
}
function fillEditor(id,day,forceWork=false){
 const e=state.employees.find(item=>item.id===id);if(!e)return;
 const r=state.records[C.key(id,day)],isWork=r?.kind==="work";
 editContext={employeeId:id,date:day};
 $("editTitle").textContent=stamp(day)+"の勤怠";
 $("editEmployee").textContent=e.name+" · "+e.department;
 $("editDate").value=day;
 $("editKind").value=forceWork?"work":r?.kind||(C.isWorkday(day)?"work":"holiday");
 $("editStart").value=isWork?r.start:"09:00";
 $("editEnd").value=isWork?r.end:day===C.TODAY?"":"18:00";
 const total=C.breakTotal(state,id,day);
 $("editBreakHours").value=Math.floor(total/60);$("editBreakMinutes").value=String(total%60).padStart(2,"0");
 $("editorBreakPresets").innerHTML=restPresetButtons("editor",total);
 $("editOvernight").checked=!!r?.overnight;
 $("editNote").value=r?.note||"";
 $("editorError").textContent="";
 $("deleteRecord").hidden=!r;
 toggleTimeFields();
}
function toggleTimeFields(){$("timeFields").hidden=$("editKind").value!=="work";}
function openEditor(id,day,forceWork=false){
 if(ui.role!=="admin"&&id!==ui.employee)return;
 if(!state.employees.some(e=>e.id===id)||day<C.FIRST||day>C.TODAY)return toast("入力できるサンプルの日付を選んでください。");
 if(ui.role==="employee"&&ui.tab==="records")ui.selectedDay=day;
 fillEditor(id,day,forceWork);openDialog($("editDialog"));
}
function saveEditor(){
 if(recordIsSaving()||!editContext)return;
 const day=$("editDate").value,id=editContext.employeeId;
 const input=C.parseBreakDuration($("editBreakHours").value,$("editBreakMinutes").value);
 if($("editKind").value==="work"&&!input.ok){$("editorError").textContent=input.error;return;}
 const record={kind:$("editKind").value,start:$("editStart").value,end:$("editEnd").value,breakMinutes:input.ok?input.value:0,overnight:$("editOvernight").checked,note:$("editNote").value};
 const result=C.validate(record,day,now());
 if(!result.ok){$("editorError").textContent=result.error;return;}
 const previous=state.records[C.key(id,day)];
 if(previous?.kind==="work"&&result.value.kind==="work"&&Object.prototype.hasOwnProperty.call(previous,"beforeStart"))result.value.beforeStart=previous.beforeStart?{...previous.beforeStart}:null;
 if(previous?.kind==="work"&&result.value.kind==="work"&&["start","end","breakMinutes","overnight"].every(field=>previous[field]===result.value[field])){
  if(Array.isArray(previous.breaks))result.value.breaks=previous.breaks.map(b=>({...b}));
  if(previous.startAt)result.value.startAt=previous.startAt;
  if(previous.endAt)result.value.endAt=previous.endAt;
 }
 if(!storePunchRecord(id,day,result.value)){
  $("editorError").textContent="勤怠を保存できませんでした。記録は変更していません。もう一度お試しください。";return;
 }
 punchOperation=null;
 if(id===ui.employee&&day===C.TODAY){breakEdit=null;breakError=null;breakOpen=null;homeOvernight=null;punchError=null;}
 if(ui.role==="employee"&&ui.tab==="records")alignRecordMonth(day);
 $("editDialog").close();render();
 if($("detailDialog").open&&ui.detail)detailView(ui.detail);
 toast("勤怠を保存しました");
}
function downloadBytes(bytes,filename){
 const blob=new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
 const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
 toast("Excelファイルを作成しました");
}
function exportOwn(id=ui.employee){
 const e=state.employees.find(item=>item.id===id);if(!e||(ui.role!=="admin"&&id!==ui.employee))return;
 const p=ui.role==="employee"&&ui.tab==="records"?monthRange():(ui.tab==="home"||ui.tab==="menu"?current():period());
 try{downloadBytes(C.employeeWorkbook(state,e,p,now()),"勤怠_"+e.name.replace(/\s/g,"")+"_"+p.start+"_"+p.end+".xlsx");}catch{toast("Excelを作成できませんでした。もう一度お試しください。");}
}
function exportAdmin(){
 if(ui.role!=="admin")return;
 const list=ui.tab==="people"?filteredEmployees():state.employees,p=period();
 if(!list.length)return toast("出力する社員がいません。");
 try{downloadBytes(C.adminWorkbook(state,list,p,now()),"勤怠集計_"+p.start+"_"+p.end+".xlsx");}catch{toast("Excelを作成できませんでした。もう一度お試しください。");}
}
document.addEventListener("click",event=>{
 if(["homeStartTime","homeEndTime"].includes(event.target.id)&&!event.target.disabled){
  try{event.target.showPicker?.();}catch{}return;
 }
 const b=event.target.closest?.("[data-action]");if(!b||b.disabled)return;
 const a=b.dataset.action;
 if(recordIsSaving()&&["punch","cancel-punch","toggle-break","fix-break","rest-preset","delete-record","reset-demo","confirm-yes"].includes(a))return;
 if(a==="role"){
  ui.role=b.dataset.role==="admin"?"admin":"employee";ui.tab=ui.role==="admin"?"summary":"home";ui.offset=0;ui.monthOffset=0;ui.selectedDay=C.TODAY;render();return;
 }
 if(a==="brand-home"){ui.tab=ui.role==="admin"?"summary":"home";ui.offset=0;render();return;}
 if(a==="tab"){
  const allowed=ui.role==="admin"?["summary","people","settings"]:["home","records","menu"];if(!allowed.includes(b.dataset.tab))return;
  ui.tab=b.dataset.tab;if(ui.tab==="home")ui.offset=0;render();window.scrollTo({top:0,behavior:"auto"});return;
 }
 if(a==="period"){
  const target=ui.offset+Number(b.dataset.direction),p=C.periodAt(C.TODAY,state.settings.cutoff,target);
  if(target>0||p.start<C.FIRST)return;ui.offset=target;render();return;
 }
 if(a==="current-period"){ui.offset=0;render();return;}
 if(a==="records-all"){ui.tab="records";ui.offset=0;ui.monthOffset=0;ui.selectedDay=C.TODAY;ui.filter="all";render();return;}

 if(a==="records-view"){
  ui.recordsView=b.dataset.view==="calendar"?"calendar":"list";ui.filter="all";render();
  $("records-view-"+ui.recordsView)?.focus?.();return;
 }
 if(a==="month-nav"){
  const offset=ui.monthOffset+Number(b.dataset.direction),p=monthRange(offset);
  if(offset>0||p.start<C.FIRST)return;
  ui.monthOffset=offset;ui.selectedDay=p.end<C.TODAY?p.end:C.TODAY;render();return;
 }
 if(a==="jump-today"){
  ui.monthOffset=0;ui.selectedDay=C.TODAY;ui.filter="all";render();
  if(ui.recordsView==="list")$("record-"+ui.employee+"-"+C.TODAY)?.scrollIntoView?.({block:"center",behavior:"auto"});
  else $("calendar-day-"+ui.employee+"-"+C.TODAY)?.focus?.();return;
 }

 if(a==="record-filter"){ui.filter=b.dataset.filter==="missing"?"missing":"all";render();return;}
 if(a==="people-all"||a==="people-missing"){
  if(ui.role!=="admin")return;ui.tab="people";ui.query="";ui.department="all";ui.onlyMissing=a==="people-missing";render();return;
 }
 if(a==="toggle-break"||a==="fix-break"){
  const clock=C.clockAt();refreshClock(clock);
  if(ui.role!=="employee"||ui.tab!=="home"||b.dataset.employee!==ui.employee||b.dataset.date!==clock.day)return;
  const opened=a==="toggle-break"&&breakOpen?.id===ui.employee&&breakOpen.day===clock.day;
  breakOpen=opened?null:{id:ui.employee,day:clock.day};
  if(a==="toggle-break")breakEdit=null;
  breakError=null;
  render();
  if(!opened)$(a==="fix-break"?"breakMinutes":"breakHours")?.focus?.({preventScroll:true});
  if(a==="fix-break")$("breakForm")?.scrollIntoView?.({block:"nearest",behavior:"auto"});
  return;
 }
 if(a==="edit"){openEditor(b.dataset.employee||ui.employee,b.dataset.date||C.TODAY,b.dataset.work==="true");return;}
 if(a==="cancel-punch"){requestPunchCancellation(b.dataset.employee,b.dataset.date,b.dataset.punch);return;}
 if(a==="punch"){beginPunch(b.dataset.punch,b.dataset.date,b.dataset.employee);return;}
 if(a==="detail"){if(ui.role==="admin")detailView(b.dataset.employee);return;}
 if(a==="export-own"){exportOwn();return;}
 if(a==="export-person"){exportOwn(b.dataset.employee);return;}
 if(a==="export-admin"){exportAdmin();return;}
 if(a==="about"){openDialog($("aboutDialog"));return;}
 if(a==="close"){const d=$(b.dataset.dialog);if(d?.open)d.close();return;}
 if(a==="rest-preset"){applyRestPreset(b.dataset.scope,Number(b.dataset.minutes));return;}
 if(a==="delete-record"){
  if(!editContext)return;
  const context={...editContext},day=$("editDate").value;
  if(!state.records[C.key(context.employeeId,day)])return;
  ask("この勤怠を削除しますか？",stamp(day)+"のサンプル記録を削除します。",()=>{
   punchOperation=null;delete state.records[C.key(context.employeeId,day)];if(context.employeeId===ui.employee&&day===C.TODAY){breakEdit=null;breakError=null;breakOpen=null;homeOvernight=null;homeTimeGuard=null;punchError=null;}if(ui.role==="employee"&&ui.tab==="records")alignRecordMonth(day);$("editDialog").close();render();if($("detailDialog").open&&ui.detail)detailView(ui.detail);persist("勤怠を削除しました");
  });return;
 }
 if(a==="confirm-yes"){b.disabled=true;const callback=confirmCallback;confirmCallback=null;$("confirmDialog").close();if(callback)callback();return;}
 if(a==="cancel-cutoff"){if(ui.role!=="admin")return;state.settings.pending=null;render();persist("締め日の変更予約を取り消しました");return;}
 if(a==="reset-demo"){
  ask("初期状態に戻しますか？","入力したサンプルの記録と、締め日の変更予約を削除して初期状態に戻します。",()=>{punchOperation=null;state=C.seed();breakEdit=null;breakError=null;breakOpen=null;homeOvernight=null;homeTimeGuard=null;ui.employee="E001";ui.offset=0;ui.monthOffset=0;ui.selectedDay=C.TODAY;ui.query="";ui.department="all";ui.onlyMissing=false;render();persist("サンプルを初期状態に戻しました");});return;
 }
});
document.addEventListener("input",event=>{
 if(["breakHours","breakMinutes"].includes(event.target.id)){
  const form=$("breakForm");if(!form||recordIsSaving())return;
  breakEdit={id:form.dataset.employee,day:form.dataset.date,hours:$("breakHours").value,minutes:$("breakMinutes").value};
  breakError=null;if($("breakError"))$("breakError").textContent="";syncRestPresets("home");
 }
 if(["editBreakHours","editBreakMinutes"].includes(event.target.id))syncRestPresets("editor");
 if(event.target.id==="adminSearch"){ui.query=event.target.value;updateRoster();}
});
document.addEventListener("change",event=>{
 const el=event.target;
 if(["homeStartTime","homeEndTime"].includes(el.id)){saveHomeTime(el.dataset.punch,el.value,el.dataset.employee,el.dataset.date);return;}
 if(el.id==="homeOvernight"){changeHomeOvernight(el);return;}
 if(el.id==="departmentFilter"){ui.department=el.value;updateRoster();}
 if(el.id==="missingFilter"){ui.onlyMissing=el.checked;updateRoster();}
 if(el.id==="employeeSelect"){if(state.employees.some(e=>e.id===el.value)){ui.employee=el.value;ui.offset=0;render();}}
 if(el.id==="cutoffSelect")updatePreview();
 if(el.id==="editKind")toggleTimeFields();
 if(el.id==="editDate"&&editContext&&/^\d{4}-\d{2}-\d{2}$/.test(el.value)&&el.value>=C.FIRST&&el.value<=C.TODAY)fillEditor(editContext.employeeId,el.value);
});
document.addEventListener("submit",event=>{
 if(event.target.id==="breakForm"){event.preventDefault();saveBreakInput(event.target.dataset.employee,event.target.dataset.date);}
 if(event.target.id==="editorForm"){event.preventDefault();saveEditor();}
 if(event.target.id==="settingsForm"){
  event.preventDefault();if(ui.role!=="admin")return;
  const choice=Number($("cutoffSelect").value);if(!Number.isInteger(choice)||choice<0||choice>31)return;
  state.settings.pending=choice===state.settings.cutoff?null:choice;
  render();persist(state.settings.pending==null?"現在の締め日のままです":"次の期間からの締め日変更を予約しました");
 }
});
document.querySelectorAll("dialog").forEach(dialog=>dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close();}));
$("confirmDialog").addEventListener("close",()=>{confirmCallback=null;});
$("editDialog").addEventListener("close",()=>{
 editContext=null;
 if(ui.role==="employee"&&ui.tab==="records"&&ui.recordsView==="calendar"){render();$("calendar-day-"+ui.employee+"-"+ui.selectedDay)?.focus?.();}
});
$("detailDialog").addEventListener("close",()=>{ui.detail=null;});
$("editDate").min=C.FIRST;$("editDate").max=C.TODAY;
render();
refreshClock();
setInterval(refreshClock,1000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshClock();});
window.addEventListener("pageshow",()=>refreshClock());
window.addEventListener("focus",()=>refreshClock());
})();
