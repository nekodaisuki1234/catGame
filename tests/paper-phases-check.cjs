"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const window={},context={window,Intl,Date};vm.createContext(context);
for(const file of ["paper-holidays.js","paper-core.js","paper-repository.js"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../day-designs",file),"utf8"),context);
const C=window.PaperAttendance,R=window.PaperRepository,now={day:"2026-10-30",minutes:1200},day=now.day,period={start:day,end:day};
const plain=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==="object"){Object.freeze(value);Object.values(value).forEach(freeze);}return value;}
function state(mode="local"){
 const value=mode==="local"?C.createState(now,{startDay:"2026-10-01"}):C.seed(now);value.records={};
 value.records[day]={...C.empty(value),start:"09:00",end:"18:00",note:"自由な作業内容 & 設計の確認",allocation:{P1:6,P2:1,P3:0,P4:0,SET:1}};
 value.revision=4;return value;
}
function unzip(bytes){
 const buffer=Buffer.from(bytes),entries={};let cursor=0;
 while(buffer.readUInt32LE(cursor)===0x04034b50){const size=buffer.readUInt32LE(cursor+18),nameLength=buffer.readUInt16LE(cursor+26),extra=buffer.readUInt16LE(cursor+28),start=cursor+30+nameLength+extra;entries[buffer.subarray(cursor+30,cursor+30+nameLength).toString()]=buffer.subarray(start,start+size).toString();cursor=start+size;}return entries;
}

async function main(){
 assert.deepEqual(plain(C.PHASES),[
  {id:"requirements",label:"要件定義"},{id:"design",label:"設計"},{id:"implementation",label:"製造"},{id:"test",label:"テスト"},
  {id:"operations",label:"運用"},{id:"maintenance",label:"保守"},{id:"investigation",label:"調査"},{id:"meeting",label:"管理"}
 ]);
 assert.deepEqual(plain(C.PHASE_IDS),plain(C.PHASES.map(phase=>phase.id)));
 assert.equal(new Set(C.PHASE_IDS).size,C.PHASE_IDS.length);
 for(const mode of ["local","demo"]){
  const current=state(mode),record=current.records[day],empty=C.empty(current),otherEmpty=C.empty(current);
  assert.deepEqual(plain(empty.phases),[]);empty.phases.push("test");assert.deepEqual(plain(otherEmpty.phases),[],"each new record owns its phase array");
  const chosen={...record,phases:["meeting","test","requirements"]},before=JSON.stringify(chosen);
  const checked=C.validateRecord(freeze(chosen),day,now,current.settings,{strictAllocation:true});
  assert.equal(checked.ok,true);assert.deepEqual(plain(checked.value.phases),["meeting","test","requirements"]);
  assert.equal(checked.value.note,record.note);assert.equal(JSON.stringify(chosen),before,"validating a selection cannot modify input text or selection order");
  assert.equal(C.phaseText(chosen),"要件定義・テスト・管理","display/export labels use a stable catalogue order");
  checked.value.phases.push("design");assert.equal(chosen.phases.length,3,"checked records do not share a mutable phase array with the caller");

  const phased=C.clone(current);phased.records[day]=C.clone(chosen);
  const hydrated=C.hydrate(freeze(phased),now);assert.ok(hydrated);assert.deepEqual(plain(hydrated),plain(phased));
  hydrated.records[day].phases.pop();assert.equal(phased.records[day].phases.length,3);
  assert.deepEqual(plain(C.summary(phased,period,now)),plain(C.summary(current,period,now)),"phases are metadata and do not alter time, absence, leave or project totals");
  assert.equal(C.submissionCheck(phased,period,now).ok,true);

  const legacy=C.clone(current);delete legacy.records[day].phases;
  const legacyBytes=JSON.stringify(legacy),loaded=C.hydrate(freeze(legacy),now);
  assert.ok(loaded);assert.equal(Object.hasOwn(loaded.records[day],"phases"),false,"opening an old record does not invent a stored field");
  assert.equal(JSON.stringify(legacy),legacyBytes);assert.equal(loaded.revision,4);assert.equal(C.phaseText(loaded.records[day]),"");
  const normalized=C.validateRecord(legacy.records[day],day,now,current.settings);
  assert.equal(normalized.ok,true);assert.deepEqual(plain(normalized.value.phases),[],"an explicit record save can adopt the new empty field");

  const key="paper-phase-"+mode,storage={raw:legacyBytes,writes:0,getItem(requested){assert.equal(requested,key);return this.raw;},setItem(requested,value){assert.equal(requested,key);this.writes++;this.raw=value;}};
  const repository=R.createLocal({key,mode,initialState:()=>state(mode),now:()=>now,storage,target:null});
  const initial=await repository.load();assert.equal(storage.writes,0);assert.equal(storage.raw,legacyBytes);assert.equal(initial.revision,4);
  const next=C.clone(initial);next.records[day].phases=["design","test"];
  const saved=await repository.save(next,{expectedRevision:4});assert.equal(saved.revision,5);assert.equal(storage.writes,1);
  assert.deepEqual(plain(saved.records[day].phases),["design","test"]);assert.equal(saved.records[day].note,record.note);
  const reloaded=await repository.load();assert.deepEqual(plain(reloaded.records[day].phases),["design","test"]);assert.equal(storage.writes,1);
  reloaded.records[day].phases=[];const cleared=await repository.save(reloaded,{expectedRevision:5});
  assert.deepEqual(plain(cleared.records[day].phases),[]);assert.equal(cleared.records[day].note,record.note);
 }

 // Default phases belong to each person's configuration, never to existing records.
 for(const mode of ["local","demo"]){
  const initial=state(mode),legacy=C.clone(initial);delete legacy.defaults.phases;
  assert.ok(C.hydrate(legacy,now));assert.equal(Object.hasOwn(C.hydrate(legacy,now).defaults,'phases'),false);
  initial.defaults.phases=['design','test'];initial.defaults.note='共通の作業概要';
  const before=JSON.stringify(initial.records),first=C.empty(initial),second=C.empty(initial);
  assert.deepEqual(plain(first.phases),['design','test']);assert.equal(first.note,'共通の作業概要');
  first.phases.push('meeting');assert.deepEqual(plain(second.phases),['design','test']);assert.deepEqual(plain(initial.defaults.phases),['design','test']);
  assert.equal(JSON.stringify(initial.records),before,'editing defaults cannot rewrite existing daily selections or free text');
  for(const phases of [null,undefined,'test',['other'],['test','test'],new Array(1)])assert.equal(C.hydrate({...initial,defaults:{...initial.defaults,phases}},now),null);
 }
 const worked={...C.empty(state()),start:'09:00',end:'18:00',allocation:{P1:6,P2:2,P3:0,P4:0,SET:0},note:'文章とフェーズは残す'};
 for(const leave of ['paid','holiday','special','comp']){
  const off=C.changeLeave(worked,leave,day,now);assert.equal(off.start,'');assert.equal(off.end,'');assert.equal(off.overnight,false);assert.equal(off.note,worked.note);
  assert.deepEqual(plain(off.allocation),{P1:0,P2:0,P3:0,P4:0,SET:0});assert.equal(C.worked(off,day,now),0);
  assert.equal(C.validateRecord(off,day,now,state().settings,{strictAllocation:true}).ok,true);
  const totals=C.summary({...state(),records:{[day]:off}},period,now);assert.equal(totals.minutes,0);assert.equal(totals.days,0);assert.equal(totals.absenceMinutes,0);
  assert.deepEqual(plain(totals.allocation),{P1:0,P2:0,P3:0,P4:0,SET:0});
  const resumed=C.changeLeave(off,'',day,now);assert.equal(C.worked(resumed,day,now),0);assert.equal(resumed.allocation.P1,0);assert.equal(resumed.start,'');assert.equal(resumed.end,'');
 }
 const legacyOff={...worked,leave:'paid',overnight:true,allocation:{P1:0,P2:0,P3:0,P4:0,SET:0}};
 const checkedOff=C.validateRecord(legacyOff,day,now,state().settings);assert.equal(checkedOff.ok,true);assert.equal(checkedOff.value.start,'');assert.equal(checkedOff.value.end,'');assert.equal(checkedOff.value.overnight,false);
 const legacyState={...state(),records:{[day]:legacyOff}},legacyRaw=JSON.stringify(legacyState),loadedOff=C.hydrate(legacyState,now);
 assert.equal(loadedOff.records[day].start,'');assert.equal(loadedOff.records[day].end,'');assert.equal(loadedOff.records[day].overnight,false);assert.equal(JSON.stringify(legacyState),legacyRaw,'normalizing old full-leave times cannot mutate input storage');
 assert.equal(C.changeLeave(legacyOff,'',day,now).start,'','removing legacy full leave cannot resurrect old times');
 const offSheet=unzip(C.workbook(legacyState,period,now))['xl/worksheets/sheet1.xml'];assert.doesNotMatch(offSheet,/09:00|18:00|翌日/,'full-leave exports must omit legacy clock times');
 for(const leave of ['am','pm']){const half=C.changeLeave(worked,leave,day,now);assert.equal(C.worked(half,day,now),480);assert.equal(half.allocation.P2,2);}
 const current=state(),record=current.records[day];
 for(const phases of [undefined,null,"test",{},false,1,["unknown"],["test","test"],["test",null],[undefined],new Array(1),Array(9).fill("test"),["設計"],[{id:"design"}]]){
  const invalid={...record,phases};assert.equal(C.validateRecord(invalid,day,now,current.settings).ok,false,"invalid phase list: "+String(phases));
  assert.equal(C.hydrate({...current,records:{[day]:invalid}},now),null,"hydration validates original phase values before JSON cloning");
  const failed=C.submissionCheck({...current,records:{[day]:invalid}},period,now);assert.equal(failed.ok,false);assert.equal(failed.errors[0].day,day);
 }
 assert.equal(C.validateRecord({...record,phases:[...C.PHASE_IDS]},day,now,current.settings).ok,true);
 const missingNote={...record,note:"　 \t",phases:["design","test"]};
 const noteCheck=C.submissionCheck({...current,records:{[day]:missingNote}},period,now);
 assert.equal(noteCheck.ok,false);assert.match(noteCheck.errors[0].messages.join(" "),/作業内容を入力/);
 assert.equal(C.prepareSubmission({...current,records:{[day]:missingNote}},period,now).bytes,undefined,"phase tags cannot replace the required free text at submission");

 const chosen={...record,phases:["implementation","test"]},original=JSON.stringify(chosen);
 const adjusted=C.allocateToP1({...chosen,end:"19:00"},day,now);
 assert.deepEqual(plain(adjusted.phases),chosen.phases);assert.equal(adjusted.note,chosen.note);assert.equal(adjusted.allocation.P1,7);
 assert.equal(adjusted.allocation.P2,1);assert.equal(adjusted.allocation.SET,1);assert.equal(JSON.stringify(chosen),original);
 const unfinished={...C.empty(current),start:"09:00",phases:["investigation"]};
 assert.equal(C.validateRecord(unfinished,day,now,current.settings,{strictAllocation:true}).ok,true);
 const negative={...chosen,start:"09:00",end:"09:30"};assert.equal(C.validateRecord(negative,day,now,current.settings,{strictAllocation:true}).ok,true);
 assert.equal(C.submissionCheck({...current,records:{[day]:negative}},period,now).ok,false);

 const source="2026-10-24",compDay="2026-10-26",linked=C.clone(current);
 linked.records[source]={...chosen};linked.records[compDay]={...C.empty(current),leave:"comp",sourceDay:source};
 assert.equal(C.validateRecordChange(linked,source,{...chosen,phases:["operations","maintenance"]},now).ok,true);
 assert.equal(C.validateRecordChange(linked,source,null,now).ok,false,"metadata selection does not bypass linked source protection");

 const phased=C.clone(current);phased.records[day].phases=["meeting","test","requirements"];
 const sheet=unzip(C.prepareSubmission(phased,period,now).bytes)["xl/worksheets/sheet1.xml"];
 assert.match(sheet,/<c r="P7"[^>]*><is><t[^>]*>フェーズ<\/t><\/is><\/c>/);
 assert.match(sheet,/<c r="P8"[^>]*><is><t[^>]*>要件定義・テスト・管理<\/t><\/is><\/c>/);
 assert.match(sheet,/<c r="I8"[^>]*><is><t[^>]*>自由な作業内容 &amp; 設計の確認<\/t><\/is><\/c>/);
 assert.match(sheet,/<c r="N8"[^>]*><v>1<\/v><\/c>/,"SET hours retain their existing column");
 assert.match(sheet,/<col min="3" max="16" width="15"/);
 const legacy=C.clone(current);delete legacy.records[day].phases;
 assert.match(unzip(C.workbook(legacy,period,now))["xl/worksheets/sheet1.xml"],/<c r="P8"[^>]*><is><t[^>]*><\/t><\/is><\/c>/);
 const future=C.add(day,1);phased.records[future]={...chosen};
 assert.match(unzip(C.workbook(phased,{start:future,end:future},now))["xl/worksheets/sheet1.xml"],/<c r="P8"[^>]*><is><t[^>]*><\/t><\/is><\/c>/,"future record metadata is not included before the day arrives");
 console.log("Paper phases: multi-select metadata, optional legacy load, strict original-value validation, persistence/clearing, free-text submission, independent time/comp rules and appended Excel phase column passed.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
