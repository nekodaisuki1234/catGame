window.createAttendanceCore = (function createAttendanceCore(referenceTime){
  "use strict";
  const clockFormatter=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
  function clockAt(instant=new Date()){
    const p=Object.fromEntries(clockFormatter.formatToParts(instant).map(part=>[part.type,part.value]));
    const hour=String(Number(p.hour)%24).padStart(2,"0"),day=p.year+"-"+p.month+"-"+p.day;
    return {day,minutes:Number(hour)*60+Number(p.minute),seconds:Number(p.second),secondsText:p.second,time:hour+":"+p.minute,iso:day+"T"+hour+":"+p.minute+":"+p.second+"+09:00"};
  }
  const snapshot=clockAt(referenceTime||new Date());
  const TODAY=snapshot.day,FIRST="2026-08-01",BASE_NOW=snapshot.minutes,VERSION=1;
  const WEEK=["日","月","火","水","木","金","土"];
  const pad=n=>String(n).padStart(2,"0");
  const iso=d=>d.toISOString().slice(0,10);
  const date=s=>new Date(s+"T00:00:00Z");
  const add=(s,n)=>{const d=date(s);d.setUTCDate(d.getUTCDate()+n);return iso(d);};
  const weekday=s=>date(s).getUTCDay();
  const isWorkday=s=>weekday(s)>0&&weekday(s)<6;
  const key=(id,day)=>id+"|"+day;
  const monthDays=(y,m)=>new Date(Date.UTC(y,m+1,0)).getUTCDate();
  function endInMonth(y,m,cutoff){
    const anchor=new Date(Date.UTC(y,m,1)),yy=anchor.getUTCFullYear(),mm=anchor.getUTCMonth();
    return iso(new Date(Date.UTC(yy,mm,cutoff===0?monthDays(yy,mm):Math.min(cutoff,monthDays(yy,mm)))));
  }
  function monthFor(day,offset=0){
    const base=date(day),first=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()+offset,1));
    return {start:iso(first),end:iso(new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)))};
  }
  function monthGrid(period){
    const first=add(period.start,-((weekday(period.start)+6)%7)),last=add(period.end,6-((weekday(period.end)+6)%7));
    return dates(first,last).map(day=>({day,inMonth:day>=period.start&&day<=period.end}));
  }
  function periodFor(day,cutoff){
    const d=date(day),y=d.getUTCFullYear(),m=d.getUTCMonth();
    let end=endInMonth(y,m,cutoff);
    if(end<day)end=endInMonth(y,m+1,cutoff);
    const e=date(end),previous=endInMonth(e.getUTCFullYear(),e.getUTCMonth()-1,cutoff);
    return {start:add(previous,1),end,cutoff};
  }
  function periodAt(day,cutoff,offset=0){
    const current=periodFor(day,cutoff),end=date(current.end);
    const nextEnd=endInMonth(end.getUTCFullYear(),end.getUTCMonth()+offset,cutoff),n=date(nextEnd);
    return {start:add(endInMonth(n.getUTCFullYear(),n.getUTCMonth()-1,cutoff),1),end:nextEnd,cutoff};
  }
  function nextPeriod(current,newCutoff){
    const e=date(current.end);
    let end=endInMonth(e.getUTCFullYear(),e.getUTCMonth(),newCutoff);
    if(end<=current.end)end=endInMonth(e.getUTCFullYear(),e.getUTCMonth()+1,newCutoff);
    return {start:add(current.end,1),end,cutoff:newCutoff};
  }
  function dates(start,end){
    const out=[];
    for(let d=start;d<=end&&out.length<400;d=add(d,1))out.push(d);
    return out;
  }
  function visibleDates(period){
    const start=period.start<FIRST?FIRST:period.start,end=period.end>TODAY?TODAY:period.end;
    return start>end?[]:dates(start,end);
  }
  function timeToMin(value){
    if(!/^\d{2}:\d{2}$/.test(value||""))return null;
    const [h,m]=value.split(":").map(Number);
    return h<24&&m<60?h*60+m:null;
  }
  const time=n=>pad(Math.floor(Math.max(0,n)/60)%24)+":"+pad(Math.floor(Math.max(0,n))%60);
  const duration=n=>Math.floor(Math.max(0,n)/60)+"時間"+pad(Math.floor(Math.max(0,n))%60)+"分";
  const shortDuration=n=>Math.floor(Math.max(0,n)/60)+":"+pad(Math.floor(Math.max(0,n))%60);
  const DEFAULT_BREAK=60;
  function parseBreakDuration(hours,minutes){
    if(!/^\d{1,2}$/.test(String(hours))||!/^\d{1,2}$/.test(String(minutes)))return {ok:false,error:"休憩時間は、時間と分を0以上の整数で入力してください。"};
    const h=Number(hours),m=Number(minutes),value=h*60+m;
    if(h>24||m>59||value>1440)return {ok:false,error:"休憩時間は24時間00分まで、分は0〜59で入力してください。"};
    return {ok:true,value};
  }
  function breakTotal(state,id,day){
    const record=state.records[key(id,day)];
    if(record?.kind==="work"&&Number.isInteger(record.breakMinutes))return record.breakMinutes;
    const saved=state.breakDrafts?.[key(id,day)];
    return Number.isInteger(saved)?saved:DEFAULT_BREAK;
  }
  function checkBreakTotal(total,span=null){
    if(!Number.isInteger(total)||total<0||total>1440)return {ok:false,error:"休憩時間は0時間00分〜24時間00分で入力してください。"};
    if(span!=null&&total>span)return {ok:false,error:"休憩時間が勤務の時間幅を超えています。",code:"break-exceeds-span"};
    return {ok:true,value:total};
  }
  function setBreakTotal(record,total){
    const span=record?.kind==="work"&&timeToMin(record.start)!=null&&timeToMin(record.end)!=null?timeToMin(record.end)+(record.overnight?1440:0)-timeToMin(record.start):null;
    const check=checkBreakTotal(total,span);if(!check.ok)return check;
    if(record?.kind!=="work")return {ok:true,value:record||null};
    const value={...record,breakMinutes:total,breakMode:"total",openBreak:null};
    if(record.breakMinutes!==total||record.openBreak!=null)delete value.breaks;
    return {ok:true,value};
  }
  function worked(record,day,now=BASE_NOW){
    if(!record||record.kind!=="work")return 0;
    const start=timeToMin(record.start);
    if(start==null)return 0;
    let end=timeToMin(record.end);
    if(end==null){if(day!==TODAY)return 0;end=now;}else if(record.overnight)end+=1440;
    return Math.max(0,end-start-(Number(record.breakMinutes)||0));
  }
  // Keep historical positioned breaks; entered daily totals stay unpositioned.
  function timeline(record,day,now=BASE_NOW){
    const start=record?.kind==="work"?timeToMin(record.start):null;
    if(start==null||day>TODAY)return null;
    const ended=timeToMin(record.end),live=ended==null&&day===TODAY;
    if(ended==null&&!live)return null;
    const end=ended==null?now:ended+(record.overnight?1440:0);
    if(end<start)return null;
    const ranges=(Array.isArray(record.breaks)?record.breaks:[]).filter(b=>Number.isInteger(b?.start)&&Number.isInteger(b?.end)&&b.end>b.start).map(b=>({start:Math.max(start,b.start),end:Math.min(end,b.end)}));
    ranges.sort((a,b)=>a.start-b.start);
    const breaks=[];
    for(const b of ranges){
      if(b.end<=b.start)continue;
      const previous=breaks[breaks.length-1];
      if(previous&&b.start<=previous.end)previous.end=Math.max(previous.end,b.end);
      else breaks.push({...b});
    }
    const positioned=breaks.reduce((total,b)=>total+b.end-b.start,0);
    const rest=Math.max(0,Number(record.breakMinutes)||0);
    const unknownRest=Math.max(0,rest-positioned),segments=[];
    let cursor=start;
    for(const b of breaks){
      if(cursor<b.start)segments.push({kind:unknownRest?"unlocated":"work",start:cursor,end:b.start});
      segments.push({kind:"break",...b});cursor=b.end;
    }
    if(cursor<end)segments.push({kind:unknownRest?"unlocated":"work",start:cursor,end});
    return {start,end,live,breaks,segments,rest,unknownRest,minutes:worked(record,day,now)};
  }
  function status(record,day){
    if(day>TODAY)return "upcoming";
    if(!record)return isWorkday(day)?"missing":"holiday";
    if(record.kind==="leave")return "leave";
    if(record.kind==="holiday")return "holiday";
    if(record.kind!=="work"||timeToMin(record.start)==null)return "missing";
    if(!record.end)return day===TODAY?"working":"incomplete";
    return "complete";
  }
  const statusText=s=>({missing:"未入力",holiday:"休み",leave:"有休",working:"勤務中",break:"休憩中",incomplete:"退勤未入力",complete:"入力済み",upcoming:"これから"}[s]||"未入力");
  function summary(state,employeeId,period,now=BASE_NOW){
    let minutes=0,days=0,missing=0,leave=0,open=0;
    const list=visibleDates(period);
    for(const d of list){
      const r=state.records[key(employeeId,d)],s=status(r,d);
      minutes+=worked(r,d,now);
      if(r&&r.kind==="work"&&timeToMin(r.start)!=null)days++;
      if(s==="missing"||s==="incomplete")missing++;
      if(s==="leave")leave++;
      if(s==="working"||s==="break")open++;
    }
    return {minutes,days,missing,leave,open};
  }
  function validate(record,day,now=BASE_NOW){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day||"")||!Number.isFinite(+date(day))||iso(date(day))!==day||day<FIRST||day>TODAY)return {ok:false,error:"サンプルの記録期間内の日付を選んでください。"};
    if(!["work","holiday","leave"].includes(record.kind))return {ok:false,error:"勤務区分を選んでください。"};
    const value={kind:record.kind,start:"",end:"",breakMinutes:0,overnight:false,openBreak:null,note:String(record.note||"").slice(0,300)};
    if(record.kind!=="work")return {ok:true,value};
    const start=timeToMin(record.start),end=timeToMin(record.end);
    if(start==null)return {ok:false,error:"出勤時刻を入力してください。"};
    if(record.end&&end==null)return {ok:false,error:"退勤時刻を確認してください。"};
    if(end==null&&day!==TODAY)return {ok:false,error:"過去の勤務には退勤時刻も入力してください。"};
    if(end==null&&start>now)return {ok:false,error:"勤務中の出勤時刻は、現在時刻より前にしてください。"};
    const span=end==null?now-start:end+(record.overnight?1440:0)-start;
    if(span<0)return {ok:false,error:"退勤が翌日の場合は「翌日に退勤」を選んでください。"};
    const rest=Number(record.breakMinutes),check=checkBreakTotal(rest,end==null?null:span);
    if(!check.ok)return check;
    Object.assign(value,{start:record.start,end:record.end||"",breakMinutes:rest,breakMode:"total",overnight:!!record.overnight&&end!=null});
    return {ok:true,value};
  }
  function beforeStartRecord(record){
    if(!record||!["holiday","leave"].includes(record.kind))return null;
    return {kind:record.kind,start:"",end:"",breakMinutes:0,overnight:false,openBreak:null,note:String(record.note||"").slice(0,300)};
  }
  function punch(record,action,now=BASE_NOW,total=record?.kind==="work"?record.breakMinutes:DEFAULT_BREAK){
    const error=message=>({ok:false,error:message});
    if(!["start","end"].includes(action))return error("出勤か退勤を選んでください。");
    if(!Number.isInteger(now)||now<0||now>=1440)return error("現在時刻を確認してください。");
    const started=record?.kind==="work"&&timeToMin(record.start)!=null;
    if(action==="end"&&!started)return error("出勤を記録してから操作してください。");
    const check=checkBreakTotal(total);if(!check.ok)return check;
    const value=started?{...record,breakMinutes:total,breakMode:"total",openBreak:null}:
      {kind:"work",start:"",end:"",breakMinutes:total,breakMode:"total",overnight:false,openBreak:null,breaks:[],note:"",beforeStart:beforeStartRecord(record)};
    value[action]=time(now);
    if(action==="end")value.overnight=false;
    const result=validate(value,TODAY,now);if(!result.ok)return result;
    const updated={...value,overnight:result.value.overnight};
    if(started&&(record.start!==updated.start||record.end!==updated.end||!!record.overnight!==updated.overnight||record.breakMinutes!==updated.breakMinutes))delete updated.breaks;
    delete updated[action+"At"];
    return {ok:true,value:updated};
  }
  function seed(){
    const surnames=["田中","佐藤","鈴木","高橋","伊藤","渡辺","山本","中村","小林","加藤"];
    const given=["花子","美咲","悠斗","結衣","直樹"];
    const employees=Array.from({length:50},(_,i)=>({id:"E"+String(i+1).padStart(3,"0"),name:i===0?"田中 花子":surnames[i%10]+" "+given[Math.floor(i/10)],department:["営業","企画","管理"][i%3]}));
    const records={};
    dates(FIRST,TODAY).forEach((d,di)=>{
      if(!isWorkday(d)||d===TODAY)return;
      employees.forEach((e,i)=>{
        if((di*3+i*7)%43===0)return;
        if((di+i*3)%47===0){records[key(e.id,d)]={kind:"leave",start:"",end:"",breakMinutes:0,overnight:false,openBreak:null,note:""};return;}
        const start=i%7===0?"08:45":"09:00";
        records[key(e.id,d)]={kind:"work",start,end:d===TODAY?"":i%7===0?"17:45":"18:00",breakMinutes:60,overnight:false,openBreak:null,note:""};
      });
    });
    let previous=add(TODAY,-1);while(!isWorkday(previous))previous=add(previous,-1);
    let earlier=add(previous,-1);while(!isWorkday(earlier))earlier=add(earlier,-1);
    delete records[key("E001",earlier)];
    if(previous>=FIRST)records[key("E001",previous)]={kind:"work",start:"09:00",end:"18:00",breakMinutes:60,overnight:false,openBreak:null,note:""};
    return {version:VERSION,seededThrough:TODAY,employees,records,breakDrafts:{},settings:{cutoff:20,pending:null}};
  }
  function hydrate(raw){
    if(!raw||raw.version!==VERSION||!Array.isArray(raw.employees)||raw.employees.length!==50||!raw.records||typeof raw.records!=="object"||!raw.settings||!Number.isInteger(raw.settings.cutoff)||raw.settings.cutoff<0||raw.settings.cutoff>31)return null;
    const fresh=seed(),expected=fresh.employees;
    if(expected.some((e,i)=>raw.employees[i]?.id!==e.id))return null;
    if(raw.settings.pending!=null&&(!Number.isInteger(raw.settings.pending)||raw.settings.pending<0||raw.settings.pending>31))return null;
    for(const [k,r] of Object.entries(raw.records)){
      const [id,d]=k.split("|");
      if(!expected.some(e=>e.id===id)||!/^\d{4}-\d{2}-\d{2}$/.test(d)||!r||!["work","holiday","leave"].includes(r.kind)||typeof r.note!=="string"||!Number.isInteger(r.breakMinutes)||r.breakMinutes<0||r.breakMinutes>1440||r.openBreak!=null&&(!Number.isInteger(r.openBreak)||r.openBreak<0||r.openBreak>=1440))return null;
      if(r.kind==="work"&&(timeToMin(r.start)==null||r.end&&timeToMin(r.end)==null))return null;
    }
    const through=/^\d{4}-\d{2}-\d{2}$/.test(raw.seededThrough||"")?raw.seededThrough:"2026-10-23";
    let records=raw.records;
    if(through<TODAY){
      records={...raw.records};
      for(const [k,record] of Object.entries(fresh.records))if(k.split("|")[1]>through&&!(k in records))records[k]=record;
    }
    // Freeze legacy running breaks at the stored total; never invent an end time.
    records=Object.fromEntries(Object.entries(records).map(([k,r])=>[k,r.kind==="work"?{...r,breakMode:"total",openBreak:null}:r]));
    const breakDrafts={};
    if(raw.breakDrafts&&typeof raw.breakDrafts==="object"&&!Array.isArray(raw.breakDrafts)){
      for(const [k,total] of Object.entries(raw.breakDrafts)){
        const [id,day]=k.split("|");
        if(expected.some(e=>e.id===id)&&/^\d{4}-\d{2}-\d{2}$/.test(day||"")&&day>=FIRST&&day<=TODAY&&Number.isInteger(total)&&total>=0&&total<=1440)breakDrafts[k]=total;
      }
    }
    return {...raw,seededThrough:through>TODAY?through:TODAY,employees:expected,records,breakDrafts};
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
  function exportRows(state,employee,period,now=BASE_NOW,includeFuture=false){
    const days=includeFuture?dates(period.start,period.end).filter(d=>d>=FIRST):visibleDates(period);
    return days.map(d=>{
      if(d>TODAY)return [d,WEEK[weekday(d)],"","","","","",""];
      const r=state.records[key(employee.id,d)],s=status(r,d);
      return [d,WEEK[weekday(d)],statusText(s),r?.start||"",r?.end?r.end+(r.overnight?"（翌日）":""):"",r?.breakMinutes||0,{v:worked(r,d,now)/1440,duration:true},r?.note||""];
    });
  }
  function employeeWorkbook(state,employee,period,now=BASE_NOW){
    return xlsx([{name:"勤怠表",headerRow:5,rows:[["勤怠表（モック）"],["氏名",employee.name],["対象期間",period.start+"〜"+period.end],[],["日付","曜日","区分","出勤","退勤","休憩（分）","実働","メモ"],...exportRows(state,employee,period,now,true)]}]);
  }
  function adminWorkbook(state,employees,period,now=BASE_NOW){
    return xlsx([
      {name:"社員別集計",headerRow:4,rows:[["社員別集計（モック）"],["対象期間",period.start+"〜"+period.end],[],["社員ID","氏名","所属","出勤日数","実働","未入力日数"],...employees.map(e=>{const s=summary(state,e.id,period,now);return [e.id,e.name,e.department,s.days,{v:s.minutes/1440,duration:true},s.missing];})]},
      {name:"日別明細",rows:[["社員ID","氏名","所属","日付","曜日","区分","出勤","退勤","休憩（分）","実働","メモ"],...employees.flatMap(e=>exportRows(state,e,period,now).map(r=>[e.id,e.name,e.department,...r]))]}
    ]);
  }
  return {clockAt,TODAY,FIRST,BASE_NOW,VERSION,WEEK,iso,date,add,weekday,isWorkday,key,dates,visibleDates,monthFor,monthGrid,periodFor,periodAt,nextPeriod,timeToMin,time,duration,shortDuration,DEFAULT_BREAK,parseBreakDuration,breakTotal,setBreakTotal,worked,timeline,status,statusText,summary,validate,punch,seed,hydrate,xml,utf8,crc32,zip,xlsx,employeeWorkbook,adminWorkbook};
});
window.AttendanceCore = window.createAttendanceCore();
