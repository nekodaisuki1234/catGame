window.AttendanceCore = (function createAttendanceCore(){
  "use strict";
  const TODAY="2026-10-23",FIRST="2026-08-01",BASE_NOW=16*60+30,VERSION=1;
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
  function worked(record,day,now=BASE_NOW){
    if(!record||record.kind!=="work")return 0;
    const start=timeToMin(record.start);
    if(start==null)return 0;
    let end=timeToMin(record.end);
    if(end==null){if(day!==TODAY)return 0;end=now;}else if(record.overnight)end+=1440;
    const extra=record.openBreak!=null&&day===TODAY?Math.max(0,now-record.openBreak):0;
    return Math.max(0,end-start-(Number(record.breakMinutes)||0)-extra);
  }
  function status(record,day){
    if(!record)return isWorkday(day)?"missing":"holiday";
    if(record.kind==="leave")return "leave";
    if(record.kind==="holiday")return "holiday";
    if(record.kind!=="work"||timeToMin(record.start)==null)return "missing";
    if(!record.end)return day===TODAY?(record.openBreak!=null?"break":"working"):"incomplete";
    return "complete";
  }
  const statusText=s=>({missing:"未入力",holiday:"休み",leave:"有休",working:"勤務中",break:"休憩中",incomplete:"退勤未入力",complete:"入力済み"}[s]||"未入力");
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
    if(end==null&&start>now)return {ok:false,error:"勤務中の出勤時刻は、サンプル時刻より前にしてください。"};
    const span=end==null?now-start:end+(record.overnight?1440:0)-start;
    if(span<0)return {ok:false,error:"退勤が翌日の場合は「翌日に退勤」を選んでください。"};
    const rest=Number(record.breakMinutes);
    if(!Number.isInteger(rest)||rest<0||rest>1440)return {ok:false,error:"休憩は0〜1440分の整数で入力してください。"};
    if(rest>span)return {ok:false,error:"休憩時間が勤務の時間幅を超えています。"};
    Object.assign(value,{start:record.start,end:record.end||"",breakMinutes:rest,overnight:!!record.overnight&&end!=null});
    return {ok:true,value};
  }
  function punch(record,action,now=BASE_NOW){
    let r=record?{...record}:null;
    const error=message=>({ok:false,error:message});
    if(action==="start"){
      if(r&&r.kind==="work"&&r.start)return error("本日の出勤は記録済みです。修正画面で変更できます。");
      return {ok:true,value:{kind:"work",start:time(now),end:"",breakMinutes:0,overnight:false,openBreak:null,note:""}};
    }
    if(!r||r.kind!=="work"||timeToMin(r.start)==null)return error("出勤を記録してから操作してください。");
    if(r.end)return error("本日は退勤済みです。修正画面で変更できます。");
    if(now<timeToMin(r.start))return error("出勤時刻より前の打刻はできません。修正画面をご利用ください。");
    if(action==="break"){
      if(r.openBreak!=null)return error("休憩はすでに開始しています。");
      r.openBreak=now;
    }else if(action==="resume"){
      if(r.openBreak==null)return error("開始中の休憩はありません。");
      r.breakMinutes+=Math.max(0,now-r.openBreak);r.openBreak=null;
    }else if(action==="end"){
      if(r.openBreak!=null){r.breakMinutes+=Math.max(0,now-r.openBreak);r.openBreak=null;}
      r.end=time(now);r.overnight=false;
    }else return error("操作を選んでください。");
    return {ok:true,value:r};
  }
  function seed(){
    const surnames=["田中","佐藤","鈴木","高橋","伊藤","渡辺","山本","中村","小林","加藤"];
    const given=["花子","美咲","悠斗","結衣","直樹"];
    const employees=Array.from({length:50},(_,i)=>({id:"E"+String(i+1).padStart(3,"0"),name:i===0?"田中 花子":surnames[i%10]+" "+given[Math.floor(i/10)],department:["営業","企画","管理"][i%3]}));
    const records={};
    dates(FIRST,TODAY).forEach((d,di)=>{
      if(!isWorkday(d))return;
      employees.forEach((e,i)=>{
        if((di*3+i*7)%43===0)return;
        if((di+i*3)%47===0){records[key(e.id,d)]={kind:"leave",start:"",end:"",breakMinutes:0,overnight:false,openBreak:null,note:""};return;}
        const start=i%7===0?"08:45":"09:00";
        records[key(e.id,d)]={kind:"work",start,end:d===TODAY?"":i%7===0?"17:45":"18:00",breakMinutes:60,overnight:false,openBreak:null,note:""};
      });
    });
    delete records[key("E001","2026-10-21")];
    records[key("E001","2026-10-22")]={kind:"work",start:"09:00",end:"18:00",breakMinutes:60,overnight:false,openBreak:null,note:""};
    records[key("E001",TODAY)]={kind:"work",start:"09:00",end:"",breakMinutes:60,overnight:false,openBreak:null,note:""};
    return {version:VERSION,employees,records,settings:{cutoff:20,pending:null}};
  }
  function hydrate(raw){
    if(!raw||raw.version!==VERSION||!Array.isArray(raw.employees)||raw.employees.length!==50||!raw.records||typeof raw.records!=="object"||!raw.settings||!Number.isInteger(raw.settings.cutoff)||raw.settings.cutoff<0||raw.settings.cutoff>31)return null;
    const expected=seed().employees;
    if(expected.some((e,i)=>raw.employees[i]?.id!==e.id))return null;
    if(raw.settings.pending!=null&&(!Number.isInteger(raw.settings.pending)||raw.settings.pending<0||raw.settings.pending>31))return null;
    for(const [k,r] of Object.entries(raw.records)){
      const [id,d]=k.split("|");
      if(!expected.some(e=>e.id===id)||!/^\d{4}-\d{2}-\d{2}$/.test(d)||!r||!["work","holiday","leave"].includes(r.kind)||typeof r.note!=="string"||!Number.isInteger(r.breakMinutes)||r.breakMinutes<0||r.breakMinutes>1440||r.openBreak!=null&&(!Number.isInteger(r.openBreak)||r.openBreak<0||r.openBreak>=1440))return null;
      if(r.kind==="work"&&(timeToMin(r.start)==null||r.end&&timeToMin(r.end)==null))return null;
    }
    return {...raw,employees:expected};
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
  function exportRows(state,employee,period,now=BASE_NOW){
    return visibleDates(period).map(d=>{
      const r=state.records[key(employee.id,d)],s=status(r,d);
      return [d,WEEK[weekday(d)],statusText(s),r?.start||"",r?.end?r.end+(r.overnight?"（翌日）":""):"",r?.breakMinutes||0,{v:worked(r,d,now)/1440,duration:true},r?.note||""];
    });
  }
  function employeeWorkbook(state,employee,period,now=BASE_NOW){
    return xlsx([{name:"勤怠表",headerRow:5,rows:[["勤怠表（モック）"],["氏名",employee.name],["対象期間",period.start+"〜"+period.end],[],["日付","曜日","区分","出勤","退勤","休憩（分）","実働","メモ"],...exportRows(state,employee,period,now)]}]);
  }
  function adminWorkbook(state,employees,period,now=BASE_NOW){
    return xlsx([
      {name:"社員別集計",headerRow:4,rows:[["社員別集計（モック）"],["対象期間",period.start+"〜"+period.end],[],["社員ID","氏名","所属","出勤日数","実働","未入力日数"],...employees.map(e=>{const s=summary(state,e.id,period,now);return [e.id,e.name,e.department,s.days,{v:s.minutes/1440,duration:true},s.missing];})]},
      {name:"日別明細",rows:[["社員ID","氏名","所属","日付","曜日","区分","出勤","退勤","休憩（分）","実働","メモ"],...employees.flatMap(e=>exportRows(state,e,period,now).map(r=>[e.id,e.name,e.department,...r]))]}
    ]);
  }
  return {TODAY,FIRST,BASE_NOW,VERSION,WEEK,iso,date,add,weekday,isWorkday,key,dates,visibleDates,periodFor,periodAt,nextPeriod,timeToMin,time,duration,shortDuration,worked,status,statusText,summary,validate,punch,seed,hydrate,xml,utf8,crc32,zip,xlsx,employeeWorkbook,adminWorkbook};
})();
