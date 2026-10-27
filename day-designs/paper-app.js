(function(){
"use strict";
const C=window.PaperAttendance,root=document.getElementById("previewApp"),dialog=document.getElementById("paperDialog");
if(!C||!root||!dialog)return;
const $=id=>document.getElementById(id),h=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const embed=new URLSearchParams(location.search).get("embed")==="1";
if(embed)document.documentElement.setAttribute("data-embed","");
if(new URLSearchParams(location.search).get("screen")==="1")document.documentElement.setAttribute("data-screen","");
const EMPLOYEE={name:"田中 花子",department:"営業",id:"E001"},PRESETS=[0,30,45,60,90];
let now=C.clock(),renderedDay=now.day,sampleClock="",view="home",detail="summary",restOpen=false,error="",toastTimer,lockUntil=0;
let selectedMonth=C.month(now.day).start,settingsTab="defaults",projectIndex=0,placeIndex=0,settingsDraft=null,editDay="",submitPeriod=null,testSubmission=true;
let lastSaved=null,storageProblem="",data;
let punchFeedback=null,feedbackTimer,warningTimer;
let editorReturn="records";const editorDrafts=new Map();
const homeDrafts=new Map(),listPositions=new Map();let lastMinute="";
const homeDraft=()=>homeDrafts.get(now.day)||{};
function setHomeDraft(key,value){homeDrafts.set(now.day,{...homeDraft(),[key]:value});}
function clearHomeDraft(...keys){const draft={...homeDraft()};keys.forEach(key=>delete draft[key]);homeDrafts.set(now.day,draft);}
function rememberList(){if(view==="records"&&$("recordList"))listPositions.set(selectedMonth,{top:$("recordList").scrollTop,page:window.scrollY});}
function rememberRoute(replace=false){try{history[replace?'replaceState':'pushState']({paper:true,view,month:selectedMonth,day:editDay,origin:editorReturn},"");}catch{}}
function restorePosition(){if(view==="records"&&listPositions.has(selectedMonth))window.scrollTo(0,listPositions.get(selectedMonth).page);else root.scrollIntoView({block:"start"});}
try{
 lastSaved=localStorage.getItem(C.KEY);
 data=lastSaved?C.hydrate(JSON.parse(lastSaved),now):C.seed(now);
 if(!data)storageProblem="保存データを読み込めません。元のデータを保護しているため、保存を停止しています。";
}catch{storageProblem="保存領域を読み込めません。ブラウザの保存設定を確認してください。";}
data=data||C.seed(now);
const record=day=>data.records[day]||C.empty(data);
const clockNow=()=>{const real=C.clock();return sampleClock?{...real,time:sampleClock.slice(0,5),full:sampleClock,minutes:C.timeToMin(sampleClock.slice(0,5))}:real;};
const dayLabel=day=>Number(day.slice(5,7))+"月"+Number(day.slice(8,10))+"日（"+C.WEEK[C.weekday(day)]+"）";
const periodLabel=p=>p.start.replaceAll("-","/")+" 〜 "+p.end.replaceAll("-","/");
const placeName=id=>data.settings.places.find(p=>p.id===id)?.code||"—";
const allocationTotal=r=>C.PROJECTS.reduce((sum,k)=>sum+Math.round(r.allocation[k]*60),0);
const options=(list,current)=>list.map(([value,label])=>'<option value="'+h(value)+'"'+(value===current?' selected':'')+'>'+h(label)+'</option>').join("");
const placeOptions=id=>options(data.settings.places.map(p=>[p.id,p.code]),id);
const leaveOptions=id=>options(Object.entries(C.LEAVES),id);
const paths={home:"M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",calendar:"M5 5h14v16H5zM8 3v4m8-4v4M5 10h14",send:"m3 3 19 9-19 9 4-9-4-9Zm4 9h15",settings:"M4 7h16M4 17h16M8 4v6m8 4v6",chart:"M4 19h17M5 15l5-5 4 3 6-8m-5 0h5v5",leave:"M9 3h6v7h7v5h-7v7H9v-7H2v-5h7V3",work:"M5 7h14v13H5zM9 7V4h6v3M5 12h14m-7-2v4"};
function icon(name){return '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+paths[name]+'"/></svg>';}
function toast(message,{warning=false}={}){if(embed)return;const node=$("studyToast");node.textContent=message;node.classList.toggle("is-warning",warning);node.classList.add("visible");clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove("visible"),warning?7000:3600);}
function showError(message){error=message;const box=dialog.open?$("dialogError"):$("previewError");if(box)box.textContent=message;toast(message);}
function showWarning(message){
 toast(message,{warning:true});
}
function commit(next,message){
 if(storageProblem){showError(storageProblem);return false;}
 try{
  if(localStorage.getItem(C.KEY)!==lastSaved){showError("別の画面で記録が更新されています。再読み込みしてから操作してください。");return false;}
  next.revision=data.revision+1;
  const text=JSON.stringify(next);localStorage.setItem(C.KEY,text);lastSaved=text;
 }catch{showError("保存できませんでした。記録は変更していません。保存設定を確認して再操作してください。");return false;}
 data=next;error="";for(const id of ["previewError","dialogError"])if($(id))$(id).textContent="";if(message)toast(message);return true;
}
function saveRecord(day,next,message){
 const check=C.validateRecord(next,day,now,data.settings);if(!check.ok){showError(check.error);return false;}
 const previous=data.records[day];
 if(previous&&Object.keys(check.value).every(k=>JSON.stringify(previous[k])===JSON.stringify(check.value[k]))){
  try{if(!storageProblem&&localStorage.getItem(C.KEY)===lastSaved){error="";if($("previewError"))$("previewError").textContent="";return true;}}catch{}
 }
 const changed=["start","end","overnight","breakMinutes"].some(k=>previous?.[k]!==next[k])||C.PROJECTS.some(k=>previous?.allocation[k]!==next.allocation[k]);
 const candidate=C.clone(data);candidate.records[day]=check.value;C.invalidateSubmissions(candidate,day);
 const saved=commit(candidate,message);
 if(saved)editorDrafts.delete(day);
 if(saved&&changed){clearTimeout(warningTimer);if(check.warnings?.length)warningTimer=setTimeout(()=>showWarning(check.warnings.join(" ")),0);}
 return saved;
}
function updateToday(change,message){
 now=clockNow();
 if(now.day!==renderedDay){render();showError("日付が変わりました。今日の画面を確認して再操作してください。");return false;}
 return saveRecord(now.day,{...record(now.day),...change},message);
}
function status(r){return C.fullLeave(r)?C.LEAVES[r.leave]:r.end?"退勤済み":r.start?"勤務中":"出勤前";}
function punches(){
 const r=record(now.day),locked=Date.now()<lockUntil;
 return ["start","end"].map(kind=>{
  const name=kind==="start"?"出勤":"退勤",value=r[kind],disabled=locked||C.fullLeave(r)||kind==="end"&&!r.start;
  const success=!!value&&punchFeedback?.time===value&&punchFeedback?.kind===kind&&punchFeedback.day===now.day&&Date.now()<punchFeedback.until;
  const caption=success?'<span class="punch-success"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>'+name+'完了</span>':'<span class="punch-caption">'+name+'打刻</span>';
  return '<button id="'+kind+'Punch" type="button" class="punch-button'+(value?' is-recorded':'')+(success?' is-success':'')+'" data-action="punch" data-kind="'+kind+'" aria-label="'+name+'打刻'+(value?'、'+value+'。現在時刻で上書き':'')+'" '+(disabled?'disabled':'')+'>'+caption+(value?'<time class="punch-time">'+(kind==="end"&&r.overnight?'翌 ':'')+value+'</time>':'')+'</button>';
 }).join("")+'<button id="resetPunch" type="button" class="punch-button punch-reset" data-action="reset-punches" '+(locked||!r.start&&!r.end?'disabled':'')+'><span class="punch-caption">取消</span></button>';
}
function lockPunches(ms=500){lockUntil=Date.now()+ms;if($("punchActions"))$("punchActions").innerHTML=punches();setTimeout(()=>{if($("punchActions"))$("punchActions").innerHTML=punches();},ms+10);}
function animatePunch(kind){
 const feedback={kind,time:record(now.day)[kind],day:now.day,until:Date.now()+850};punchFeedback=feedback;clearTimeout(feedbackTimer);
 feedbackTimer=setTimeout(()=>{if(punchFeedback!==feedback)return;punchFeedback=null;if($("punchActions"))$("punchActions").innerHTML=punches();},850);
}
function restEditor(){
 const r=record(now.day);
 const draft=homeDraft().rest||{hours:String(Math.floor(r.breakMinutes/60)),minutes:String(r.breakMinutes%60)};
 return '<div class="rest-row"><span>休憩時間</span><strong>'+C.duration(r.breakMinutes)+'</strong><button class="text-button" type="button" data-action="rest">'+(restOpen?'やめる':homeDraft().rest?'変更・未保存':'変更')+'</button></div>'+(restOpen?'<form id="restForm" class="rest-form"><div class="rest-inputs"><label class="sr-only" for="restHours">休憩の時間</label><input id="restHours" type="number" min="0" max="24" required value="'+h(draft.hours)+'"><span>時間</span><label class="sr-only" for="restMinutes">休憩の分</label><input id="restMinutes" type="number" min="0" max="59" required value="'+h(draft.minutes)+'"><span>分</span><button type="submit" class="small-save">保存</button></div><div class="rest-presets" aria-label="休憩時間の候補">'+PRESETS.map(n=>'<button type="button" data-action="preset" data-minutes="'+n+'">'+n+'分</button>').join("")+'</div></form>':'');
}
function readRest(){
 if((!restOpen||!$("restHours"))&&!homeDraft().rest)return record(now.day).breakMinutes;
 const a=restOpen&&$("restHours")?$("restHours").value:homeDraft().rest.hours,b=restOpen&&$("restMinutes")?$("restMinutes").value:homeDraft().rest.minutes;
 if(!/^\d{1,2}$/.test(a)||!/^\d{1,2}$/.test(b)||Number(a)>24||Number(b)>59||Number(a)*60+Number(b)>1440){showError("休憩は0時間00分〜24時間00分で入力してください。");return null;}
 return Number(a)*60+Number(b);
}
function summaryPanel(){
 const fiscalYear=Number(now.day.slice(0,4))-(Number(now.day.slice(5,7))<4?1:0);
 const r=record(now.day),month=C.summary(data,C.month(now.day),now),annual=C.summary(data,{start:fiscalYear+"-04-01",end:(fiscalYear+1)+"-03-31"},now);
 const planned=data.settings.plannedHours,ratio=planned>0?Math.max(0,month.minutes/(planned*60)):0,percent=planned>0?Math.round(ratio*100):null,totalAllocation=C.PROJECTS.reduce((sum,k)=>sum+month.allocation[k],0),today=C.worked(r,now.day,now);
 const remaining=planned-C.hours(month.minutes),leftText=planned<=0?'予定未設定':remaining>=0?'予定まで '+Number(remaining.toFixed(2))+'時間':Number((-remaining).toFixed(2))+'時間 予定を達成';
 return '<section class="detail-panel performance-panel" aria-labelledby="detailTitle"><div class="performance-heading"><h2 id="detailTitle">勤務実績</h2><span>'+now.day.slice(0,4)+' / '+now.day.slice(5,7)+'</span></div><div class="performance-overview"><div class="progress-ring" role="img" aria-label="今月の勤務予定に対して'+(percent==null?'予定未設定':percent+'パーセント')+'"><svg viewBox="0 0 160 160" aria-hidden="true"><circle class="ring-track" cx="80" cy="80" r="64"/><circle id="progressArc" class="ring-progress" cx="80" cy="80" r="64" pathLength="100" stroke-dasharray="100" stroke-dashoffset="'+(100-Math.min(1,ratio)*100)+'"/></svg><div class="ring-label"><span id="monthlyPercent">'+(percent==null?'—':percent)+'<small>'+(percent==null?'':'%')+'</small></span><span>予定に対して</span></div></div><div class="monthly-figure"><span class="performance-eyebrow">今月の勤務時間</span><strong id="monthWorked">'+C.hours(month.minutes)+'<small>時間</small></strong><span class="planned-caption">勤務予定 '+planned+'時間</span><span class="remaining-caption" id="remainingHours">'+leftText+'</span></div></div><dl class="performance-facts"><div><dt>本日の勤務</dt><dd id="todayWorked"'+(today<0?' class="negative-value"':'')+'>'+C.short(today)+'</dd></div><div><dt>今月の勤務日</dt><dd>'+month.days+'<small>日</small></dd></div><div><dt>年度の有給</dt><dd>'+annual.leave+'<small>日</small></dd></div></dl><div class="project-chart-heading"><h3>工数の内訳</h3><span>計 '+Number(totalAllocation.toFixed(2))+'時間</span></div><div class="allocation-strip" aria-hidden="true">'+C.PROJECTS.map((k,i)=>'<span class="project-color-'+i+'" style="width:'+(totalAllocation>0?month.allocation[k]/totalAllocation*100:0)+'%"></span>').join("")+'</div><dl class="project-breakdown">'+C.PROJECTS.map((k,i)=>'<div><dt><i class="project-color-'+i+'" aria-hidden="true"></i>'+k+'</dt><dd>'+Number(month.allocation[k].toFixed(2))+'<small>時間</small></dd><span class="project-mini-track" aria-hidden="true"><i class="project-color-'+i+'" style="width:'+(totalAllocation>0?month.allocation[k]/totalAllocation*100:0)+'%"></i></span></div>').join("")+'</dl></section>';
}
function syncPerformance(){
 if(!$("monthWorked"))return;
 const sum=C.summary(data,C.month(now.day),now),planned=data.settings.plannedHours,ratio=planned>0?Math.max(0,sum.minutes/(planned*60)):0,percent=planned>0?Math.round(ratio*100):null,today=C.worked(record(now.day),now.day,now),remaining=planned-C.hours(sum.minutes);
 $("todayWorked").textContent=C.short(today);$("todayWorked").classList.toggle("negative-value",today<0);
 $("monthWorked").innerHTML=C.hours(sum.minutes)+'<small>時間</small>';
 $("monthlyPercent").innerHTML=(percent==null?'—':percent)+'<small>'+(percent==null?'':'%')+'</small>';
 $("progressArc").setAttribute("stroke-dashoffset",100-Math.min(1,ratio)*100);
 $("progressArc").closest(".progress-ring").setAttribute("aria-label",'今月の勤務予定に対して'+(percent==null?'予定未設定':percent+'パーセント'));
 $("remainingHours").textContent=planned<=0?'予定未設定':remaining>=0?'予定まで '+Number(remaining.toFixed(2))+'時間':Number((-remaining).toFixed(2))+'時間 予定を達成';
}
function leavePanel(){return '<section class="detail-panel" aria-labelledby="detailTitle"><h2 id="detailTitle">休暇の設定</h2><form id="leaveForm"><label class="paper-label" for="leaveType">今日の休暇</label><select id="leaveType" class="paper-input">'+leaveOptions(homeDraft().leave??record(now.day).leave)+'</select><p class="panel-note">全日休暇は打刻を取り消してから設定します。半休は勤務時間と併せて記録できます。</p><button type="submit" class="paper-button">更新</button></form></section>';}
function allocationFields(r,prefix){return '<div class="allocation-grid">'+C.PROJECTS.map(k=>'<label for="'+prefix+k+'"><span>'+k+'</span><input class="paper-input" id="'+prefix+k+'" name="'+k+'" type="number" min="0" max="24" step="any" inputmode="decimal" required value="'+h(prefix==="alloc"?(homeDraft().allocation?.[k]??r.allocation[k]):r.allocation[k])+'"></label>').join("")+'</div>';}
function allocationPanel(){
 const r=record(now.day),total=C.worked(r,now.day,now);
 return '<section class="detail-panel" aria-labelledby="detailTitle"><h2 id="detailTitle">工数の設定</h2><p class="panel-note">'+(total<0?'入力済みの工数は保持しています。出退勤と休憩時間を確認してください。':r.start&&r.end?'勤務時間に合わせて、時間単位で配分してください。':'出勤・退勤を入力してから工数を設定してください。')+'</p><form id="allocationForm">'+allocationFields(r,"alloc")+'<div class="allocation-sum"><span>工数合計 <strong id="allocationTotal">'+C.short(allocationTotal(r))+'</strong></span><span>勤務時間 <strong>'+C.short(total)+'</strong></span></div><div class="paper-actions"><button type="button" class="paper-button secondary" data-action="allocate-rest" '+(!r.end||total<0?'disabled':'')+'>残りをP1へ</button><button type="submit" class="paper-button" '+(!r.end?'disabled':'')+'>更新</button></div></form></section>';
}
function detailPanel(){return detail==="leave"?leavePanel():detail==="allocation"?allocationPanel():summaryPanel();}
function homeOverview(){
 const fiscal=C.fiscalPeriod(now.day),annual=C.summary(data,fiscal,now),missingDays=C.pastMissing(data,now),monthDays=C.monthWorkdays(now.day);
 return '<dl class="home-facts"><div><dt>今期の有給取得</dt><dd id="homePaidLeave">'+annual.leave+'<small>日</small></dd><span>'+fiscal.start.slice(0,4)+'/4〜'+fiscal.end.slice(0,4)+'/3</span></div><div><dt>今月の平日</dt><dd id="homeWorkdays">'+(monthDays==null?'—':monthDays)+'<small>日</small></dd><span>'+(monthDays==null?'祝日データ未収録':'土日・祝日を除く')+'</span></div></dl><div id="homeMissingSlot" class="home-missing-slot" aria-live="polite"><button type="button" id="homeMissingNotice" class="home-missing-notice" data-action="missing-records" '+(missingDays.length?'':'hidden')+'><span class="missing-notice-mark" aria-hidden="true">!</span><span>過去の平日に未入力 <strong>'+missingDays.length+'日</strong></span><span class="missing-notice-link">確認 <span aria-hidden="true">›</span></span></button></div>';
}
function missing(){
 const days=C.pastMissing(data,now),groups=new Map();
 for(const day of days){const key=day.slice(0,7);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(day);}
 return '<section class="subpage missing-page"><button type="button" class="editor-back" data-action="missing-back">← ホームへ</button><h1>過去の未入力</h1><p class="subpage-lede">今日より前の平日で、勤怠の入力が必要な日です。土日祝と、全日休み・全日有休の入力済み日は除いています。</p><div class="missing-page-total"><span>入力が必要な日</span><strong>'+days.length+'<small>日</small></strong></div>'+(days.length?Array.from(groups,([key,list])=>'<section class="missing-month"><h2>'+key.slice(0,4)+'年'+Number(key.slice(5))+'月</h2>'+list.map(day=>'<button type="button" class="missing-day-link" data-action="edit-day" data-day="'+day+'"><span>'+dayLabel(day)+'</span><small>'+ (data.records[day]?.start?'退勤未入力':'未入力')+'</small><span aria-hidden="true">›</span></button>').join('')+'</section>').join(''):'<p class="missing-complete">✓ 過去の平日の未入力はありません。</p>')+'</section>';
}
function week(){
 const start=C.add(now.day,-((C.weekday(now.day)+6)%7)),days=C.dates(start,C.add(start,6)),values=days.map(d=>C.worked(data.records[d],d,now)),max=Math.max(480,...values.map(Math.abs)),total=values.reduce((a,b)=>a+b,0);
 return '<section class="week-section"><div class="week-heading"><h2>今週の記録</h2><span>計 <strong>'+C.short(total)+'</strong></span></div><div class="week-chart">'+days.map((d,i)=>{
  const r=data.records[d],n=values[i],future=d>now.day,label=future?'これから':C.fullLeave(r)?C.LEAVES[r.leave]:r?.start?C.short(n):C.workday(d)?'未入力':'休み';
  return '<button type="button" class="week-day'+(d===now.day?' is-today':'')+'" data-action="edit-day" data-day="'+d+'" '+(future?'disabled':'')+' aria-label="'+dayLabel(d)+' '+label+'"><span class="week-track">'+(n?'<span class="week-bar'+(n<0?' is-negative':'')+'" style="--bar:'+Math.round(Math.abs(n)/max*57)+'px"></span>':'<span class="week-mark">'+(future?'·':C.fullLeave(r)||!C.workday(d)?'—':'○')+'</span>')+'</span><span class="week-value">'+label+'</span><span class="week-date">'+C.WEEK[C.weekday(d)]+' '+Number(d.slice(8))+'</span></button>';
 }).join("")+'</div><p class="week-note">実働・時間:分　日付を選んで記録を確認</p></section>';
}
function home(){
 const r=record(now.day),off=C.fullLeave(r);
 return '<section class="punch-pane"><div class="dayline"><h1>今日の勤怠</h1><strong id="punchState" class="state-tag">'+status(r)+'</strong></div><div id="homeOverview" class="home-overview">'+homeOverview()+'</div><div class="hero-composition"><time class="hero-date" datetime="'+now.day+'">'+dayLabel(now.day)+'<span class="hero-holiday"'+(C.holiday(now.day)?'':' aria-hidden="true"')+'>'+h(C.holiday(now.day))+'</span></time><div class="clock-wrap"><time id="paperClock" class="digital-clock" datetime="'+now.day+'T'+now.full+'+09:00">'+now.time+'<span class="seconds">:'+now.full.slice(-2)+'</span></time><p class="clock-caption">'+(sampleClock?'サンプル時刻':'現在時刻')+'・日本時間'+(sampleClock?' <button type="button" class="clock-live" data-action="live">現在時刻に戻す</button>':'')+'</p></div></div><div id="punchActions" class="punch-actions" aria-label="出退勤の打刻">'+punches()+'</div><div class="time-area"><p id="timeHelp" class="time-help"><strong>時刻は手入力・修正できます</strong><span>自動保存</span></p><div class="time-fields">'+["start","end"].map(k=>'<label for="'+k+'Time"><span>'+ (k==="start"?'出勤':'退勤')+'時刻を'+(r[k]?'編集':'入力')+'</span><input class="time-input" id="'+k+'Time" type="time" value="'+r[k]+'" data-time="'+k+'" aria-describedby="timeHelp" '+(off||k==="end"&&!r.start?'disabled':'')+'></label>').join("")+'</div><label class="nextday"><input id="nextday" type="checkbox" '+(r.overnight?'checked ':'')+(off||!r.start?'disabled':'')+'>翌日に退勤</label></div><div id="restEditor">'+restEditor()+'</div><div class="work-fields"><label class="work-place" for="workPlace"><span>勤務場所</span><select class="paper-input" id="workPlace">'+placeOptions(homeDraft().locationId??r.locationId)+'</select></label><label for="workNote"><span>作業内容</span><textarea class="paper-input" id="workNote" maxlength="1000" rows="2">'+h(homeDraft().note??r.note)+'</textarea></label><div id="workSaveStatus" class="work-save-status" role="status"></div></div></section><nav class="detail-tabs" aria-label="今日の詳細">'+[["summary","chart","勤務実績"],["leave","leave","休暇"],["allocation","work","工数"]].map(([id,ic,label])=>'<button type="button" data-action="detail" data-detail="'+id+'" aria-pressed="'+(detail===id)+'">'+icon(ic)+'<span>'+label+'</span></button>').join("")+'</nav><div id="detailArea">'+detailPanel()+'</div><div id="weekArea">'+week()+'</div>';
}
function monthChooser(){return '<div class="month-chooser"><button type="button" class="month-arrow" data-action="month-prev" aria-label="前の月" '+(selectedMonth<=C.FIRST?'disabled':'')+'>←</button><label><span class="sr-only">表示する月</span><input class="month-input" id="monthInput" type="month" min="2026-04" max="'+now.day.slice(0,7)+'" value="'+selectedMonth.slice(0,7)+'"></label><button type="button" class="month-arrow" data-action="month-next" aria-label="次の月" '+(selectedMonth>=C.month(now.day).start?'disabled':'')+'>→</button></div>';}
function monthChart(){
 const start=C.month(selectedMonth,-6).start<C.FIRST?C.FIRST:C.month(selectedMonth,-6).start,months=Array.from({length:10},(_,i)=>C.month(start,i)),totals=months.map(p=>C.summary(data,p,now).minutes),max=Math.max(60,...totals.map(Math.abs));
 return '<section class="annual-section" aria-labelledby="chartTitle"><h2 id="chartTitle">勤務時間集計</h2><div class="annual-scroll"><div class="annual-chart">'+months.map((p,i)=>'<button type="button" class="month-bar'+(p.start===selectedMonth?' selected':'')+(totals[i]<0?' is-negative':'')+'" data-action="chart-month" data-month="'+p.start+'" aria-label="'+p.start.slice(0,7)+' '+C.hours(totals[i])+'時間" '+(p.start>now.day?'disabled':'')+'><span class="month-bar-track"><span style="height:'+Math.round(Math.abs(totals[i])/max*98)+'px"></span></span><b>'+C.hours(totals[i])+'h</b><small>'+p.start.slice(0,7).replace("-","/")+'</small></button>').join("")+'</div></div><p class="week-note">実働時間・月を選択して一覧を表示</p></section>';
}
function records(){
 const p=C.month(selectedMonth),summary=C.summary(data,p,now);
 const rows=C.dates(p.start,p.end).map(d=>{
  const r=data.records[d],n=C.worked(r,d,now),future=d>now.day,holiday=C.holiday(d),dayStatus=future?'これから':C.fullLeave(r)?C.LEAVES[r.leave]:r?.start?(r.leave?C.LEAVES[r.leave]+' · ':'')+(r.end?'休憩 '+C.short(r.breakMinutes):'退勤未入力'):C.workday(d)?'未入力':'休み';
  const range=r?.start?r.start+' → '+(r.end?(r.overnight?'翌 ':'')+r.end:'—'):C.fullLeave(r)?dayStatus:holiday||dayStatus;
  const caption=r?.start?[holiday,dayStatus,placeName(r.locationId)].filter(Boolean).join(' · '):holiday?(C.fullLeave(r)?holiday:'祝日'):'';
  return '<button type="button" class="record-item paper-record'+(d===now.day?' is-today':'')+(holiday?' is-holiday':'')+'" data-action="edit-day" data-day="'+d+'" '+(future?'disabled':'')+' aria-label="'+h(dayLabel(d)+' '+holiday+' '+range)+'"><span class="record-date weekday-'+C.weekday(d)+'"><b>'+Number(d.slice(8))+'</b><small>'+C.WEEK[C.weekday(d)]+'曜日</small></span><span class="record-times">'+h(range)+'<small>'+h(caption)+'</small></span><span class="record-hours">'+(r?.start?C.short(n):'—')+'<span class="row-chevron" aria-hidden="true">›</span></span></button>';
 }).join("");
 return '<section class="subpage"><h1>'+Number(selectedMonth.slice(5,7))+'月の勤怠</h1><p class="subpage-lede">日付を選んで、打刻・休暇・工数を確認・修正できます。</p>'+monthChooser()+monthChart()+'<div class="month-summary"><span>勤務 '+summary.days+'日</span><strong>計 '+C.short(summary.minutes)+'</strong><button type="button" class="text-button" data-action="export-month">Excel出力</button></div><div class="record-list" id="recordList" aria-label="日別の勤怠">'+rows+'</div><p class="week-note">出勤 → 退勤 ／ 実働時間　未来の日付は編集できません。</p></section>';
}
function submit(){
 const periods=C.periods(selectedMonth);
 return '<section class="subpage"><h1>勤務表の提出</h1><p class="subpage-lede">未入力を確認して、勤務表をまとめます。</p>'+monthChooser()+'<div class="paper-notice"><strong>提出の操作デモ</strong><p>勤務表をExcelでダウンロードし、履歴をこの端末に保存します。メールは送信されません。</p></div><h2 class="paper-heading">'+selectedMonth.slice(0,4)+'年'+Number(selectedMonth.slice(5,7))+'月の提出状況</h2><dl class="submission-status">'+[periods[0],periods[2]].map(p=>'<div><dt>'+p.label+'</dt><dd>'+C.submissionStatus(data,p)+'</dd></div>').join("")+'</dl><label class="test-toggle"><input id="testSubmission" type="checkbox" role="switch" '+(testSubmission?'checked':'')+'><span class="switch-track" aria-hidden="true"></span><span>事前確認送信<span class="toggle-note">オン：テスト提出 ／ オフ：Excel出力</span></span></label><div class="submit-periods">'+periods.map((p,i)=>'<button type="button" class="period-button" data-action="submit-period" data-index="'+i+'"><small>'+p.label+'</small><span>'+Number(p.start.slice(5,7))+'月'+Number(p.start.slice(8))+'日〜'+Number(p.end.slice(5,7))+'月'+(p.end===C.month(p.end).end?'末日':Number(p.end.slice(8))+'日')+'</span><b>勤務表を確認 <span aria-hidden="true">→</span></b></button>').join("")+'</div></section>';
}
function settings(){
 const d=data.defaults,s=settingsDraft||data.settings,p=s.projects[projectIndex],place=s.places[placeIndex];
 let body;
 if(settingsTab==="defaults")body='<section class="settings-section"><h2>初期表示変更</h2><p class="panel-note">新しい日の勤務場所・作業内容・休憩に使います。</p><form id="defaultsForm"><label class="paper-label" for="defaultPlace">作業場所</label><select class="paper-input" id="defaultPlace">'+placeOptions(d.locationId)+'</select><label class="paper-label" for="defaultNote">作業内容</label><textarea class="paper-input" id="defaultNote" maxlength="1000" rows="4">'+h(d.note)+'</textarea><label class="paper-label" for="defaultBreak">休憩時間（分）</label><input class="paper-input" id="defaultBreak" type="number" min="0" max="1440" step="1" required value="'+d.breakMinutes+'"><div class="paper-actions"><button type="button" class="paper-button secondary" data-action="reset-defaults">初期設定</button><button type="submit" class="paper-button">更新</button></div></form><button type="button" class="totals-button" data-action="totals">勤怠時間合計 <span aria-hidden="true">→</span></button></section>';
 else body='<section class="settings-section"><form id="settingsForm"><div class="hours-range"><label for="minHours"><span>基準時間（下限）</span><input id="minHours" class="paper-input" type="number" min="0" max="744" step="any" required value="'+(Number.isFinite(s.minHours)?s.minHours:'')+'"></label><span>〜</span><label for="maxHours"><span>上限</span><input id="maxHours" class="paper-input" type="number" min="0" max="744" step="any" required value="'+(Number.isFinite(s.maxHours)?s.maxHours:'')+'"></label></div><label class="paper-label" for="plannedHours">今月の勤務予定（時間）</label><input class="paper-input" type="number" id="plannedHours" min="0" max="744" step="any" required value="'+(Number.isFinite(s.plannedHours)?s.plannedHours:'')+'"><label class="paper-label" for="workSummary">作業概要</label><textarea class="paper-input" id="workSummary" maxlength="1000" rows="2">'+h(s.workSummary)+'</textarea><div class="master-heading"><label for="projectSelect">PJ選択</label><select class="paper-input" id="projectSelect">'+options(s.projects.map((p,i)=>[String(i),"PJ"+(i+1)]),String(projectIndex))+'</select></div><label class="paper-label" for="projectName">PJ略称</label><input class="paper-input" id="projectName" maxlength="80" required value="'+h(p.name)+'"><label class="paper-label" for="projectDescription">PJ概要</label><textarea class="paper-input" id="projectDescription" maxlength="1000" rows="3">'+h(p.description)+'</textarea><div class="master-heading"><label for="placeSelect">作業場所選択</label><select class="paper-input" id="placeSelect">'+options(s.places.map((p,i)=>[String(i),"場所"+(i+1)]),String(placeIndex))+'</select></div><div class="master-fields"><label for="placeCode"><span>作業場所</span><input class="paper-input" id="placeCode" required maxlength="80" value="'+h(place.code)+'"></label><label for="placeName"><span>作業場所名称</span><input class="paper-input" id="placeName" required maxlength="80" value="'+h(place.name)+'"></label></div><label class="paper-label" for="placeAddress">作業場所住所</label><textarea class="paper-input" id="placeAddress" maxlength="1000" rows="2">'+h(place.address)+'</textarea><button class="paper-button full-width" type="submit">更新</button></form></section>';
 return '<section class="subpage"><h1>設定</h1><p class="subpage-lede">日々の初期値と、勤務表に載せる情報。</p><div class="settings-tabs" aria-label="設定項目">'+[["defaults","アプリ初期値"],["sheet","勤務表設定値"]].map(([id,label])=>'<button type="button" data-action="settings-tab" data-tab="'+id+'" aria-pressed="'+(settingsTab===id)+'">'+label+'</button>').join("")+'</div>'+body+'</section>';
}
function nav(){return '<nav class="app-nav" aria-label="メインナビゲーション">'+[["home","home","ホーム"],["records","calendar","勤怠"],["submit","send","提出"],["settings","settings","設定"]].map(([id,ic,label])=>'<button id="nav-'+id+'" type="button" class="nav-button" data-action="tab" data-tab="'+id+'" '+(view===id||view==="editor"&&id==="records"||view==="missing"&&id==="home"?'aria-current="page"':'')+'>'+icon(ic)+'<span>'+label+'</span></button>').join("")+'</nav>';}
function render(){
 now=clockNow();renderedDay=now.day;
 root.innerHTML='<header class="app-masthead"><button type="button" class="wordmark" data-action="home" aria-label="day. ホーム">day.</button><div class="employee"><b>'+EMPLOYEE.name+'</b>'+EMPLOYEE.department+' / '+EMPLOYEE.id+'</div></header><main class="preview-main"><div id="previewError" class="preview-error" role="alert">'+h(error||storageProblem)+'</div>'+({home,records,submit,settings,editor,missing}[view])()+'<p class="local-data-note">架空の社員の操作デモ · このブラウザに保存</p></main>'+nav();
 if(view==="editor")syncEditor();
 if(embed)root.inert=true;
 if(view==="records"){
  const list=$("recordList"),today=list.querySelector(".is-today");
  if(listPositions.has(selectedMonth))list.scrollTop=listPositions.get(selectedMonth).top;
  else if(today)list.scrollTop=Math.max(0,today.offsetTop-list.offsetTop-today.offsetHeight*2);
 }
 syncWorkStatus();
 syncAllocationTotal();
 document.querySelectorAll("[data-state]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.state===(record(now.day).end?'after':record(now.day).start?'working':'before'))));
}
function syncHome(preserveRest=false){
 if(view!=="home")return;
 const r=record(now.day);
 $("homeOverview").innerHTML=homeOverview();
 $("punchActions").innerHTML=punches();$("punchState").textContent=status(r);
 for(const k of ["start","end"]){const input=$(k+"Time");input.value=r[k];input.disabled=C.fullLeave(r)||k==="end"&&!r.start;input.previousElementSibling.textContent=(k==="start"?'出勤':'退勤')+'時刻を'+(r[k]?'編集':'入力');}
 $("nextday").checked=r.overnight;$("nextday").disabled=C.fullLeave(r)||!r.start;
 if(!preserveRest)$("restEditor").innerHTML=restEditor();$("detailArea").innerHTML=detailPanel();syncAllocationTotal();$("weekArea").innerHTML=week();$("previewError").textContent=error||storageProblem;
}
function openDialog(content){
 error="";dialog.innerHTML=content;dialog.showModal();
}
function dialogError(){return '<p id="dialogError" class="preview-error" role="alert"></p>';}
function closeDialog(){dialog.close();dialog.innerHTML="";error="";}
function dialogHeader(title,caption=""){return '<div class="dialog-heading"><div><h2 id="dialogTitle">'+h(title)+'</h2>'+(caption?'<p>'+h(caption)+'</p>':'')+'</div><button type="button" data-action="close-dialog" class="dialog-close" aria-label="閉じる">×</button></div>';}
function openEditor(day){
 now=clockNow();if(!C.validDay(day)||day<C.FIRST||day>now.day)return;
 const sameView=view==="editor";rememberList();
 if(sameView)captureEditor();else editorReturn=view;
 editDay=day;view="editor";error="";render();rememberRoute(sameView);root.scrollIntoView({block:"start"});
}
const breakText=n=>C.pad(Math.floor(n/60))+":"+C.pad(n%60);
function parseEditorBreak(text){
 const match=/^(\d{1,2}):([0-5]\d)$/.exec(text.trim());if(!match)return null;
 const minutes=Number(match[1])*60+Number(match[2]);return minutes<=1440?minutes:null;
}
function readEditor(){return {record:{start:$("editStart").value,end:$("editEnd").value,overnight:$("editOvernight").checked,breakMinutes:parseEditorBreak($("editBreak").value),locationId:$("editPlace").value,note:$("editNote").value,leave:$("editLeave").value,allocation:Object.fromEntries(C.PROJECTS.map(k=>[k,Number($("editAlloc"+k).value)]))},breakText:$("editBreak").value};}
function captureEditor(){if(view==="editor"&&$("dayForm"))editorDrafts.set(editDay,readEditor());}
function editor(){
 const draft=editorDrafts.get(editDay),r=draft?.record||record(editDay),rest=draft?.breakText??breakText(r.breakMinutes),backLabel={records:"勤怠一覧へ",home:"ホームへ",submit:"提出画面へ",missing:"未入力一覧へ"}[editorReturn]||"勤怠一覧へ";
 const fullDate=editDay.slice(0,4)+"年"+Number(editDay.slice(5,7))+"月"+Number(editDay.slice(8))+"日（"+C.WEEK[C.weekday(editDay)]+"）";
 const presets=[0,15,30,45,60,75,90,105,120,150,180,240,300,360,480,720,1440];
 return '<section class="subpage day-editor"><div class="editor-title"><button type="button" class="editor-back" data-action="editor-back">← '+backLabel+'</button><span>更新で保存</span></div><h1>勤怠の編集</h1><div class="editor-date-switcher"><button type="button" class="month-arrow" data-action="editor-prev" aria-label="前の日" '+(editDay<=C.FIRST?'disabled':'')+'>←</button><label class="editor-date-picker" for="editDate"><span>'+fullDate+'</span>'+icon('calendar')+'<input id="editDate" type="date" min="'+C.FIRST+'" max="'+now.day+'" value="'+editDay+'" aria-label="編集する日付"></label><button type="button" class="month-arrow" data-action="editor-next" aria-label="次の日" '+(editDay>=now.day?'disabled':'')+'>→</button></div><p class="editor-holiday-name"'+(C.holiday(editDay)?'':' aria-hidden="true"')+'>'+h(C.holiday(editDay))+'</p><form id="dayForm"><div class="editor-fields"><label for="editStart">出社時間<small>hh:mm</small></label><input class="time-input" id="editStart" type="time" value="'+r.start+'"><label for="editEnd">退社時間<small>hh:mm</small></label><div><input class="time-input" id="editEnd" type="time" value="'+r.end+'"><label class="nextday"><input id="editOvernight" type="checkbox" '+(r.overnight?'checked':'')+'>翌日に退勤</label></div><label for="editBreak">休憩時間<small>hh:mm</small></label><div><input class="paper-input editor-break-input" id="editBreak" type="text" inputmode="text" value="'+h(rest)+'" list="editorBreaks" placeholder="01:00" maxlength="5" required aria-label="休憩時間、時間と分"><datalist id="editorBreaks">'+presets.map(n=>'<option value="'+breakText(n)+'"></option>').join('')+'</datalist></div><span class="editor-field-label" id="workedLabel">勤務時間</span><output id="editWorked" class="editor-worked" aria-labelledby="workedLabel">—</output><label for="editLeave">休日設定</label><select class="paper-input" id="editLeave">'+leaveOptions(r.leave)+'</select><label for="editPlace">勤務場所</label><select class="paper-input" id="editPlace">'+placeOptions(r.locationId)+'</select><label for="editNote">作業内容</label><textarea class="paper-input" id="editNote" maxlength="1000" rows="2">'+h(r.note)+'</textarea></div><div class="editor-allocation-heading"><h2>工数の振り分け</h2><span>時間単位</span></div><p id="allocationState" class="editor-allocation-state" role="status"></p><div class="editor-allocation">'+C.PROJECTS.map(k=>'<label for="editAlloc'+k+'"><span>'+k+'</span><input class="paper-input" id="editAlloc'+k+'" name="'+k+'" type="number" min="0" max="24" step="any" inputmode="decimal" required value="'+r.allocation[k]+'"></label>').join('')+'<button class="paper-button editor-update" type="submit">更新</button></div><button type="button" class="editor-clear" data-action="clear-day">この日を未入力に戻す</button></form></section>';
}
function syncEditor(){
 if(!$("dayForm"))return;
 const r=readEditor().record,total=r.breakMinutes==null?null:C.worked(r,editDay,clockNow()),allocated=allocationTotal(r),complete=!!r.start&&!!r.end&&total!=null&&total>=0&&allocated===total;
 $("editWorked").innerHTML=total==null?'—':C.hours(total)+'<small>時間</small>';
 $("editWorked").classList.toggle("negative-value",total<0);
 const validAllocation=C.PROJECTS.every(k=>$("editAlloc"+k).value.trim()!==""&&$("editAlloc"+k).validity.valid);
 $("allocationState").textContent=!validAllocation?'工数を0〜24時間で入力してください':r.breakMinutes==null?'休憩を hh:mm で入力してください':!r.start||!r.end?'出社・退社時間を入力してください':total<0?'入力済みの工数は保持します':complete?'✓ 振り分け完了':allocated<total?'あと '+C.duration(total-allocated)+'を振り分け':C.duration(allocated-total)+' 超過しています';
 $("allocationState").classList.toggle("is-complete",complete&&validAllocation);
}
function syncWorkStatus(){
 const node=$("workSaveStatus");if(!node)return;
 const dirty=homeDraft().note!=null||homeDraft().locationId!=null;
 node.innerHTML=dirty?'<span>勤務内容が未保存です</span><button type="button" class="text-button" data-action="retry-work">再保存</button>':'<span>勤務内容は自動保存</span>';
}
function syncAllocationTotal(){if(!$("allocationForm"))return;const inputs=C.PROJECTS.map(k=>$("alloc"+k)),total=inputs.reduce((n,input)=>n+Math.round(Number(input.value)*60),0);$("allocationTotal").textContent=inputs.every(input=>input.value.trim()!==""&&input.validity.valid)?C.short(total):'—';}
function openSubmission(period){
 submitPeriod=period;now=clockNow();const missing=C.missing(data,period,now),summary=C.summary(data,period,now);
 const list=missing.length?'<h3 class="paper-heading">以下の勤怠が未入力です <small>'+missing.length+'日</small></h3><div class="missing-list">'+missing.map(day=>'<button type="button" data-action="missing-day" data-day="'+day+'"><span>'+day.replaceAll("-","/")+'（'+C.WEEK[C.weekday(day)]+'）</span><span aria-hidden="true">›</span></button>').join("")+'</div>':'<p class="complete-message">対象期間の勤怠はすべて入力済みです。</p>';
 openDialog(dialogHeader('勤務表の確認',periodLabel(period))+'<p class="submission-total">勤務 '+summary.days+'日 ／ '+C.duration(summary.minutes)+'</p>'+list+'<p class="panel-note">今日までの平日の未入力と、退勤の未入力を確認します。未入力のままでも出力できます。</p><div class="paper-notice"><strong>'+(testSubmission?'テスト提出です。':'Excelを出力します。')+'</strong><p>メールは送信されません。'+(testSubmission?'テスト提出の履歴をこの端末に保存します。':'出力の履歴をこの端末に保存します。')+'</p></div>'+dialogError()+'<div class="paper-actions"><button type="button" class="paper-button secondary" data-action="close-dialog">閉じる</button><button type="button" class="paper-button" data-action="confirm-submission">'+(testSubmission?'テスト提出':'Excel出力')+'</button></div>');
}
function download(bytes,name){
 const blob=new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),url=URL.createObjectURL(blob),link=document.createElement("a");
 link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function exportPeriod(period,mark=false){
 now=clockNow();
 try{
  const bytes=C.workbook(data,period,now),candidate=C.clone(data);
  download(bytes,'day_'+period.start+'_'+period.end+'.xlsx');
  if(mark){candidate.submissions[C.periodKey(period)]={at:new Date().toISOString(),test:testSubmission};if(!commit(candidate)){showError("Excelのダウンロードは開始しましたが、履歴を保存できませんでした。"+error);return;}}
  rememberList();
  if(dialog.open)closeDialog();render();toast(mark?'勤務表の出力操作と'+(testSubmission?'テスト提出':'出力')+'履歴を記録しました':'勤務表のダウンロードを開始しました');
 }catch{showError("勤務表を出力できませんでした。もう一度お試しください。");}
}
function captureSettings(){
 if(!$("settingsForm"))return;
 settingsDraft=settingsDraft||C.clone(data.settings);
 Object.assign(settingsDraft,{minHours:$("minHours").value.trim()===""?NaN:Number($("minHours").value),maxHours:$("maxHours").value.trim()===""?NaN:Number($("maxHours").value),plannedHours:$("plannedHours").value.trim()===""?NaN:Number($("plannedHours").value),workSummary:$("workSummary").value});
 Object.assign(settingsDraft.projects[projectIndex],{name:$("projectName").value,description:$("projectDescription").value});
 Object.assign(settingsDraft.places[placeIndex],{code:$("placeCode").value,name:$("placeName").value,address:$("placeAddress").value});
}
function sample(mode){
 const clocks={before:"08:57:16",working:"14:35:08",after:"18:04:12"},r=C.empty(data);
 if(!Object.hasOwn(clocks,mode))return;
 if(mode!=="before")r.start="09:10";
 if(mode==="after")r.end="18:02";
 const previous=sampleClock;sampleClock=clocks[mode];now=clockNow();
 if(saveRecord(now.day,r,'今日の'+{before:'出勤前',working:'勤務中',after:'退勤後'}[mode]+'サンプルに切り替えました')){restOpen=false;view="home";render();}
 else{sampleClock=previous;now=clockNow();}
}
function changeMonth(offset){rememberList();selectedMonth=C.month(selectedMonth,offset).start;error="";render();rememberRoute(true);}
document.addEventListener("click",event=>{
 if(embed)return;
 if((event.target.matches?.(".time-input")||event.target.id==="editDate")&&!event.target.disabled){try{event.target.showPicker?.();}catch{}return;}
 const button=event.target.closest?.("[data-action],[data-state]");if(!button||button.disabled)return;
 if(button.dataset.state){sample(button.dataset.state);return;}
 const action=button.dataset.action;
 if(action==="missing-records"){view="missing";error="";render();rememberRoute();root.scrollIntoView({block:"start"});return;}
 if(action==="missing-back"){history.back();return;}
 if(action==="tab"||action==="home"){
  const previous=view;rememberList();if(view==="settings")captureSettings();if(view==="editor"){captureEditor();if(button.dataset.tab==="records")selectedMonth=C.month(editDay).start;}view=action==="home"?'home':button.dataset.tab;error="";restOpen=false;render();rememberRoute(previous===view);restorePosition();return;
 }
 if(action==="editor-prev"||action==="editor-next"){openEditor(C.add(editDay,action==="editor-prev"?-1:1));return;}
 if(action==="editor-back"){captureEditor();history.back();return;}
 if(action==="retry-work"){
  if(updateToday({note:$("workNote").value,locationId:$("workPlace").value},'勤務内容を保存しました')){clearHomeDraft("note","locationId");syncWorkStatus();}return;
 }
 if(action==="punch"){
  if(Date.now()<lockUntil)return;
  const kind=button.dataset.kind,r=record(now.day),rest=readRest();if(rest==null)return;
  if(kind==="end"&&!r.start)return showError("先に出勤を記録してください。");
  const current=clockNow();if(updateToday({[kind]:current.time,breakMinutes:rest,overnight:kind==="end"?false:r.overnight},(kind==="start"?'出勤':'退勤')+'を'+current.time+'で記録しました')){clearHomeDraft("rest");restOpen=false;animatePunch(kind);lockPunches(850);syncHome();}return;
 }
 if(action==="reset-punches"){
  if(Date.now()<lockUntil)return;
  if(updateToday({start:"",end:"",overnight:false,allocation:Object.fromEntries(C.PROJECTS.map(k=>[k,0]))},'出勤・退勤と工数を取り消しました')){lockPunches();syncHome(true);}return;
 }
 if(action==="reset"){sample('before');return;}
 if(action==="live"){sampleClock="";render();return;}
 if(action==="rest"){if(restOpen)clearHomeDraft("rest");restOpen=!restOpen;$("restEditor").innerHTML=restEditor();return;}
 if(action==="preset"){$("restHours").value=Math.floor(Number(button.dataset.minutes)/60);$("restMinutes").value=Number(button.dataset.minutes)%60;setHomeDraft("rest",{hours:$("restHours").value,minutes:$("restMinutes").value});return;}
 if(action==="detail"){detail=button.dataset.detail;error="";$("detailArea").innerHTML=detailPanel();syncAllocationTotal();document.querySelectorAll("[data-detail]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.detail===detail)));$("previewError").textContent="";return;}
 if(action==="allocate-rest"){
  const total=C.worked(record(now.day),now.day,now),other=C.PROJECTS.slice(1).reduce((n,k)=>n+Math.round(Number($("alloc"+k).value)*60),0);
  if(other>total)return showError("P2〜SETの合計が勤務時間を超えています。");
  $("allocP1").value=Number(((total-other)/60).toFixed(8));setHomeDraft("allocation",Object.fromEntries(C.PROJECTS.map(k=>[k,$("alloc"+k).value])));syncAllocationTotal();return;
 }
 if(action==="month-prev"){changeMonth(-1);return;}
 if(action==="month-next"){changeMonth(1);return;}
 if(action==="chart-month"){rememberList();selectedMonth=button.dataset.month;render();rememberRoute(true);return;}
 if(action==="edit-day"){openEditor(button.dataset.day);return;}
 if(action==="close-dialog"){closeDialog();return;}
 if(action==="clear-day"){
  const next=C.clone(data);delete next.records[editDay];C.invalidateSubmissions(next,editDay);
  if(commit(next,'この日を未入力に戻しました')){editorDrafts.delete(editDay);homeDrafts.delete(editDay);render();}return;
 }
 if(action==="export-month"){exportPeriod(C.month(selectedMonth));return;}
 if(action==="submit-period"){openSubmission(C.periods(selectedMonth)[Number(button.dataset.index)]);return;}
 if(action==="confirm-submission"){exportPeriod(submitPeriod,true);return;}
 if(action==="missing-day"){const day=button.dataset.day;closeDialog();openEditor(day);return;}
 if(action==="settings-tab"){captureSettings();settingsTab=button.dataset.tab;error="";render();return;}
 if(action==="reset-defaults"){
  const next=C.clone(data);next.defaults=C.seed(now).defaults;
  if(commit(next,'初期値を標準に戻しました'))render();return;
 }
 if(action==="totals"){
  const month=C.month(now.day),sum=C.summary(data,month,now);
  openDialog(dialogHeader('勤怠時間合計',periodLabel(month))+'<dl class="summary-lines"><div><dt>勤務時間合計</dt><dd>'+C.duration(sum.minutes)+'</dd></div><div><dt>勤務日数</dt><dd>'+sum.days+'日</dd></div>'+C.PROJECTS.map(k=>'<div><dt>'+k+'</dt><dd>'+Number(sum.allocation[k].toFixed(2))+'時間</dd></div>').join("")+'</dl><button type="button" class="paper-button full-width" data-action="close-dialog">閉じる</button>');
 }
});
document.addEventListener("change",event=>{
 if(embed)return;const input=event.target;
 if(input.id==="editDate"){
  if(C.validDay(input.value)&&input.value>=C.FIRST&&input.value<=clockNow().day)openEditor(input.value);else{input.value=editDay;toast("今日までの日付を選んでください。",{warning:true});}return;
 }
 if(input.closest?.("#dayForm")){syncEditor();captureEditor();return;}
 if(input.id==="leaveType"){setHomeDraft("leave",input.value);return;}
 if(input.dataset.time){
  const kind=input.dataset.time,r=record(now.day),rest=readRest();
  if(!input.value){input.value=r[kind];return showError("時刻を入力してください。取消は「取消」ボタンで行えます。");}
  if(rest==null){input.value=r[kind];return;}
  if(updateToday({[kind]:input.value,breakMinutes:rest,overnight:$("nextday").checked},'時刻を保存しました')){clearHomeDraft("rest");restOpen=false;lockPunches(250);syncHome();}else input.value=r[kind];return;
 }
 if(input.id==="nextday"){
  const r=record(now.day);if(updateToday({overnight:input.checked},'退勤日の設定を保存しました'))syncHome();else input.checked=r.overnight;return;
 }
 if(input.id==="workPlace"||input.id==="workNote"){
  const key=input.id==="workPlace"?'locationId':'note';setHomeDraft(key,input.value);if(updateToday({[key]:input.value},'勤務内容を保存しました'))clearHomeDraft(key);syncWorkStatus();return;
 }
 if(input.id==="monthInput"){
  const day=input.value+'-01';if(C.validDay(day)&&day>=C.FIRST&&day<=now.day){rememberList();selectedMonth=day;render();rememberRoute(true);}else{input.value=selectedMonth.slice(0,7);showError("表示できる月を選んでください。");}return;
 }
 if(input.id==="testSubmission"){testSubmission=input.checked;return;}
 if(input.id==="projectSelect"||input.id==="placeSelect"){
  captureSettings();if(input.id==="projectSelect")projectIndex=Number(input.value);else placeIndex=Number(input.value);render();return;
 }
});
document.addEventListener("input",event=>{
 if(event.target.id==="workNote"){setHomeDraft("note",event.target.value);syncWorkStatus();return;}
 if(event.target.id==="restHours"||event.target.id==="restMinutes"){setHomeDraft("rest",{hours:$("restHours").value,minutes:$("restMinutes").value});return;}
 if(event.target.closest?.("#dayForm")){syncEditor();captureEditor();return;}
 if(event.target.closest?.("#allocationForm")){
  setHomeDraft("allocation",Object.fromEntries(C.PROJECTS.map(k=>[k,$("alloc"+k).value])));syncAllocationTotal();
 }
});
document.addEventListener("submit",event=>{
 if(embed)return;event.preventDefault();const id=event.target.id;
 if(id==="restForm"){
  const total=readRest();if(total==null)return;if(updateToday({breakMinutes:total},'休憩時間を保存しました')){clearHomeDraft("rest");restOpen=false;syncHome();}return;
 }
 if(id==="leaveForm"){if(updateToday({leave:$("leaveType").value},'休暇設定を保存しました')){clearHomeDraft("leave");syncHome();}return;}
 if(id==="allocationForm"){
  const allocation=Object.fromEntries(C.PROJECTS.map(k=>[k,Number($("alloc"+k).value)]));
  if(updateToday({allocation},'工数を保存しました')){clearHomeDraft("allocation");syncHome();}return;
 }
 if(id==="dayForm"){
  now=clockNow();const r=readEditor().record;
  if(r.breakMinutes==null)return showError("休憩時間は 01:00 のように、0:00〜24:00で入力してください。");
  if(saveRecord(editDay,r,'勤怠を更新しました')){editorDrafts.delete(editDay);homeDrafts.delete(editDay);render();}return;
 }
 if(id==="defaultsForm"){
  const next=C.clone(data),d={locationId:$("defaultPlace").value,note:$("defaultNote").value,breakMinutes:Number($("defaultBreak").value)};
  if(!Number.isInteger(d.breakMinutes)||d.breakMinutes<0||d.breakMinutes>1440)return showError("休憩は0〜1440分の整数で入力してください。");
  next.defaults=d;if(commit(next,'新しい日の初期値を更新しました'))render();return;
 }
 if(id==="settingsForm"){
  captureSettings();const issue=C.validateSettings(settingsDraft);if(issue)return showError(issue);
  const next=C.clone(data);next.settings=C.clone(settingsDraft);next.submissions={};
  if(commit(next,'勤務表設定を更新しました')){settingsDraft=null;render();}
 }
});
dialog.addEventListener("close",()=>{if(!dialog.open)error="";});
window.addEventListener("storage",event=>{
 if(event.key!==C.KEY)return;
 showError("別の画面で記録が更新されました。再読み込みして最新の記録を確認してください。");
});
window.addEventListener("popstate",event=>{
 const route=event.state;if(!route?.paper)return;
 rememberList();captureEditor();if(view==="settings")captureSettings();if(dialog.open)closeDialog();
 view=["home","records","submit","settings","editor","missing"].includes(route.view)?route.view:"home";
 selectedMonth=route.month||C.month(clockNow().day).start;editDay=route.day||"";editorReturn=route.origin||"records";
 if(view==="editor"&&(!C.validDay(editDay)||editDay<C.FIRST||editDay>clockNow().day))view="records";
 restOpen=false;error="";render();restorePosition();
});
function tick(){
 const current=clockNow(),newDay=current.day!==now.day;now=current;
 if(newDay){sampleClock="";if(!dialog.open&&view==="home")render();return;}
 if(view!=="home")return;
 const node=$("paperClock");if(node){node.innerHTML=now.time+'<span class="seconds">:'+now.full.slice(-2)+'</span>';node.dateTime=now.day+'T'+now.full+'+09:00';}
 if(detail==="summary")syncPerformance();
 const minute=now.day+now.time;if(lastMinute!==minute){lastMinute=minute;if($("weekArea"))$("weekArea").innerHTML=week();}
}
setInterval(tick,1000);document.addEventListener("visibilitychange",()=>{if(!document.hidden)tick();});
render();rememberRoute(true);
})();
