(function(global){
"use strict";
const VERSION=1,KEY="day-paper-attendance-v1",FIRST="2026-04-01";
const PROJECTS=["P1","P2","P3","P4","SET"],WEEK=["日","月","火","水","木","金","土"];
const LEAVES={"":"休暇なし",paid:"有給休暇",am:"午前半休",pm:"午後半休",holiday:"公休",special:"特別休暇"};
const pad=n=>String(n).padStart(2,"0"),clone=value=>JSON.parse(JSON.stringify(value));
const iso=d=>d.toISOString().slice(0,10),date=day=>new Date(day+"T00:00:00Z");
const validDay=day=>/^\d{4}-\d{2}-\d{2}$/.test(day||"")&&Number.isFinite(+date(day))&&iso(date(day))===day;
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
const fullLeave=r=>["paid","holiday","special"].includes(r?.leave);
function worked(r,day,now){
 if(!r||fullLeave(r)||timeToMin(r.start)==null)return 0;
 const end=r.end?timeToMin(r.end)+(r.overnight?1440:0):day===now.day?now.minutes:null;
 return end==null?0:end-timeToMin(r.start)-r.breakMinutes;
}
function empty(state){return {start:"",end:"",overnight:false,breakMinutes:state.defaults.breakMinutes,locationId:state.defaults.locationId,note:state.defaults.note,leave:"",allocation:Object.fromEntries(PROJECTS.map(k=>[k,0]))};}
function validateRecord(r,day,now,settings){
 const bad=error=>({ok:false,error});
 if(!validDay(day)||day<FIRST||day>now.day)return bad("今日までの日付を選んでください。");
 if(!r||typeof r.start!=="string"||typeof r.end!=="string"||typeof r.overnight!=="boolean")return bad("時刻を確認してください。");
 if(!Object.hasOwn(LEAVES,r.leave))return bad("休暇区分を選んでください。");
 if(!Number.isInteger(r.breakMinutes)||r.breakMinutes<0||r.breakMinutes>1440)return bad("休憩時間は0〜1440分で入力してください。");
 if(typeof r.note!=="string"||r.note.length>1000)return bad("作業内容は1000文字以内で入力してください。");
 if(!settings.places.some(p=>p.id===r.locationId))return bad("勤務場所を選んでください。");
 if(fullLeave(r)&&(r.start||r.end))return bad("打刻がある日は、先に打刻を取り消してから休暇を設定してください。");
 if(r.start&&timeToMin(r.start)==null||r.end&&timeToMin(r.end)==null)return bad("出勤・退勤時刻を確認してください。");
 if(r.end&&!r.start)return bad("先に出勤時刻を入力してください。");
 if(r.start&&!r.end&&day===now.day&&timeToMin(r.start)>now.minutes)return bad("出勤時刻は現在時刻より前にしてください。");
 if(r.start&&r.end){
  const span=timeToMin(r.end)+(r.overnight?1440:0)-timeToMin(r.start);
  if(span<0)return bad("翌日の退勤は「翌日に退勤」を選んでください。");
 }
 if(!r.allocation||PROJECTS.some(k=>!Number.isFinite(r.allocation[k])||r.allocation[k]<0||r.allocation[k]>24||Math.abs(r.allocation[k]*60-Math.round(r.allocation[k]*60))>1e-5))return bad("工数は0〜24時間で、分単位で入力してください。");
 const allocated=PROJECTS.reduce((sum,k)=>sum+Math.round(r.allocation[k]*60),0);
 if(allocated&&(!r.start||!r.end))return bad("工数は出勤・退勤を入力してから設定してください。");
 const net=worked(r,day,now);
 const warnings=net<0?["休憩時間を引いた勤務時間が「"+duration(net)+"」になっています。記録は保存しました。出退勤と休憩時間を確認してください。"+(allocated?" 工数は入力済みの値を保持しています。":"")]:allocated&&allocated!==net?["勤務時間（"+duration(net)+"）と工数合計（"+duration(allocated)+"）が一致していません。記録は保存しました。工数の振り分けを確認してください。"]:[];
 return {ok:true,value:clone(r),warnings};
}
function validateSettings(s){
 if(!s||!Number.isFinite(s.minHours)||!Number.isFinite(s.maxHours)||s.minHours<0||s.maxHours>744||s.minHours>s.maxHours)return "基準時間は0〜744時間で、下限≦上限にしてください。";
 if(!Number.isFinite(s.plannedHours)||s.plannedHours<0||s.plannedHours>744)return "勤務予定は0〜744時間で入力してください。";
 if(typeof s.workSummary!=="string"||s.workSummary.length>1000)return "作業概要は1000文字以内で入力してください。";
 if(!Array.isArray(s.projects)||s.projects.length!==4||s.projects.some((p,i)=>p.id!==PROJECTS[i]||typeof p.name!=="string"||!p.name.trim()||p.name.length>80||typeof p.description!=="string"||p.description.length>1000))return "各PJの略称と概要を確認してください。";
 if(!Array.isArray(s.places)||s.places.length!==3||s.places.some((p,i)=>p.id!=="place"+(i+1)||typeof p.code!=="string"||!p.code.trim()||p.code.length>80||typeof p.name!=="string"||!p.name.trim()||p.name.length>80||typeof p.address!=="string"||p.address.length>1000))return "作業場所・名称・住所を確認してください。";
 return "";
}
function seed(now){
 const settings={minHours:140,maxHours:180,plannedHours:168,workSummary:"ことら送金対応",projects:PROJECTS.slice(0,4).map((id,i)=>({id,name:i?"プロジェクト"+(i+1):"デビプリ",description:i?"":"アプラス、千葉銀行など開発案件"})),places:[{id:"place1",code:"TIS1",name:"TIS本社1",address:"大阪堂北ビル"},{id:"place2",code:"クロノス",name:"クロノス",address:""},{id:"place3",code:"在宅",name:"在宅勤務",address:""}]};
 const state={version:VERSION,revision:0,defaults:{locationId:"place2",note:"テスト対応",breakMinutes:60},settings,records:{},submissions:{}};
 // Clearly marked fictional history, isolated from every other design and the main app.
 const totals=[10395,9630,10260,9660,11085,9150,5310];
 for(let i=0;i<totals.length;i++){
  const p=month("2026-04-01",i),days=dates(p.start,p.end).filter(d=>workday(d)&&d<now.day);
  let left=totals[i];
  for(const d of days){
   if(left<=0)break;
   const daily=Math.max(480,Math.ceil(totals[i]/Math.max(1,days.length)/15)*15),maxSameDay=1439-9*60-60,n=Math.min(daily,left,maxSameDay),r=empty(state);Object.assign(r,{start:"09:00",end:time(9*60+60+n),allocation:{P1:n/60,P2:0,P3:0,P4:0,SET:0}});state.records[d]=r;left-=n;
  }
 }
 if(state.records["2026-10-01"]){const r=state.records["2026-10-01"],n=worked(r,"2026-10-01",now);r.allocation.P1=Math.max(0,n-120)/60;r.allocation.SET=Math.min(n,120)/60;}
 if("2026-10-20"<now.day){const r=empty(state);r.leave="paid";state.records["2026-10-20"]=r;}
 return state;
}
function hydrate(raw,now){
 if(!raw||raw.version!==VERSION||!Number.isInteger(raw.revision)||raw.revision<0||validateSettings(raw.settings)||!raw.defaults||!raw.records||Array.isArray(raw.records)||typeof raw.records!=="object"||!raw.submissions||Array.isArray(raw.submissions)||typeof raw.submissions!=="object")return null;
 const d=raw.defaults;
 if(!raw.settings.places.some(p=>p.id===d.locationId)||typeof d.note!=="string"||d.note.length>1000||!Number.isInteger(d.breakMinutes)||d.breakMinutes<0||d.breakMinutes>1440)return null;
 // Validate stored dates against end-of-day, so a saved record survives clock changes.
 for(const [day,r] of Object.entries(raw.records))if(!validateRecord(r,day,{day:day>now.day?day:now.day,minutes:1439},raw.settings).ok)return null;
 for(const [key,s] of Object.entries(raw.submissions))if(!/^\d{4}-\d{2}-\d{2}\|\d{4}-\d{2}-\d{2}$/.test(key)||!s||typeof s.at!=="string"||!Number.isFinite(Date.parse(s.at))||typeof s.test!=="boolean")return null;
 return clone(raw);
}
function missing(state,period,now){
 const end=period.end<now.day?period.end:now.day;
 return dates(period.start<FIRST?FIRST:period.start,end).filter(d=>{
  const r=state.records[d];
  if(fullLeave(r))return false;
  if(r?.start)return !r.end;
  return workday(d)||!!r?.leave;
 });
}
function pastMissing(state,now){
 const out=[],end=add(now.day,-1);
 for(let day=FIRST;day<=end;day=add(day,1)){
  if(!workday(day))continue;
  const r=state.records[day];if(fullLeave(r))continue;
  if(!r?.start||!r.end)out.push(day);
 }
 return out;
}
function summary(state,period,now){
 const result={minutes:0,leave:0,days:0,allocation:Object.fromEntries(PROJECTS.map(k=>[k,0]))};
 for(const d of dates(period.start,period.end)){
  const r=state.records[d];if(!r||d>now.day)continue;
  result.minutes+=worked(r,d,now);if(r.start)result.days++;
  result.leave+=r.leave==="paid"?1:["am","pm"].includes(r.leave)?.5:0;
  for(const k of PROJECTS)result.allocation[k]+=r.allocation[k];
 }
 return result;
}
function submissionStatus(state,period){return state.submissions[periodKey(period)]?(state.submissions[periodKey(period)].test?"テスト提出済":"出力済"):"未提出";}
function invalidateSubmissions(state,day){for(const key of Object.keys(state.submissions)){const [start,end]=key.split("|");if(day>=start&&day<=end)delete state.submissions[key];}}
const durationCell=n=>n<0?short(n):{v:n/1440,duration:true};
function workbook(state,period,now){
 const summaryData=summary(state,period,now);
 const rows=[["勤怠表（A. Paper 操作デモ）"],["氏名","田中 花子"],["対象期間",period.start+"〜"+period.end],["作業概要",state.settings.workSummary],["基準時間",state.settings.minHours+"〜"+state.settings.maxHours+"時間"],[],["日付","曜日","区分","出勤","退勤","休憩（分）","勤務時間","勤務場所","作業内容",...PROJECTS.map(k=>k+"（時間）")]];
 for(const d of dates(period.start,period.end)){
  const r=state.records[d],future=d>now.day,p=state.settings.places.find(p=>p.id===r?.locationId),hasWork=!!r?.start&&!fullLeave(r);
  const base=future?"これから":r?.leave?LEAVES[r.leave]:r?.end?"勤務":r?.start?"退勤未入力":holiday(d)|| (workday(d)?"未入力":holidayKnown(d)?"休日":"祝日未確認");
  const status=!future&&holiday(d)&&(r?.start||r?.leave)?base+"（"+holiday(d)+"）":base;
  rows.push([d,WEEK[weekday(d)],status,...(r&&!future?[r.start,r.end+(r.end&&r.overnight?"（翌日）":""),hasWork?r.breakMinutes:"",durationCell(worked(r,d,now)),hasWork?p?.code||"":"",r.note,...PROJECTS.map(k=>r.allocation[k])]:["","","","","","",...PROJECTS.map(()=>"")])]);
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
    const data=rows.map((row,r)=>'<row r="'+(r+1)+'">'+row.map((cell,c)=>{
      const item=cell&&typeof cell==="object"?cell:{v:cell},style=item.duration?2:r+1===headerRow?1:0,ref=column(c)+(r+1);
      if(typeof item.v==="number"&&Number.isFinite(item.v))return '<c r="'+ref+'" s="'+style+'"><v>'+item.v+'</v></c>';
      return '<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+xml(item.v)+'</t></is></c>';
    }).join("")+'</row>').join("");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="'+headerRow+'" topLeftCell="A'+(headerRow+1)+'" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="15" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/><col min="3" max="12" width="15" customWidth="1"/></cols><sheetData>'+data+'</sheetData></worksheet>';
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
global.PaperAttendance={VERSION,KEY,FIRST,PROJECTS,WEEK,LEAVES,pad,clone,iso,date,validDay,add,weekday,holidayKnown,holiday,workday,dates,month,monthWorkdays,fiscalPeriod,pastMissing,periods,periodKey,clock,timeToMin,time,short,duration,hours,fullLeave,worked,empty,validateRecord,validateSettings,seed,hydrate,missing,summary,submissionStatus,invalidateSubmissions,workbook};
})(window);
