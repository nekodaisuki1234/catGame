"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const context={window:{},Intl,Date};vm.createContext(context);
for(const file of ["paper-holidays.js","paper-core.js"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../day-designs",file),"utf8"),context);
const C=context.window.PaperAttendance,now={day:"2026-10-28",minutes:1200},plain=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==="object"){Object.freeze(value);Object.values(value).forEach(freeze);}return value;}
function sheets(state,period=C.month(now.day)){
 const buffer=Buffer.from(C.workbook(state,period,now)),entries={};let cursor=0;
 while(buffer.readUInt32LE(cursor)===0x04034b50){
  const size=buffer.readUInt32LE(cursor+18),nameLength=buffer.readUInt16LE(cursor+26),extra=buffer.readUInt16LE(cursor+28),start=cursor+30+nameLength+extra;
  const name=buffer.subarray(cursor+30,cursor+30+nameLength).toString();entries[name]=buffer.subarray(start,start+size).toString();cursor=start+size;
 }
 return entries;
}
const local=C.createState(now),demo=C.seed(now);
assert.equal(local.mode,"local");assert.equal(C.isDemo(local),false);assert.equal(C.firstDay(local),now.day);
assert.deepEqual(plain(local.records),{});assert.deepEqual(plain(local.submissions),{});
assert.deepEqual(plain(C.employee(local)),{name:"",department:"",id:""});
assert.deepEqual(plain(local.defaults),{locationId:"place1",note:"",breakMinutes:60});
assert.equal(local.settings.workSummary,"");assert.deepEqual(plain(local.settings.plannedHoursByMonth),{});
assert.equal(C.validateSettings(local.settings),"");assert.ok(C.hydrate(local,now));
assert.doesNotMatch(JSON.stringify(local),/田中|花子|E001|TIS|クロノス|デビプリ|アプラス|千葉銀行|ことら送金|テスト対応/);
assert.equal(C.summary(local,C.fiscalPeriod(now.day),now).minutes,0);
assert.deepEqual(plain(C.pastMissing(local,now)),[],"new local state has no invented past attendance gaps");
assert.deepEqual(plain(C.missing(local,C.month(now.day),now)),[now.day]);
assert.deepEqual(plain(C.submissionCheck(local,C.month(now.day),now).errors.map(error=>error.day)),[now.day],"submission validation begins on the configured first day");
const localSheets=sheets(local),localXml=localSheets["xl/worksheets/sheet1.xml"];
assert.match(localXml,/勤怠表/);assert.match(localXml,/記録開始前/);
assert.doesNotMatch(Object.values(localSheets).join(""),/操作デモ|田中|花子|E001|TIS|クロノス|デビプリ|アプラス|千葉銀行|ことら送金|テスト対応/);

const identity={name:'佐藤 & <花子>',department:"設計",id:"S002"},custom=C.createState(now,{startDay:"2026-10-26",employee:identity});
identity.name="変更後";
assert.equal(C.employee(custom).name,'佐藤 & <花子>',"initial state owns a separate employee object");
assert.deepEqual(plain(C.pastMissing(custom,now)),["2026-10-26","2026-10-27"]);
assert.deepEqual(plain(C.missing(custom,C.month(now.day),now)),["2026-10-26","2026-10-27","2026-10-28"]);
assert.match(sheets(custom)["xl/worksheets/sheet1.xml"],/佐藤 &amp; &lt;花子&gt;/,"Excel uses the configured employee with XML escaping");
const complete={...C.empty(custom),start:"09:00",end:"18:00",note:"設計",allocation:{P1:8,P2:0,P3:0,P4:0,P5:0,SET:0}};
for(const day of ["2026-10-25","2026-02-30","2026-10-29"]){
 assert.equal(C.validateRecord(complete,day,now,custom.settings).ok,false,"record outside the local date boundary: "+day);
 assert.equal(C.validateRecordChange(custom,day,complete,now).ok,false);
 assert.equal(C.validateRecordChange(custom,day,null,now).ok,false);
}
assert.equal(C.validateRecord(complete,"2026-10-26",now,custom.settings).ok,true);
assert.equal(C.validateRecordChange(custom,"2026-10-26",complete,now).ok,true);
const filled=C.clone(custom);for(const day of ["2026-10-26","2026-10-27",now.day])filled.records[day]=C.clone(complete);
assert.equal(C.submissionCheck(filled,C.month(now.day),now).ok,true,"missing pre-start days do not block submission");
assert.equal(C.prepareSubmission(filled,C.month(now.day),now).ok,true);
assert.equal(C.submissionCheck(filled,{start:"2026-10-01",end:"2026-10-25"},now).ok,false,"an entirely pre-start period cannot be submitted");

// Local start dates also permit real records older than the former fixed demo start.
const historical=C.createState(now,{startDay:"2026-03-28"}),source="2026-03-28",compDay="2026-03-30";
historical.records[source]={...C.empty(historical),start:"09:00",end:"18:00",note:"休日出勤",allocation:{P1:8,P2:0,P3:0,P4:0,P5:0,SET:0}};
assert.equal(C.validateRecord(historical.records[source],source,now,historical.settings).ok,true);
assert.deepEqual(plain(C.compSources(historical,compDay,now)),[source],"compensatory sources use the configured start date");
const comp={...C.empty(historical),leave:"comp",sourceDay:source};
assert.equal(C.validateRecordChange(historical,compDay,comp,now).ok,true);
historical.records[compDay]=comp;
assert.ok(C.hydrate(historical,now),"local history before the old FIRST boundary survives hydration");
const clipped=C.clone(historical);clipped.settings.attendanceStartDay="2026-03-29";
assert.equal(C.hydrate(clipped,now),null,"invalid pre-start history is rejected without deleting records");
assert.deepEqual(plain(C.compSources(clipped,compDay,now)),[]);
assert.equal(C.validateRecord(comp,compDay,now,clipped.settings).ok,false,"comp source dates respect the same boundary");
assert.equal(C.validateRecordChange(clipped,compDay,comp,now).ok,false);

const saved=C.clone(filled);saved.revision=7;saved.submissions["2026-10-01|2026-10-31"]={at:"2026-10-28T10:00:00Z",test:false};
const before=JSON.stringify(saved),restored=C.hydrate(freeze(saved),now);
assert.deepEqual(plain(restored),plain(saved),"local metadata, records and submissions round-trip without migration");
assert.equal(JSON.stringify(saved),before,"hydration does not mutate stored data");
assert.notEqual(restored,saved);assert.notEqual(restored.settings,saved.settings);assert.notEqual(restored.settings.employee,saved.settings.employee);assert.notEqual(restored.records,saved.records);
restored.settings.employee.name="別の人";restored.records[now.day].note="別の作業";
assert.equal(saved.settings.employee.name,'佐藤 & <花子>');assert.equal(saved.records[now.day].note,"設計");
for(const remove of ["attendanceStartDay","employee"]){const raw=C.clone(local);delete raw.settings[remove];assert.equal(C.hydrate(raw,now),null,"local mode requires "+remove);}
for(const value of [null,"",false,"2026-02-30","2026-10"]){const raw=C.clone(local);raw.settings.attendanceStartDay=value;assert.match(C.validateSettings(raw.settings),/記録開始日/);assert.equal(C.hydrate(raw,now),null);}
for(const value of [null,[],"佐藤",{}, {name:"佐藤",department:"設計"},{name:"佐藤",department:"設計",id:2},{name:"a".repeat(81),department:"",id:""},{name:"",department:"a".repeat(81),id:""},{name:"",department:"",id:"a".repeat(81)}]){
 const raw=C.clone(local);raw.settings.employee=value;assert.match(C.validateSettings(raw.settings),/氏名/);assert.equal(C.hydrate(raw,now),null);
}
for(const mode of ["production","",null,0])assert.equal(C.hydrate({...local,mode},now),null,"unknown modes must not hydrate");
assert.throws(()=>C.createState(now,{startDay:"2026-02-30"}),/記録開始日/);
assert.throws(()=>C.createState(now,{employee:{name:"佐藤"}}),/氏名/);
assert.deepEqual(plain(C.employee({mode:"local",settings:{employee:{name:"佐藤"}}})),{name:"佐藤",department:"",id:""},"local helper never fills missing identity fields from the demo");
assert.deepEqual(plain(C.employee({mode:"local"})),{name:"",department:"",id:""});

assert.equal(C.isDemo(demo),true);assert.equal(C.firstDay(demo),C.FIRST);assert.ok(Object.keys(demo.records).length>0);
assert.deepEqual(plain(C.employee(demo)),{name:"田中 花子",department:"営業",id:"E001"});
const legacy=C.clone(demo);delete legacy.mode;delete legacy.settings.attendanceStartDay;delete legacy.settings.employee;
const legacyBefore=JSON.stringify(legacy),legacyRestored=C.hydrate(freeze(legacy),now);
assert.ok(legacyRestored);assert.equal(C.isDemo(legacyRestored),true);assert.equal(C.firstDay(legacyRestored),C.FIRST);
assert.deepEqual(plain(legacyRestored),plain(legacy),"legacy records, defaults, submissions and settings remain intact");
assert.equal(JSON.stringify(legacy),legacyBefore);assert.equal(legacyRestored.mode,undefined,"hydration does not silently rewrite the legacy mode");
assert.deepEqual(plain(C.employee(legacyRestored)),{name:"田中 花子",department:"営業",id:"E001"});
const emptyLegacy=C.clone(legacyRestored);emptyLegacy.records={};
assert.equal(C.pastMissing(emptyLegacy,now)[0],C.FIRST,"legacy missing attendance keeps the former start date");
assert.equal(C.missing(emptyLegacy,{start:"2026-03-01",end:"2026-04-02"},now).join(),"2026-04-01,2026-04-02");
assert.equal(C.validateRecord(complete,"2026-03-31",now,legacy.settings).ok,false);
const demoXml=sheets(legacyRestored)["xl/worksheets/sheet1.xml"];
assert.match(demoXml,/勤怠表（A. Paper 操作デモ）/);assert.match(demoXml,/田中 花子/);
assert.equal(Object.keys(local.records).length,0,"creating or hydrating demo data does not populate local state");
console.log("Paper initialization: isolated empty local state, configurable start, employee metadata, legacy hydration and XLSX checks passed.");
