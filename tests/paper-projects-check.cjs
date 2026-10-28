"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const window={},context={window,Intl,Date};vm.createContext(context);
for(const file of ["paper-holidays.js","paper-core.js","paper-repository.js"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../day-designs",file),"utf8"),context);
const C=window.PaperAttendance,R=window.PaperRepository,now={day:"2026-10-28",minutes:1200},day=now.day,period={start:day,end:day};
const plain=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==="object"){Object.freeze(value);Object.values(value).forEach(freeze);}return value;}
function current(mode="local"){
 const state=mode==="local"?C.createState(now,{startDay:"2026-10-01"}):C.seed(now);state.records={};
 state.records[day]={...C.empty(state),start:"09:00",end:"18:00",note:"設計作業",allocation:{P1:2,P2:1,P3:1,P4:1,P5:2,SET:1}};
 state.settings.plannedHoursByMonth={"2026-09":152,"2026-10":160};
 state.submissions[day+"|"+day]={at:"2026-10-28T09:00:00Z",test:true};state.revision=13;
 return state;
}
function legacy(mode="local"){
 const state=current(mode);state.settings.projects.pop();delete state.records[day].allocation.P5;state.records[day].allocation.P1=4;
 state.settings.projects[2].name="既存PJ & 保持";state.settings.projects[2].description="既存の概要";
 return state;
}
function unzip(bytes){
 const buffer=Buffer.from(bytes),entries={};let cursor=0;
 while(buffer.readUInt32LE(cursor)===0x04034b50){const size=buffer.readUInt32LE(cursor+18),nameLength=buffer.readUInt16LE(cursor+26),extra=buffer.readUInt16LE(cursor+28),start=cursor+30+nameLength+extra;entries[buffer.subarray(cursor+30,cursor+30+nameLength).toString()]=buffer.subarray(start,start+size).toString();cursor=start+size;}
 return entries;
}
async function main(){
 assert.deepEqual(plain(C.PROJECTS),["P1","P2","P3","P4","P5","SET"]);
 for(const mode of ["local","demo"]){
  const fresh=mode==="local"?C.createState(now):C.seed(now);
  assert.deepEqual(plain(fresh.settings.projects.map(p=>p.id)),["P1","P2","P3","P4","P5"]);
  assert.equal(C.empty(fresh).allocation.P5,0);assert.equal(C.validateSettings(fresh.settings),"");assert.ok(C.hydrate(fresh,now));
  const original=legacy(mode),before=JSON.stringify(original),restored=C.hydrate(freeze(original),now);
  assert.ok(restored);assert.equal(JSON.stringify(original),before,"legacy hydration cannot mutate its frozen input");
  assert.equal(restored.revision,13);assert.deepEqual(plain(restored.settings.projects.slice(0,4)),plain(original.settings.projects));
  assert.deepEqual(plain(restored.settings.projects[4]),{id:"P5",name:"プロジェクト5",description:""});
  assert.deepEqual(plain(restored.records[day]),{...plain(original.records[day]),allocation:{...plain(original.records[day].allocation),P5:0}});
  for(const key of ["defaults","submissions"])assert.deepEqual(plain(restored[key]),plain(original[key]),"migration retains "+key);
  assert.deepEqual(plain(restored.settings.plannedHoursByMonth),plain(original.settings.plannedHoursByMonth));
  assert.equal(C.summary(restored,C.month(day),now).allocation.SET,1);assert.equal(C.summary(restored,C.month(day),now).allocation.P5,0);
  assert.deepEqual(plain(C.hydrate(restored,now)),plain(restored),"new project metadata and allocations round-trip without another migration");
  const mixed=legacy(mode);mixed.records[day].allocation.P5=.5;mixed.records[day].allocation.P1=3.5;
  assert.equal(C.hydrate(mixed,now).records[day].allocation.P5,.5,"a present valid P5 is retained even with older metadata");
 }
 // Missing legacy P5 alone is safe to add. Explicit corruption or a malformed modern slot is not.
 for(const value of [undefined,null,NaN,Infinity,-1,25,"0",{},.001]){
  const bad=legacy();bad.records[day].allocation.P5=value;assert.equal(C.hydrate(bad,now),null,"explicit invalid legacy P5 must be rejected: "+String(value));
 }
 for(const key of ["P1","P2","P3","P4","SET"]){const bad=legacy();delete bad.records[day].allocation[key];assert.equal(C.hydrate(bad,now),null,"migration cannot invent another missing allocation: "+key);}
 const missingModern=current();delete missingModern.records[day].allocation.P5;assert.equal(C.hydrate(missingModern,now),null);
 for(const mutate of [s=>{s.settings.projects[2].id="P5";},s=>{s.settings.projects[1].name=" ";},s=>{s.settings.plannedHoursByMonth["2026-10"]=undefined;},s=>{s.records[day]=undefined;},s=>{s.submissions[day+"|"+day]=undefined;}]){
  const bad=legacy();mutate(bad);assert.equal(C.hydrate(bad,now),null,"validation must happen before JSON cloning can erase invalid fields");
 }
 const settings=current().settings;settings.projects[4].name="";assert.match(C.validateSettings(settings),/PJ P5/);

 const state=current(),record=state.records[day];
 assert.equal(C.validateRecord(record,day,now,state.settings,{strictAllocation:true}).ok,true);
 assert.equal(C.submissionCheck(state,period,now).ok,true,"P5 and SET both count toward the exact allocation sum");
 const mismatch=C.clone(record);mismatch.allocation.P5=3;
 assert.equal(C.validateRecord(mismatch,day,now,state.settings,{strictAllocation:true}).ok,false);
 assert.equal(C.submissionCheck({...state,records:{[day]:mismatch}},period,now).ok,false);
 const before=JSON.stringify(record),adjusted=C.allocateToP1({...record,end:"19:00"},day,now);
 assert.equal(adjusted.allocation.P1,3);for(const key of ["P2","P3","P4","P5","SET"])assert.equal(adjusted.allocation[key],record.allocation[key]);
 assert.equal(JSON.stringify(record),before,"P1 recalculation does not mutate its input");
 const sum=C.summary(state,period,now);assert.equal(sum.allocation.P5,2);assert.equal(sum.allocation.SET,1);assert.equal(sum.minutes,480);
 const sheets=unzip(C.prepareSubmission(state,period,now).bytes),sheet=sheets["xl/worksheets/sheet1.xml"],config=sheets["xl/worksheets/sheet2.xml"];
 assert.match(sheet,/P5（時間）/);assert.match(sheet,/SET（時間）/);assert.match(sheet,/<c r="N8"[^>]*><v>2<\/v><\/c>/);assert.match(sheet,/<c r="O8"[^>]*><v>1<\/v><\/c>/);
 assert.match(sheet,/<col min="3" max="16" width="15"/,"P5, SET and the compensation source column retain the existing readable width");
 assert.match(config,/>P5<\/t>/);assert.match(config,/プロジェクト5/);

 // The repository keeps the original legacy bytes as its conflict token until an explicit save.
 const key="paper-project-migration-test",raw=JSON.stringify(legacy()),store={raw,writes:0,getItem(requested){assert.equal(requested,key);return this.raw;},setItem(requested,value){assert.equal(requested,key);this.writes++;this.raw=value;}};
 const repo=R.createLocal({key,mode:"local",initialState:()=>C.createState(now),now:()=>now,storage:store,target:null}),loaded=await repo.load();
 assert.equal(store.raw,raw);assert.equal(store.writes,0);assert.equal(loaded.revision,13);await repo.assertCurrent(13);
 const saved=await repo.save(loaded,{expectedRevision:13});assert.equal(saved.revision,14);assert.equal(store.writes,1);assert.equal(saved.records[day].allocation.P5,0);
 assert.equal(saved.records[day].allocation.SET,1);assert.deepEqual(plain(saved.submissions),plain(loaded.submissions));assert.ok(C.hydrate(JSON.parse(store.raw),now));
 const external=JSON.stringify({...JSON.parse(store.raw),revision:14,defaults:{...saved.defaults,note:"別の画面"}});store.raw=external;
 await assert.rejects(()=>repo.save(saved,{expectedRevision:14}),error=>error.code==="conflict");assert.equal(store.raw,external);assert.equal(store.writes,1);
 console.log("Paper projects: independent P5/SET allocations, five project settings, lossless legacy hydration, strict invalid-data rejection, P1 preservation, submission/Excel totals and no-write migration conflicts passed.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
