"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const window={},context={window,Intl,Date};vm.createContext(context);
for(const file of ["paper-holidays.js","paper-core.js","paper-repository.js"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../day-designs",file),"utf8"),context);
const C=window.PaperAttendance,R=window.PaperRepository,now={day:"2026-10-28",minutes:1200},day=now.day,period={start:day,end:day};
const plain=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==="object"){Object.freeze(value);Object.values(value).forEach(freeze);}return value;}
function current(mode="local"){
 const state=mode==="local"?C.createState(now,{startDay:"2026-10-01"}):C.seed(now);state.records={};
 state.records[day]={...C.empty(state),start:"09:00",end:"18:00",note:"設計作業",allocation:{P1:2,P2:1,P3:1,P4:1,SET:3}};
 state.settings.plannedHoursByMonth={"2026-09":152,"2026-10":160};state.submissions[day+"|"+day]={at:"2026-10-28T09:00:00Z",test:true};state.revision=13;return state;
}
function oldFour(mode="local"){
 const state=current(mode);state.settings.projects.pop();state.settings.projects[2].name="既存PJ & 保持";state.settings.projects[2].description="既存の概要";return state;
}
function shortLivedSix(mode="local"){
 const state=current(mode);state.settings.projects[4]={id:"P5",name:"独自の第五名称",description:"入力した概要を保持"};
 state.records[day].allocation={P1:2,P2:1,P3:1,P4:1,P5:2,SET:1};return state;
}
function unzip(bytes){
 const buffer=Buffer.from(bytes),entries={};let cursor=0;
 while(buffer.readUInt32LE(cursor)===0x04034b50){const size=buffer.readUInt32LE(cursor+18),nameLength=buffer.readUInt16LE(cursor+26),extra=buffer.readUInt16LE(cursor+28),start=cursor+30+nameLength+extra;entries[buffer.subarray(cursor+30,cursor+30+nameLength).toString()]=buffer.subarray(start,start+size).toString();cursor=start+size;}return entries;
}
async function main(){
 assert.deepEqual(plain(C.PROJECTS),["P1","P2","P3","P4","SET"]);
 for(const mode of ["local","demo"]){
  const fresh=mode==="local"?C.createState(now):C.seed(now);
  assert.deepEqual(plain(fresh.settings.projects.map(p=>p.id)),["P1","P2","P3","P4","SET"]);assert.equal(fresh.settings.projects[4].name,"SET");
  assert.deepEqual(plain(C.empty(fresh).allocation),{P1:0,P2:0,P3:0,P4:0,SET:0});assert.equal(C.validateSettings(fresh.settings),"");assert.ok(C.hydrate(fresh,now));
  const canonical=current(mode);assert.deepEqual(plain(C.hydrate(freeze(canonical),now)),plain(canonical),"canonical data round-trips without another migration");
  for(const original of [oldFour(mode),shortLivedSix(mode)]){
   const before=JSON.stringify(original),restored=C.hydrate(freeze(original),now);assert.ok(restored);assert.equal(JSON.stringify(original),before,"hydration cannot mutate its frozen input");
   assert.equal(restored.revision,13);assert.deepEqual(plain(restored.settings.projects.slice(0,4)),plain(original.settings.projects.slice(0,4)));
   assert.equal(restored.settings.projects[4].id,"SET");assert.equal(restored.records[day].allocation.SET,3);assert.equal(Object.hasOwn(restored.records[day].allocation,"P5"),false);
   assert.equal(Object.hasOwn(restored.records[day],"legacyProjectAllocation"),false,"ordinary totals need no overflow snapshot");
   assert.deepEqual(plain(restored.records[day]),{...plain(original.records[day]),allocation:{P1:2,P2:1,P3:1,P4:1,SET:3}});
   for(const key of ["defaults","submissions"])assert.deepEqual(plain(restored[key]),plain(original[key]),"migration retains "+key);
   assert.deepEqual(plain(restored.settings.plannedHoursByMonth),plain(original.settings.plannedHoursByMonth));
   if(original.settings.projects.length===5){assert.equal(restored.settings.projects[4].name,"独自の第五名称");assert.equal(restored.settings.projects[4].description,"入力した概要を保持");}
   else assert.deepEqual(plain(restored.settings.projects[4]),{id:"SET",name:"SET",description:""});
   assert.deepEqual(plain(C.hydrate(restored,now)),plain(restored),"merged hours never get counted twice on a second load");
   assert.equal(C.summary(restored,period,now).allocation.SET,3);assert.equal(C.summary(restored,period,now).minutes,480);
  }
 }
 // Every source value is validated before cloning or summing; invalid values are never replaced by zero.
 for(const source of ["P5","SET"]){
  for(const value of [undefined,null,NaN,Infinity,-1,25,"0",{},.001]){const bad=shortLivedSix();bad.records[day].allocation[source]=value;assert.equal(C.hydrate(bad,now),null,"invalid source "+source+": "+String(value));}
 }
 for(const key of ["P1","P2","P3","P4","SET"]){const bad=oldFour();delete bad.records[day].allocation[key];assert.equal(C.hydrate(bad,now),null,"migration cannot invent a missing original allocation: "+key);}
 for(const key of ["P5","SET"]){const bad=shortLivedSix();delete bad.records[day].allocation[key];assert.equal(C.hydrate(bad,now),null,"a missing published six-slot bucket is corruption: "+key);}
 const stray=current();stray.records[day].allocation.P5=0;assert.equal(C.hydrate(stray,now),null,"modern data cannot silently ignore an extra P5 bucket");
 const absent=current();delete absent.records[day].allocation.SET;assert.equal(C.hydrate(absent,now),null);
 for(const mutate of [s=>{s.settings.projects[2].id="SET";},s=>{s.settings.projects[1].name=" ";},s=>{s.settings.plannedHoursByMonth["2026-10"]=undefined;},s=>{s.records[day]=undefined;},s=>{s.submissions[day+"|"+day]=undefined;}]){
  const bad=oldFour();mutate(bad);assert.equal(C.hydrate(bad,now),null,"validation must happen before JSON cloning erases invalid values");
 }
 const precision=shortLivedSix();precision.records[day].allocation.P5=1/60;precision.records[day].allocation.SET=2/60;
 assert.equal(C.hydrate(precision,now).records[day].allocation.SET,3/60,"merging uses exact minute sums");
 const settings=current().settings;settings.projects[4].name="";assert.match(C.validateSettings(settings),/PJ SET/);

 // A legacy-only snapshot preserves an otherwise valid 48-hour combined value without widening fresh input limits.
 const oversized=shortLivedSix();Object.assign(oversized.records[day],{end:"",allocation:{P1:0,P2:0,P3:0,P4:0,P5:24,SET:24}});
 const overflow=C.hydrate(oversized,now),over=overflow.records[day];assert.equal(over.allocation.SET,48);assert.deepEqual(plain(over.legacyProjectAllocation),{P5:24,SET:24});
 assert.equal(C.allocationMax(over,"SET"),48);assert.equal(C.allocationMax(over,"P1"),24);assert.equal(C.allocationMax(current().records[day],"SET"),24);
 assert.equal(C.validateRecord(over,day,now,overflow.settings).ok,true);assert.deepEqual(plain(C.hydrate(overflow,now)),plain(overflow));
 const freshTooLarge=current();freshTooLarge.records[day].allocation.SET=25;assert.equal(C.hydrate(freshTooLarge,now),null,"fresh input still has the 24-hour limit");
 for(const snapshot of [null,{},[],{P5:24,SET:23},{P5:25,SET:23},{P5:24,SET:undefined},{P5:24,SET:24,extra:0}]){
  const bad=C.clone(overflow);bad.records[day].legacyProjectAllocation=snapshot;assert.equal(C.hydrate(bad,now),null,"an invalid historical source cannot grant a wider input limit");
 }
 const corrected=C.clone(over);corrected.allocation.SET=3;delete corrected.legacyProjectAllocation;assert.equal(C.validateRecord(corrected,day,now,overflow.settings).ok,true);

 const state=current(),record=state.records[day];assert.equal(C.validateRecord(record,day,now,state.settings,{strictAllocation:true}).ok,true);assert.equal(C.submissionCheck(state,period,now).ok,true);
 const mismatch=C.clone(record);mismatch.allocation.SET=4;assert.equal(C.validateRecord(mismatch,day,now,state.settings,{strictAllocation:true}).ok,false);assert.equal(C.submissionCheck({...state,records:{[day]:mismatch}},period,now).ok,false);
 const before=JSON.stringify(record),adjusted=C.allocateToP1({...record,end:"19:00"},day,now);assert.equal(adjusted.allocation.P1,3);
 for(const key of ["P2","P3","P4","SET"])assert.equal(adjusted.allocation[key],record.allocation[key]);assert.equal(JSON.stringify(record),before);
 const sheets=unzip(C.prepareSubmission(state,period,now).bytes),sheet=sheets["xl/worksheets/sheet1.xml"],config=sheets["xl/worksheets/sheet2.xml"];
 assert.doesNotMatch(sheet,/P5（時間）/);assert.match(sheet,/SET（時間）/);assert.match(sheet,/<c r="N8"[^>]*><v>3<\/v><\/c>/);assert.match(sheet,/<col min="3" max="16" width="15"/);assert.match(config,/>SET<\/t>/);

 // Exact legacy bytes and revisions stay untouched until an explicit save; conflicts remain protected.
 for(const initial of [oldFour(),shortLivedSix(),oversized]){
  const key="paper-project-migration-test",raw=JSON.stringify(initial),store={raw,writes:0,getItem(requested){assert.equal(requested,key);return this.raw;},setItem(requested,value){assert.equal(requested,key);this.writes++;this.raw=value;}};
  const repo=R.createLocal({key,mode:"local",initialState:()=>C.createState(now),now:()=>now,storage:store,target:null}),loaded=await repo.load();
  assert.equal(store.raw,raw);assert.equal(store.writes,0);assert.equal(loaded.revision,13);await repo.assertCurrent(13);
  const saved=await repo.save(loaded,{expectedRevision:13});assert.equal(saved.revision,14);assert.equal(store.writes,1);assert.equal(saved.records[day].allocation.SET,initial===oversized?48:3);assert.equal(Object.hasOwn(saved.records[day].allocation,"P5"),false);
  assert.deepEqual(plain(saved.submissions),plain(loaded.submissions));assert.ok(C.hydrate(JSON.parse(store.raw),now));
  const external=JSON.stringify({...JSON.parse(store.raw),revision:14,defaults:{...saved.defaults,note:"別の画面"}});store.raw=external;
  await assert.rejects(()=>repo.save(saved,{expectedRevision:14}),error=>error.code==="conflict");assert.equal(store.raw,external);assert.equal(store.writes,1);
 }
 console.log("Paper projects: five P1–P4/SET buckets, lossless old and six-slot hydration, bounded legacy overflow, strict source validation, P1 preservation, submission/Excel totals and no-write migration conflicts passed.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
