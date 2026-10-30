(function(global){
"use strict";
const VERSION=1,KEY="day-paper-attendance-v1",FIRST="2026-04-01";
const PROJECTS=["P1","P2","P3","P4","SET"],PROJECT_IDS=PROJECTS,WEEK=["日","月","火","水","木","金","土"];
const PHASES=[{id:"requirements",label:"要件定義"},{id:"design",label:"設計"},{id:"implementation",label:"製造"},{id:"test",label:"テスト"},{id:"operations",label:"運用"},{id:"maintenance",label:"保守"},{id:"investigation",label:"調査"},{id:"meeting",label:"管理"}],PHASE_IDS=PHASES.map(phase=>phase.id);
const LEAVES={"":"休暇なし",paid:"有給休暇",am:"午前半休",pm:"午後半休",holiday:"公休",special:"特別休暇",comp:"代休"};
const LEAVE_REQUEST_FIELDS=["id","day","leave","sourceDay","requestedAt"],LEAVE_RECEIPT_FIELDS=[...LEAVE_REQUEST_FIELDS,"delivery"];
const validRequestId=value=>typeof value==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(value)&&!["__proto__","constructor","prototype"].includes(value);
const exactObject=(value,keys)=>!!value&&typeof value==="object"&&!Array.isArray(value)&&Object.prototype.toString.call(value)==="[object Object]"&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)&&Object.prototype.propertyIsEnumerable.call(value,key));
const DEMO_EMPLOYEE={name:"田中 花子",department:"営業",id:"E001"},EMPLOYEE_FIELDS=["name","department","id"];
const pad=n=>String(n).padStart(2,"0"),clone=value=>JSON.parse(JSON.stringify(value));
const iso=d=>d.toISOString().slice(0,10),date=day=>new Date(day+"T00:00:00Z");
const validDay=day=>/^\d{4}-\d{2}-\d{2}$/.test(day||"")&&Number.isFinite(+date(day))&&iso(date(day))===day;
const firstDay=state=>state?.settings?.attendanceStartDay||FIRST;
const isDemo=state=>state?.mode!=="local";
function employee(state){
 const saved=state?.settings?.employee;
 return Object.fromEntries(EMPLOYEE_FIELDS.map(key=>[key,typeof saved?.[key]==="string"?saved[key]:isDemo(state)?DEMO_EMPLOYEE[key]:""]));
}
const add=(day,n)=>{const d=date(day);d.setUTCDate(d.getUTCDate()+n);return iso(d);};
const weekday=day=>date(day).getUTCDay();
const calendar=global.PaperHolidays||{start:"",end:"",days:{}};
const holidayKnown=day=>validDay(day)&&day>=calendar.start&&day<=calendar.end;
const holiday=day=>calendar.days[day]||"";
// null is an unpublished calendar date, rather than an invented business day.
const workday=day=>weekday(day)>0&&weekday(day)<6?(holidayKnown(day)?!holiday(day):null):false;
function dates(start,end){const out=[];for(let d=start;d<=end&&out.length<400;d=add(d,1))out.push(d);return out;}
function month(day,offset=0){const d=date(day),y=d.getUTCFullYear(),m=d.getUTCMonth()+offset;return {start:iso(new Date(Date.UTC(y,m,1))),end:iso(new Date(Date.UTC(y,m+1,0)))};}
function monthWorkdays(day){const p=month(day);return holidayKnown(p.start)&&holidayKnown(p.end)?dates(p.start,p.end).filter(d=>workday(d)).length:null;}
function plannedHours(settings,day){
 if(!validDay(day))return null;
 const overrides=settings?.plannedHoursByMonth,key=day.slice(0,7);
 if(overrides&&Object.hasOwn(overrides,key))return overrides[key];
 const days=monthWorkdays(day);return days===null?null:days*8;
}
function fiscalPeriod(day){const year=Number(day.slice(0,4))-(Number(day.slice(5,7))<4?1:0);return {start:year+"-04-01",end:(year+1)+"-03-31"};}
function periods(day){
 const m=month(day),prev=month(day,-1);
 return [{start:prev.start.slice(0,8)+"16",end:m.start.slice(0,8)+"15",label:"15日締め"},{...prev,label:"前月末締め"},{...m,label:"月末締め"}];
}
const periodKey=p=>p.start+"|"+p.end;
const formatter=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
function clock(instant=new Date()){
 const p=Object.fromEntries(formatter.formatToParts(instant).map(v=>[v.type,v.value]));
 const day=p.year+"-"+p.month+"-"+p.day,time=pad(Number(p.hour)%24)+":"+p.minute;
 return {day,time,full:time+":"+p.second,minutes:timeToMin(time)};
}
function timeToMin(v){if(!/^\d{2}:\d{2}$/.test(v||""))return null;const [h,m]=v.split(":").map(Number);return h<24&&m<60?h*60+m:null;}
const time=n=>pad(Math.floor(n/60)%24)+":"+pad(n%60);
const short=n=>(n<0?"−":"")+Math.floor(Math.abs(n)/60)+":"+pad(Math.round(Math.abs(n))%60);
const duration=n=>(n<0?"−":"")+Math.floor(Math.abs(n)/60)+"時間"+pad(Math.round(Math.abs(n))%60)+"分";
const hours=n=>Number((n/60).toFixed(2));
const fullLeave=r=>["paid","holiday","special","comp"].includes(r?.leave);
const validPhases=value=>Array.isArray(value)&&value.length<=PHASE_IDS.length&&Array.from(value).every(id=>PHASE_IDS.includes(id))&&new Set(value).size===value.length;
const restDay=day=>validDay(day)&&(weekday(day)===0||weekday(day)===6||holidayKnown(day)&&!!holiday(day));
function worked(r,day,now){
 if(!r||fullLeave(r)||timeToMin(r.start)==null)return 0;
 const end=r.end?timeToMin(r.end)+(r.overnight?1440:0):day===now.day?now.minutes:null;
 const net=end==null?0:end-timeToMin(r.start)-r.breakMinutes;
 return r.end?net:Math.max(0,net);
}
function absenceMinutes(r,day,now){
 // Unentered or unfinished days stay in the missing-record flow; only completed work contributes.
 if(!r||!validDay(day)||!validDay(now?.day)||day>now.day||workday(day)!==true||fullLeave(r))return 0;
 const start=timeToMin(r.start),end=timeToMin(r.end);
 if(start==null||end==null||!Number.isInteger(r.breakMinutes)||r.breakMinutes<0||r.breakMinutes>1440)return 0;
 const span=end+(r.overnight?1440:0)-start;if(span<0)return 0;
 const credit=["am","pm"].includes(r.leave)?240:0;
 return Math.max(0,480-credit-Math.max(0,span-r.breakMinutes));
}
function empty(state){return {start:"",end:"",overnight:false,breakMinutes:state.defaults.breakMinutes,locationId:state.defaults.locationId,note:state.defaults.note,phases:clone(state.defaults.phases||[]),leave:"",sourceDay:"",allocation:Object.fromEntries(PROJECTS.map(k=>[k,0]))};}
function changeLeave(record,leave,day,now){
 const next={...clone(record),...(fullLeave(record)?{start:'',end:'',overnight:false}:{}),leave,sourceDay:leave==='comp'?(record.sourceDay||''):''};
 if(fullLeave(next)){Object.assign(next,{start:"",end:"",overnight:false,allocation:Object.fromEntries(PROJECTS.map(k=>[k,0]))});delete next.legacyProjectAllocation;}
 else if(fullLeave(record))return allocateToP1(next,day,now);
 return next;
}
const phaseText=record=>PHASES.filter(phase=>Array.isArray(record?.phases)&&record.phases.includes(phase.id)).map(phase=>phase.label).join("・");
const validAllocationHours=value=>Number.isFinite(value)&&value>=0&&value<=24&&Math.abs(value*60-Math.round(value*60))<=1e-5;
function legacyAllocationSource(record){
 const source=record?.legacyProjectAllocation,value=record?.allocation?.SET;
 return !!source&&typeof source==="object"&&!Array.isArray(source)&&Object.keys(source).length===2&&Object.hasOwn(source,"P5")&&Object.hasOwn(source,"SET")&&validAllocationHours(source.P5)&&validAllocationHours(source.SET)&&Number.isFinite(value)&&value>24&&value<=48&&Math.abs(value*60-Math.round(value*60))<=1e-5&&Math.round(value*60)===Math.round(source.P5*60)+Math.round(source.SET*60);
}
function allocationMax(record,key){return key==="SET"&&legacyAllocationSource(record)?48:24;}
function validateRecord(r,day,now,settings,options={}){
 const bad=error=>({ok:false,error});
 const first=settings?.attendanceStartDay||FIRST;
 if(!validDay(day)||day<first||day>now.day)return bad("今日までの日付を選んでください。");
 if(!r||typeof r.start!=="string"||typeof r.end!=="string"||typeof r.overnight!=="boolean")return bad("時刻を確認してください。");
 if(!Object.hasOwn(LEAVES,r.leave))return bad("休暇区分を選んでください。");
 if(r.sourceDay!==undefined&&(typeof r.sourceDay!=="string"||r.sourceDay&&(!validDay(r.sourceDay)||r.sourceDay<first)))return bad("代休元の休日出勤日を確認してください。");
 if(!Number.isInteger(r.breakMinutes)||r.breakMinutes<0||r.breakMinutes>1440)return bad("休憩時間は0〜1440分で入力してください。");
 if(typeof r.note!=="string"||r.note.length>1000)return bad("作業内容は1000文字以内で入力してください。");
 if(Object.hasOwn(r,"phases")&&!validPhases(r.phases))return bad("フェーズは表示されている項目から、重複せず選んでください。");
 if(!settings.places.some(p=>p.id===r.locationId))return bad("勤務場所を選んでください。");
 if(r.start&&timeToMin(r.start)==null||r.end&&timeToMin(r.end)==null)return bad("出勤・退勤時刻を確認してください。");
 if(!fullLeave(r)&&r.end&&!r.start)return bad("先に出勤時刻を入力してください。");
 if(!fullLeave(r)&&r.start&&!r.end&&day===now.day&&timeToMin(r.start)>now.minutes)return bad("出勤時刻は現在時刻より前にしてください。");
 if(!fullLeave(r)&&r.start&&r.end){
  const span=timeToMin(r.end)+(r.overnight?1440:0)-timeToMin(r.start);
  if(span<0)return bad("翌日の退勤は「翌日に退勤」を選んでください。");
 }
 if(r.legacyProjectAllocation!==undefined&&!legacyAllocationSource(r))return bad("統合前の工数の保存情報を確認してください。");
 if(!r.allocation||Object.hasOwn(r.allocation,"P5")||PROJECTS.some(k=>!Number.isFinite(r.allocation[k])||r.allocation[k]<0||r.allocation[k]>allocationMax(r,k)||Math.abs(r.allocation[k]*60-Math.round(r.allocation[k]*60))>1e-5))return bad("工数は0〜24時間で、分単位で入力してください。");
 const allocated=PROJECTS.reduce((sum,k)=>sum+Math.round(r.allocation[k]*60),0);
 if(fullLeave(r)&&allocated)return bad("全日休暇の実働と工数は0時間です。工数を0時間にしてください。");
 if(allocated&&!r.start)return bad("工数は出勤時刻を入力してから設定してください。");
 const net=worked(r,day,now),complete=!!r.start&&!!r.end;
 if(options.strictAllocation&&complete&&net>=0&&allocated!==net)return bad("勤務時間（"+duration(net)+"）と工数合計（"+duration(allocated)+"）を一致させてください。");
 const warnings=!complete?[]:net<0?["休憩時間を引いた勤務時間が「"+duration(net)+"」になっています。記録は保存しました。出退勤と休憩時間を確認してください。"+(allocated?" 工数は入力済みの値を保持しています。":"")]:allocated&&allocated!==net?["勤務時間（"+duration(net)+"）と工数合計（"+duration(allocated)+"）が一致していません。記録は保存しました。工数の振り分けを確認してください。"]:[];
 const absence=net>=0?absenceMinutes(r,day,now):0;
 if(absence)warnings.push((["am","pm"].includes(r.leave)?"半休4時間分を含めても、":"実働が")+"1日8時間に"+duration(absence)+"不足しています。欠勤時間として集計します。");
 return {ok:true,value:{...clone(r),...(fullLeave(r)?{start:"",end:"",overnight:false}:{}),phases:clone(r.phases||[])},warnings};
}
function eligibleCompSource(state,sourceDay,day,now){
 if(!validDay(sourceDay)||sourceDay<firstDay(state)||sourceDay>=day||sourceDay>now.day||!restDay(sourceDay))return false;
 const r=state.records[sourceDay];
 return !!r?.start&&!!r.end&&!fullLeave(r)&&validateRecord(r,sourceDay,now,state.settings).ok&&worked(r,sourceDay,now)>0;
}
function compLinkError(state,day,r,now){
 if(!r?.sourceDay)return "代休元の休日出勤日を選んでください。";
 if(!eligibleCompSource(state,r.sourceDay,day,now))return "代休元は、代休日より前の土日・祝日に出退勤を記録した、実働がプラスの日を選んでください。";
 const used=Object.entries(state.records).find(([d,other])=>d!==day&&other?.leave==="comp"&&other.sourceDay===r.sourceDay);
 return used?r.sourceDay+"は"+used[0]+"の代休に使用済みです。1日の休日出勤に対して代休は1日だけ登録できます。":"";
}
function compSources(state,day,now){
 if(!state?.records||!Array.isArray(state.settings?.places)||!validDay(day)||day<firstDay(state)||!now||!validDay(now.day)||day>now.day)return [];
 const used=new Set(Object.entries(state.records).filter(([d,r])=>d!==day&&r?.leave==="comp").map(([,r])=>r.sourceDay));
 return Object.keys(state.records).filter(d=>!used.has(d)&&eligibleCompSource(state,d,day,now)).sort().reverse();
}
function validateRecordChange(state,day,nextOrNull,now){
 const bad=error=>({ok:false,error});
 if(!state?.records||!now||!validDay(day)||day<firstDay(state)||day>now.day)return bad("今日までの日付を選んでください。");
 if(nextOrNull!==null){const shape=validateRecord(nextOrNull,day,now,state.settings);if(!shape.ok)return bad(shape.error);}
 const candidate={...state,records:{...state.records}};
 if(nextOrNull===null)delete candidate.records[day];else candidate.records[day]=nextOrNull;
 if(nextOrNull?.leave==="comp"){const error=compLinkError(candidate,day,nextOrNull,now);if(error)return bad(error);}
 for(const [compDay,r] of Object.entries(candidate.records)){
  if(r?.leave!=="comp"||r.sourceDay!==day)continue;
  if(compLinkError(candidate,compDay,r,now))return bad(compDay+"の代休に紐づく休日出勤です。先にその日の代休を解除してから変更・取消してください。");
 }
 return {ok:true};
}
function leaveRequestStamp(value){
 if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return null;
 const instant=new Date(value);return Number.isFinite(+instant)&&instant.toISOString()===value?clock(instant):null;
}
function validLeaveRequest(request,first,receipt=false){
 if(!exactObject(request,receipt?LEAVE_RECEIPT_FIELDS:LEAVE_REQUEST_FIELDS)||!validRequestId(request.id)||typeof request.day!=="string"||!validDay(request.day)||request.day<first||typeof request.leave!=="string"||!Object.hasOwn(LEAVES,request.leave)||typeof request.sourceDay!=="string")return false;
 if(request.leave==='comp'?!validDay(request.sourceDay)||request.sourceDay<first||request.sourceDay>=request.day:request.sourceDay!=='')return false;
 const submitted=leaveRequestStamp(request.requestedAt);
 return !!submitted&&request.day<=submitted.day&&(!receipt||request.delivery==='local');
}
function validLeaveRequests(requests,first){
 if(!requests||typeof requests!=="object"||Array.isArray(requests)||Object.prototype.toString.call(requests)!=="[object Object]"||Reflect.ownKeys(requests).length!==Object.keys(requests).length)return false;
 return Object.entries(requests).every(([id,request])=>validRequestId(id)&&request?.id===id&&validLeaveRequest(request,first,true));
}
function prepareLeaveRequest(state,input,now){
 const bad=error=>({ok:false,error});
 if(!now||!validDay(now.day)||!Number.isInteger(now.minutes)||now.minutes<0||now.minutes>1439)return bad("現在の日付・時刻を確認してください。");
 if(!validLeaveRequest(input,firstDay(state)))return bad("休暇申請の日付・区分・代休元・送信日時を確認してください。");
 if(input.day>now.day)return bad("今日までの日付を選んでください。");
 const submitted=leaveRequestStamp(input.requestedAt);
 if(submitted.day!==now.day||submitted.minutes>now.minutes)return bad("送信日時が変わりました。もう一度確認してください。");
 const current=hydrate(state,now);if(!current)return bad("保存した勤怠と申請履歴を読み直してください。");
 if(Object.hasOwn(current.leaveRequests||{},input.id))return bad("この申請はすでに記録されています。重複して送信できません。");
 const changed={...changeLeave(current.records[input.day]||empty(current),input.leave,input.day,now),sourceDay:input.sourceDay};
 const checked=validateRecord(changed,input.day,now,current.settings);if(!checked.ok)return bad(checked.error);
 const relation=validateRecordChange(current,input.day,checked.value,now);if(!relation.ok)return bad(relation.error);
 const request={id:input.id,day:input.day,leave:input.leave,sourceDay:input.sourceDay,requestedAt:input.requestedAt,delivery:'local'},value=clone(current);
 value.records[input.day]=checked.value;value.leaveRequests={...(value.leaveRequests||{}),[request.id]:request};invalidateSubmissions(value,input.day);
 return {ok:true,value,request:clone(request),record:clone(checked.value),warnings:[...checked.warnings]};
}
function validateSettings(s){
 if(!s||!Number.isFinite(s.minHours)||!Number.isFinite(s.maxHours)||s.minHours<0||s.maxHours>744||s.minHours>s.maxHours)return "基準時間は0〜744時間で、下限≦上限にしてください。";
 if(s.attendanceStartDay!==undefined&&!validDay(s.attendanceStartDay))return "記録開始日を正しい日付で入力してください。";
 if(s.employee!==undefined&&(!s.employee||typeof s.employee!=="object"||Array.isArray(s.employee)||EMPLOYEE_FIELDS.some(key=>typeof s.employee[key]!=="string"||s.employee[key].length>80)))return "氏名・所属・社員番号は80文字以内で入力してください。";
 if(!Number.isFinite(s.plannedHours)||s.plannedHours<0||s.plannedHours>744)return "勤務予定は0〜744時間で入力してください。";
 if(s.plannedHoursByMonth!==undefined){
  const planned=s.plannedHoursByMonth;
  if(!planned||typeof planned!=="object"||Array.isArray(planned)||Object.entries(planned).some(([key,value])=>!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)||!Number.isFinite(value)||value<0||value>744))return "月ごとの勤務予定は年月と0〜744時間を確認してください。";
 }
 if(typeof s.workSummary!=="string"||s.workSummary.length>1000)return "作業概要は1000文字以内で入力してください。";
 if(!Array.isArray(s.projects)||s.projects.length!==PROJECT_IDS.length)return "PJはP1〜P4・SETの略称と概要を設定してください。";
 for(const [i,p] of s.projects.entries())if(!p||p.id!==PROJECT_IDS[i]||typeof p.name!=="string"||!p.name.trim()||p.name.length>80||typeof p.description!=="string"||p.description.length>1000)return "PJ "+PROJECT_IDS[i]+"の略称と概要を確認してください。";
 if(!Array.isArray(s.places)||s.places.length!==3||s.places.some((p,i)=>p.id!=="place"+(i+1)||typeof p.code!=="string"||!p.code.trim()||p.code.length>80||typeof p.name!=="string"||!p.name.trim()||p.name.length>80||typeof p.address!=="string"||p.address.length>1000))return "作業場所・名称・住所を確認してください。";
 return "";
}
function createState(now,{startDay=now.day,employee:identity={name:"",department:"",id:""}}={}){
 const settings={attendanceStartDay:startDay,employee:identity,minHours:140,maxHours:180,plannedHours:168,plannedHoursByMonth:{},workSummary:"",projects:PROJECT_IDS.map((id,i)=>({id,name:id==="SET"?"SET":"プロジェクト"+(i+1),description:""})),places:[1,2,3].map(n=>({id:"place"+n,code:"場所"+n,name:"勤務場所"+n,address:""}))};
 const error=validateSettings(settings);if(error)throw new TypeError(error);
 return {version:VERSION,revision:0,mode:"local",defaults:{locationId:"place1",note:"",phases:[],breakMinutes:60},settings:clone(settings),records:{},submissions:{}};
}
function seed(now){
 const settings={minHours:140,maxHours:180,plannedHours:168,plannedHoursByMonth:{},workSummary:"ことら送金対応",projects:PROJECT_IDS.map((id,i)=>({id,name:id==="SET"?"SET":i?"プロジェクト"+(i+1):"デビプリ",description:i?"":"アプラス、千葉銀行など開発案件"})),places:[{id:"place1",code:"TIS1",name:"TIS本社1",address:"大阪堂北ビル"},{id:"place2",code:"クロノス",name:"クロノス",address:""},{id:"place3",code:"在宅",name:"在宅勤務",address:""}]};
 const state={version:VERSION,revision:0,mode:"demo",defaults:{locationId:"place2",note:"テスト対応",phases:[],breakMinutes:60},settings,records:{},submissions:{}};
 // Clearly marked fictional history, isolated from every other design and the main app.
 const totals=[10395,9630,10260,9660,11085,9150,5310];
 for(let i=0;i<totals.length;i++){
  const p=month("2026-04-01",i),days=dates(p.start,p.end).filter(d=>workday(d)&&d<now.day);
  let left=totals[i];
  for(const d of days){
   if(left<=0)break;
   const daily=Math.max(480,Math.ceil(totals[i]/Math.max(1,days.length)/15)*15),maxSameDay=1439-9*60-60,n=Math.min(daily,left,maxSameDay),r=empty(state);Object.assign(r,{start:"09:00",end:time(9*60+60+n),allocation:{...r.allocation,P1:n/60}});state.records[d]=r;left-=n;
  }
 }
 if(state.records["2026-10-01"]){const r=state.records["2026-10-01"],n=worked(r,"2026-10-01",now);r.allocation.P1=Math.max(0,n-120)/60;r.allocation.SET=Math.min(n,120)/60;}
 if("2026-10-20"<now.day){const r=empty(state);r.leave="paid";state.records["2026-10-20"]=r;}
 return state;
}
function hydrate(raw,now){
 if(!raw||raw.version!==VERSION||!Number.isInteger(raw.revision)||raw.revision<0||!raw.settings||!raw.defaults||!raw.records||Array.isArray(raw.records)||typeof raw.records!=="object"||!raw.submissions||Array.isArray(raw.submissions)||typeof raw.submissions!=="object")return null;
 const oldFour=Array.isArray(raw.settings.projects)&&raw.settings.projects.length===4&&raw.settings.projects.every((p,i)=>p?.id===PROJECT_IDS[i]);
 const oldFive=Array.isArray(raw.settings.projects)&&raw.settings.projects.length===5&&raw.settings.projects.every((p,i)=>p?.id===(i===4?"P5":PROJECT_IDS[i]));
 const settings=oldFour?{...raw.settings,projects:[...raw.settings.projects,{id:"SET",name:"SET",description:""}]}:oldFive?{...raw.settings,projects:raw.settings.projects.map((p,i)=>i===4?{...p,id:"SET"}:p)}:raw.settings;
 // Validate original values before JSON cloning can drop undefined keys or change NaN.
 if(validateSettings(settings))return null;
 if(raw.mode!==undefined&&raw.mode!=="demo"&&raw.mode!=="local")return null;
 if(raw.mode==="local"&&(!validDay(settings.attendanceStartDay)||settings.employee===undefined))return null;
 if(Object.hasOwn(raw,"leaveRequests")&&!validLeaveRequests(raw.leaveRequests,settings.attendanceStartDay||FIRST))return null;
 const d=raw.defaults;
 if(Object.hasOwn(d,"phases")&&!validPhases(d.phases))return null;
 if(!settings.places.some(p=>p.id===d.locationId)||typeof d.note!=="string"||d.note.length>1000||!Number.isInteger(d.breakMinutes)||d.breakMinutes<0||d.breakMinutes>1440)return null;
 // Validate stored dates against end-of-day, so a saved record survives clock changes.
 const migratedRecords={};
 for(const [day,r] of Object.entries(raw.records)){
  let candidate=r;
  const allocation=r?.allocation;
  if((oldFour||oldFive)&&allocation&&typeof allocation==="object"&&!Array.isArray(allocation)&&Object.hasOwn(allocation,"P5")){
   if(!validAllocationHours(allocation.P5)||!Object.hasOwn(allocation,"SET")||!validAllocationHours(allocation.SET)||r.legacyProjectAllocation!==undefined)return null;
   const originalSET=allocation.SET,minutes=Math.round(allocation.P5*60)+Math.round(originalSET*60),nextAllocation={...allocation,SET:minutes/60};delete nextAllocation.P5;
   candidate={...r,allocation:nextAllocation};
   if(minutes>1440)candidate.legacyProjectAllocation={P5:allocation.P5,SET:originalSET};
  }else if(oldFive&&!Object.hasOwn(allocation||{},"P5"))return null;
  if(!validateRecord(candidate,day,{day:day>now.day?day:now.day,minutes:1439},settings).ok)return null;
  migratedRecords[day]=fullLeave(candidate)?{...candidate,start:"",end:"",overnight:false}:candidate;
 }
 for(const [key,s] of Object.entries(raw.submissions))if(!/^\d{4}-\d{2}-\d{2}\|\d{4}-\d{2}-\d{2}$/.test(key)||!s||typeof s.at!=="string"||!Number.isFinite(Date.parse(s.at))||typeof s.test!=="boolean")return null;
 let state;try{state=clone({...raw,settings,records:migratedRecords});}catch{return null;}
 if(state.settings.plannedHoursByMonth===undefined){
  state.settings.plannedHoursByMonth={};
  // The former demo default becomes automatic; preserve other saved choices for this month.
  if(state.settings.plannedHours!==168)state.settings.plannedHoursByMonth[now.day.slice(0,7)]=state.settings.plannedHours;
 }
 return state;
}
function missing(state,period,now){
 const end=period.end<now.day?period.end:now.day,first=firstDay(state);
 return dates(period.start<first?first:period.start,end).filter(d=>{
  const r=state.records[d];
  if(fullLeave(r))return false;
  if(r?.start)return !r.end;
  return workday(d)||!!r?.leave;
 });
}
function submissionCheck(state,period,now,options={}){
 const fail=message=>({ok:false,errors:[{day:"",messages:[message]}]});
 if(!period||!validDay(period.start)||!validDay(period.end)||period.start>period.end||(+date(period.end)-+date(period.start))/86400000>=366)return fail("対象期間は開始日から366日以内で指定してください。");
 if(!now||!validDay(now.day)||!Number.isInteger(now.minutes)||now.minutes<0||now.minutes>1439)return fail("現在の日付・時刻を確認してください。");
 const first=firstDay(state),start=period.start<first?first:period.start,end=period.end<now.day?period.end:now.day;
 if(start>end)return fail("対象期間に記録開始日から今日までの日付を含めてください。");
 if(!state||!state.records||Array.isArray(state.records)||typeof state.records!=="object"||validateSettings(state.settings))return fail("勤務表のデータと設定を確認してください。");
 const errors=[],missingDays=new Set(missing(state,period,now)),halfLeaveExemptsShortHours=options.halfLeaveExemptsShortHours!==false;
 for(const day of dates(start,end)){
  const r=state.records[day],messages=[];
  if(r!==undefined){
   const shape=validateRecord(r,day,now,state.settings);
   if(!shape.ok){errors.push({day,messages:[shape.error]});continue;}
   if(r.leave==="comp"){const linkError=compLinkError(state,day,r,now);if(linkError)messages.push(linkError);}
  }
  if(missingDays.has(day))messages.push("出勤・退勤が未入力です。勤務記録または休暇を登録してください。");
  if(r&&!fullLeave(r)&&(r.start||r.end)){
   if(!r.note.trim())messages.push("作業内容を入力してください。");
   if(r.start&&r.end){
    const net=worked(r,day,now),allocated=PROJECTS.reduce((sum,k)=>sum+Math.round(r.allocation[k]*60),0);
    if(net<0)messages.push("休憩時間を引いた勤務時間がマイナスです。出退勤と休憩時間を確認してください。");
    else{
     if(net<=240&&!restDay(day)&&!(halfLeaveExemptsShortHours&&["am","pm"].includes(r.leave)))messages.push("実働が4時間以下です。有給休暇または半休を登録してください。");
     if(allocated!==net)messages.push("勤務時間（"+duration(net)+"）と工数合計（"+duration(allocated)+"）を一致させてください。");
    }
   }
  }
  if(messages.length)errors.push({day,messages});
 }
 // Recheck dependent leave even when its date falls outside the source's period.
 for(const [day,r] of Object.entries(state.records)){
  if(r?.leave!=="comp"||!validDay(day)||!validDay(r.sourceDay)||day>now.day||day>=start&&day<=end||r.sourceDay<start||r.sourceDay>end)continue;
  const linkError=compLinkError(state,day,r,now);
  if(linkError)errors.push({day,messages:[linkError]});
 }
 return {ok:errors.length===0,errors};
}
function prepareSubmission(state,period,now,options={}){
 const check=submissionCheck(state,period,now,options);
 return check.ok?{ok:true,bytes:workbook(state,period,now),errors:[]}:check;
}
function allocateToP1(record,day,now){
 const next=clone(record);
 if(fullLeave(record)){next.allocation=Object.fromEntries(PROJECTS.map(k=>[k,0]));delete next.legacyProjectAllocation;return next;}
 if(!record.start||!record.end)return next;
 const other=PROJECTS.slice(1).reduce((sum,k)=>sum+Math.round(record.allocation[k]*60),0);
 next.allocation.P1=Math.max(0,worked(record,day,now)-other)/60;
 return next;
}
function pastMissing(state,now){
 const out=[],end=add(now.day,-1);
 for(let day=firstDay(state);day<=end;day=add(day,1)){
  if(!workday(day))continue;
  const r=state.records[day];if(fullLeave(r))continue;
  if(!r?.start||!r.end)out.push(day);
 }
 return out;
}
function summary(state,period,now){
 const result={minutes:0,leave:0,days:0,absenceMinutes:0,absenceDays:0,allocation:Object.fromEntries(PROJECTS.map(k=>[k,0]))};
 for(const d of dates(period.start,period.end)){
  const r=state.records[d];if(!r||d>now.day)continue;
  result.minutes+=worked(r,d,now);if(r.start&&!fullLeave(r))result.days++;
  result.leave+=r.leave==="paid"?1:["am","pm"].includes(r.leave)?.5:0;
  const absence=d>=firstDay(state)?absenceMinutes(r,d,now):0;
  result.absenceMinutes+=absence;if(absence)result.absenceDays++;
  for(const k of PROJECTS)result.allocation[k]+=r.allocation[k];
 }
 return result;
}
function submissionStatus(state,period){return state.submissions[periodKey(period)]?(state.submissions[periodKey(period)].test?"テスト提出済":"出力済"):"未提出";}
function invalidateSubmissions(state,day){
 const affected=[day,...Object.entries(state.records).filter(([,r])=>r?.leave==="comp"&&r.sourceDay===day).map(([d])=>d)];
 for(const key of Object.keys(state.submissions)){const [start,end]=key.split("|");if(affected.some(d=>d>=start&&d<=end))delete state.submissions[key];}
}
const durationCell=n=>n<0?short(n):{v:n/1440,duration:true};
function workbook(state,period,now){
 const summaryData=summary(state,period,now);
 const rows=[[isDemo(state)?"勤怠表（A. Paper 操作デモ）":"勤怠表"],["氏名",employee(state).name],["対象期間",period.start+"〜"+period.end],["作業概要",state.settings.workSummary],["基準時間",state.settings.minHours+"〜"+state.settings.maxHours+"時間"],[],["日付","曜日","区分","出勤","退勤","休憩（分）","勤務時間","勤務場所","作業内容",...PROJECTS.map(k=>k+"（時間）"),"代休元の休日出勤日","フェーズ"]];
 for(const d of dates(period.start,period.end)){
  const r=state.records[d],future=d>now.day,p=state.settings.places.find(p=>p.id===r?.locationId),hasWork=!!r?.start&&!fullLeave(r);
  const base=!isDemo(state)&&d<firstDay(state)?"記録開始前":future?"これから":r?.leave?LEAVES[r.leave]:r?.end?"勤務":r?.start?"退勤未入力":holiday(d)|| (workday(d)?"未入力":holidayKnown(d)?"休日":"祝日未確認");
  const status=!future&&holiday(d)&&(r?.start||r?.leave)?base+"（"+holiday(d)+"）":base;
  rows.push([d,WEEK[weekday(d)],status,...(r&&!future?[hasWork?r.start:"",hasWork?r.end+(r.end&&r.overnight?"（翌日）":""):"",hasWork?r.breakMinutes:"",durationCell(worked(r,d,now)),hasWork?p?.code||"":"",r.note,...PROJECTS.map(k=>r.allocation[k]),r.leave==="comp"?r.sourceDay||"":"",phaseText(r)]:["","","","","","",...PROJECTS.map(()=>""),"",""])]);
 }
 rows.push([], ["合計","","","","","",durationCell(summaryData.minutes),"","",...PROJECTS.map(k=>Number(summaryData.allocation[k].toFixed(4)))]);
 const config=[["勤務表設定"],["PJ","PJ略称","PJ概要"],...state.settings.projects.map(p=>[p.id,p.name,p.description]),[],["場所","作業場所","作業場所名称","作業場所住所"],...state.settings.places.map((p,i)=>["場所"+(i+1),p.code,p.name,p.address])];
 return xlsx([{name:"勤務表",headerRow:7,rows},{name:"設定",headerRow:2,rows:config}]);
}
  const xml=s=>String(s??"").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));
  function utf8(text){
    const out=[];
    for(const ch of String(text)){const c=ch.codePointAt(0);if(c<128)out.push(c);else if(c<2048)out.push(192|(c>>6),128|(c&63));else if(c<65536)out.push(224|(c>>12),128|((c>>6)&63),128|(c&63));else out.push(240|(c>>18),128|((c>>12)&63),128|((c>>6)&63),128|(c&63));}
    return Uint8Array.from(out);
  }
  const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
  function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
  function zip(files){
    const parts=[],central=[];let offset=0;
    const put=(a,n,count)=>{for(let i=0;i<count;i++)a.push((n>>>(i*8))&255);};
    for(const [name,text] of files){
      const filename=utf8(name),data=utf8(text),crc=crc32(data),h=[];
      put(h,0x04034b50,4);put(h,20,2);put(h,0x800,2);put(h,0,2);put(h,0,2);put(h,33,2);put(h,crc,4);put(h,data.length,4);put(h,data.length,4);put(h,filename.length,2);put(h,0,2);
      parts.push(Uint8Array.from(h),filename,data);
      const c=[];put(c,0x02014b50,4);put(c,20,2);put(c,20,2);put(c,0x800,2);put(c,0,2);put(c,0,2);put(c,33,2);put(c,crc,4);put(c,data.length,4);put(c,data.length,4);put(c,filename.length,2);put(c,0,2);put(c,0,2);put(c,0,2);put(c,0,2);put(c,0,4);put(c,offset,4);
      central.push(Uint8Array.from(c),filename);offset+=h.length+filename.length+data.length;
    }
    const centralSize=central.reduce((n,b)=>n+b.length,0),end=[];
    put(end,0x06054b50,4);put(end,0,2);put(end,0,2);put(end,files.length,2);put(end,files.length,2);put(end,centralSize,4);put(end,offset,4);put(end,0,2);
    const all=[...parts,...central,Uint8Array.from(end)],out=new Uint8Array(all.reduce((n,b)=>n+b.length,0));let cursor=0;
    all.forEach(part=>{out.set(part,cursor);cursor+=part.length;});return out;
  }
  function column(n){let s="";for(n++;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
  function worksheet(rows,headerRow=1){
    const lastColumn=Math.max(12,...rows.map(row=>row.length));
    const data=rows.map((row,r)=>'<row r="'+(r+1)+'">'+row.map((cell,c)=>{
      const item=cell&&typeof cell==="object"?cell:{v:cell},style=item.duration?2:r+1===headerRow?1:0,ref=column(c)+(r+1);
      if(typeof item.v==="number"&&Number.isFinite(item.v))return '<c r="'+ref+'" s="'+style+'"><v>'+item.v+'</v></c>';
      return '<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+xml(item.v)+'</t></is></c>';
    }).join("")+'</row>').join("");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="'+headerRow+'" topLeftCell="A'+(headerRow+1)+'" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="15" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/><col min="3" max="'+lastColumn+'" width="15" customWidth="1"/></cols><sheetData>'+data+'</sheetData></worksheet>';
  }
  function xlsx(sheets){
    const prefix='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const ns="http://schemas.openxmlformats.org/package/2006/relationships";
    const files=[
      ["[Content_Types].xml",prefix+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+sheets.map((s,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("")+'</Types>'],
      ["_rels/.rels",prefix+'<Relationships xmlns="'+ns+'"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ["xl/workbook.xml",prefix+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+sheets.map((s,i)=>'<sheet name="'+xml(s.name.slice(0,31))+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join("")+'</sheets></workbook>'],
      ["xl/_rels/workbook.xml.rels",prefix+'<Relationships xmlns="'+ns+'">'+sheets.map((s,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join("")+'<Relationship Id="rId'+(sheets.length+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ["xl/styles.xml",prefix+'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="[h]:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F0FC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>']
    ];
    sheets.forEach((s,i)=>files.push(["xl/worksheets/sheet"+(i+1)+".xml",worksheet(s.rows,s.headerRow||1)]));return zip(files);
  }
global.PaperAttendance={VERSION,KEY,FIRST,PROJECTS,PHASES,PHASE_IDS,WEEK,LEAVES,pad,clone,iso,date,validDay,firstDay,isDemo,employee,add,weekday,holidayKnown,holiday,workday,dates,month,monthWorkdays,plannedHours,fiscalPeriod,pastMissing,periods,periodKey,clock,timeToMin,time,short,duration,hours,fullLeave,validPhases,changeLeave,worked,absenceMinutes,empty,phaseText,allocationMax,validateRecord,validateRecordChange,prepareLeaveRequest,compSources,validateSettings,createState,seed,hydrate,missing,submissionCheck,prepareSubmission,allocateToP1,summary,submissionStatus,invalidateSubmissions,workbook};
})(window);
