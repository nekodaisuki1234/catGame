"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const context={window:{},Intl,Date};vm.createContext(context);
for(const file of ["paper-holidays.js","paper-core.js","paper-repository.js"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../day-designs",file),"utf8"),context);
const C=context.window.PaperAttendance,R=context.window.PaperRepository,now={day:"2026-10-27",minutes:1260,full:"21:00:00"},DAY=now.day,AT="2026-10-27T12:00:00.000Z";
const plain=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==="object"){Object.freeze(value);Object.values(value).forEach(freeze);}return value;}
function initial(mode="local"){
 const state=mode==="local"?C.createState(now,{startDay:"2026-10-01"}):C.seed(now);
 state.records={};state.submissions={};state.revision=4;return state;
}
function work(state,changes={}){return {...C.empty(state),start:"09:00",end:"18:00",note:"入力済みの作業内容",phases:["design","meeting"],allocation:{P1:6,P2:2,P3:0,P4:0,SET:0},...changes};}
const input=(changes={})=>({id:"lr-request-1",day:DAY,leave:"paid",sourceDay:"",requestedAt:AT,...changes});
const prepare=(state,changes={},clock=now)=>C.prepareLeaveRequest(state,input(changes),clock);
const receipt=(changes={})=>({...input(changes),delivery:"local"});

async function main(){
 for(const mode of ["local","demo"]){
  const state=initial(mode);state.records[DAY]=work(state);state.records["2026-10-26"]=work(state);
  state.submissions={"2026-10-01|2026-10-31":{at:AT,test:true},"2026-09-01|2026-09-30":{at:AT,test:true}};
  const before=JSON.stringify(state),result=prepare(freeze(state));assert.equal(result.ok,true,result.error);
  assert.equal(JSON.stringify(state),before,"preparing a request must not change the live records or storage snapshot");
  assert.equal(result.value.revision,4,"the repository owns revision increments");
  assert.equal(result.record.leave,"paid");assert.equal(result.record.start,"");assert.equal(result.record.end,"");assert.equal(result.record.overnight,false);
  assert.deepEqual(plain(result.record.allocation),{P1:0,P2:0,P3:0,P4:0,SET:0});assert.equal(result.record.note,state.records[DAY].note);assert.deepEqual(plain(result.record.phases),["design","meeting"]);
  assert.deepEqual(plain(result.value.records["2026-10-26"]),plain(state.records["2026-10-26"]));
  assert.deepEqual(plain(result.value.leaveRequests),{"lr-request-1":receipt()});assert.equal(result.request.delivery,"local");assert.deepEqual(plain(result.warnings),[]);
  assert.equal(Object.hasOwn(result.value.submissions,"2026-10-01|2026-10-31"),false);assert.equal(Object.hasOwn(result.value.submissions,"2026-09-01|2026-09-30"),true);
  assert.equal(C.summary(result.value,{start:DAY,end:DAY},now).leave,1);assert.equal(C.summary(result.value,{start:DAY,end:DAY},now).minutes,0);
  assert.ok(C.hydrate(result.value,now));assert.equal(prepare(result.value).ok,false,"a receipt ID cannot be overwritten or sent twice at the same revision");
  result.request.leave="special";result.record.phases.push("test");assert.equal(result.value.leaveRequests["lr-request-1"].leave,"paid");assert.deepEqual(plain(result.value.records[DAY].phases),["design","meeting"]);

  // The receipt and attendance live in the same whole-state transaction, including quota failures.
  const storage={raw:before,writes:0,fail:false,getItem(){return this.raw;},setItem(key,value){if(this.fail)throw Error("quota");this.writes++;this.raw=value;}},key="request-"+mode;
  const repository=R.createLocal({key,mode,initialState:()=>initial(mode),now:()=>now,storage,target:null});
  await repository.load();assert.equal(storage.writes,0);
  const atomic=prepare(state);storage.fail=true;await assert.rejects(repository.save(atomic.value,{expectedRevision:4}));assert.equal(storage.raw,before);assert.equal(storage.writes,0);
  storage.fail=false;const saved=await repository.save(atomic.value,{expectedRevision:4});assert.equal(saved.revision,5);assert.equal(storage.writes,1);
  const loaded=await repository.load();assert.equal(loaded.records[DAY].start,"");assert.equal(loaded.leaveRequests["lr-request-1"].delivery,"local");assert.equal(storage.writes,1);
  const rawSaved=storage.raw,stale=prepare(loaded,{id:"lr-stale",leave:"holiday"});
  storage.raw=JSON.stringify({...plain(loaded),revision:6});await assert.rejects(repository.save(stale.value,{expectedRevision:5}));assert.notEqual(storage.raw,rawSaved);assert.equal(JSON.parse(storage.raw).leaveRequests["lr-stale"],undefined,"a conflict cannot add only the receipt or only the leave record");
 }

 // Half-days and running or negative work retain the existing attendance rules.
 for(const leave of ["am","pm"]){
  const state=initial();state.records[DAY]=work(state,{end:"14:00",allocation:{P1:3,P2:1,P3:0,P4:0,SET:0}});
  const half=prepare(state,{leave});assert.equal(half.ok,true,half.error);assert.equal(half.record.start,"09:00");assert.equal(half.record.end,"14:00");assert.equal(half.record.allocation.P2,1);assert.equal(C.absenceMinutes(half.record,DAY,now),0);
  const running=initial();running.records[DAY]=work(running,{end:"",allocation:{P1:0,P2:2,P3:0,P4:0,SET:0}});assert.equal(prepare(running,{leave}).ok,true);
  const negative=initial();negative.records[DAY]=work(negative,{end:"09:30",allocation:{P1:0,P2:0,P3:0,P4:0,SET:0}});const saved=prepare(negative,{leave});assert.equal(saved.ok,true);assert.match(saved.warnings.join(),/マイナス|−0時間30分/);assert.equal(C.submissionCheck(saved.value,{start:DAY,end:DAY},now).ok,false);
 }
 for(const leave of ["paid","holiday","special"]){const state=initial();state.records[DAY]=work(state,{overnight:true});const result=prepare(state,{leave});assert.equal(result.ok,true);assert.equal(result.record.start,"");assert.equal(result.record.end,"");assert.equal(result.record.overnight,false);}

 // Day-editor snapshots and their receipt commit together, without replacing the baseline used by link validation.
 for(const mode of ["local","demo"]){
  const state=initial(mode);state.records[DAY]=work(state);state.records["2026-10-26"]=work(state);
  const before=JSON.stringify(state),snapshot=work(state,{start:"10:00",end:"15:00",leave:"am",locationId:"place3",note:"勤怠編集から送信した文章",phases:["investigation","meeting"],allocation:{P1:2,P2:1,P3:1,P4:0,SET:0}}),originalSnapshot=JSON.stringify(snapshot);
  const edited=C.prepareLeaveRequest(freeze(state),input({id:"lr-editor",leave:"am"}),now,{record:freeze(snapshot),strictAllocation:true});assert.equal(edited.ok,true,edited.error);
  assert.equal(JSON.stringify(state),before);assert.equal(JSON.stringify(snapshot),originalSnapshot);
  assert.deepEqual(plain(edited.record),plain(snapshot));assert.deepEqual(plain(edited.value.records[DAY]),plain(snapshot));assert.equal(edited.value.leaveRequests["lr-editor"].leave,"am");
  assert.deepEqual(plain(edited.value.records["2026-10-26"]),plain(state.records["2026-10-26"]));assert.equal(edited.value.revision,4);
  const storage={raw:before,fail:true,getItem(){return this.raw;},setItem(key,value){if(this.fail)throw Error("quota");this.raw=value;}},repository=R.createLocal({key:"edited-request-"+mode,mode,initialState:()=>initial(mode),now:()=>now,storage,target:null});
  await repository.load();await assert.rejects(repository.save(edited.value,{expectedRevision:4}));assert.equal(storage.raw,before,"a failed editor send cannot save only metadata, allocations or the request receipt");
  storage.fail=false;const saved=await repository.save(edited.value,{expectedRevision:4});assert.equal(saved.revision,5);assert.equal(saved.records[DAY].note,snapshot.note);assert.deepEqual(plain(saved.records[DAY].allocation),plain(snapshot.allocation));assert.equal(saved.leaveRequests["lr-editor"].delivery,"local");
  const mismatch={...plain(snapshot),end:"16:00"};
  for(const options of [{record:mismatch,strictAllocation:true},{record:mismatch}]){const result=C.prepareLeaveRequest(state,input({leave:"am"}),now,options);assert.equal(result.ok,false);assert.match(result.error,/工数合計/);assert.equal(JSON.stringify(state),before);}
  for(const options of [null,[],{unknown:true},{record:undefined},{record:null},{record:[]},{record:snapshot,strictAllocation:false},{record:snapshot,strictAllocation:undefined},{record:{...plain(snapshot),leave:"paid"},strictAllocation:true}])assert.equal(C.prepareLeaveRequest(state,input({leave:"am"}),now,options).ok,false,"invalid snapshot/options must not fall back to saved attendance");
  const falseFull=work(state,{leave:"paid"});assert.equal(C.prepareLeaveRequest(state,input(),now,{record:falseFull,strictAllocation:true}).ok,false,"full-day conversion cannot hide invalid positive snapshot allocations");
  const explicitFull=work(state,{leave:"paid",allocation:{P1:0,P2:0,P3:0,P4:0,SET:0},note:"編集した全休のメモ"}),full=C.prepareLeaveRequest(state,input(),now,{record:explicitFull,strictAllocation:true});assert.equal(full.ok,true,full.error);assert.equal(full.record.start,"");assert.equal(full.record.end,"");assert.equal(full.record.note,explicitFull.note);
  const resumed=work(state,{leave:"",note:"全休を解除して新しく入力した時刻"}),withdrawn=C.prepareLeaveRequest(full.value,input({id:"lr-edited-withdrawal",leave:""}),now,{record:resumed,strictAllocation:true});assert.equal(withdrawn.ok,true,withdrawn.error);assert.equal(withdrawn.record.start,"09:00");assert.equal(withdrawn.record.end,"18:00");assert.equal(withdrawn.record.note,resumed.note);assert.equal(withdrawn.value.leaveRequests["lr-edited-withdrawal"].leave,"");
  const running=work(state,{leave:"am",end:"",allocation:{P1:0,P2:2,P3:0,P4:0,SET:0}});assert.equal(C.prepareLeaveRequest(state,input({leave:"am"}),now,{record:running,strictAllocation:true}).ok,true);
  const negative=work(state,{leave:"am",end:"09:30",allocation:{P1:0,P2:0,P3:0,P4:0,SET:0}}),savedNegative=C.prepareLeaveRequest(state,input({leave:"am"}),now,{record:negative,strictAllocation:true});assert.equal(savedNegative.ok,true);assert.match(savedNegative.warnings.join(),/マイナス|−0時間30分/);
 }

 // Comp links are validated on application; old receipts are historical, not permanent locks.
 const state=initial(),SOURCE="2026-10-24";state.records[SOURCE]=work(state);state.records[DAY]=work(state);
 const linked=prepare(state,{leave:"comp",sourceDay:SOURCE});assert.equal(linked.ok,true,linked.error);assert.equal(linked.record.sourceDay,SOURCE);
 const repeated=prepare(linked.value,{id:"lr-second-comp",day:"2026-10-26",leave:"comp",sourceDay:SOURCE});assert.equal(repeated.ok,false);assert.match(repeated.error,/使用済み/);
 const sourceEdit=prepare(linked.value,{id:"lr-source-change",day:SOURCE,leave:"holiday"});assert.equal(sourceEdit.ok,false);assert.match(sourceEdit.error,/紐づく/);
 const beforeSourceEdit=JSON.stringify(linked.value),sourceSnapshot={...C.empty(linked.value),leave:"paid",note:"元の休日出勤日を全休に変更"};
 const editedSource=C.prepareLeaveRequest(freeze(linked.value),input({id:"lr-edited-source",day:SOURCE,leave:"paid"}),now,{record:freeze(sourceSnapshot),strictAllocation:true});assert.equal(editedSource.ok,false);assert.match(editedSource.error,/紐づく/);assert.equal(JSON.stringify(linked.value),beforeSourceEdit,"source validation must compare against the original records and preserve the linked day on failure");
 const withdraw=prepare(linked.value,{id:"lr-withdraw",leave:""});assert.equal(withdraw.ok,true,withdraw.error);assert.equal(withdraw.record.leave,"");assert.equal(withdraw.record.sourceDay,"");assert.equal(withdraw.record.start,"");assert.equal(withdraw.value.leaveRequests["lr-request-1"].leave,"comp");assert.equal(withdraw.value.leaveRequests["lr-withdraw"].leave,"");
 delete withdraw.value.records[SOURCE];assert.ok(C.hydrate(withdraw.value,now),"a withdrawn comp receipt remains readable after its old source is deleted");
 const reallocated=prepare(prepare(linked.value,{id:"lr-release",leave:""}).value,{id:"lr-new-comp",day:"2026-10-26",leave:"comp",sourceDay:SOURCE});assert.equal(reallocated.ok,true,reallocated.error);
 for(const sourceDay of ["","2026-10-23",DAY,"2026-10-28","not-a-date"]){assert.equal(prepare(state,{leave:"comp",sourceDay}).ok,false);}
 for(const change of [{start:"",end:""},{end:""},{end:"09:30",allocation:{P1:0,P2:0,P3:0,P4:0,SET:0}},{leave:"holiday",start:"",end:"",allocation:{P1:0,P2:0,P3:0,P4:0,SET:0}}]){
  const invalid=initial();invalid.records[SOURCE]=work(invalid,change);assert.equal(prepare(invalid,{leave:"comp",sourceDay:SOURCE}).ok,false);
 }

 // Incoming and saved receipts are strictly validated before JSON cloning can hide bad values.
 const fresh=initial(),before=JSON.stringify(fresh);
 const invalidInputs=[...['','__proto__','constructor','prototype','a'.repeat(129),'bad id','x/y'].map(id=>input({id})),input({day:"2026-10-28"}),input({day:"2026-09-30"}),input({day:"2026-02-30"}),input({day:new String(DAY)}),input({leave:"invalid"}),input({leave:new String("paid")}),input({sourceDay:SOURCE}),input({requestedAt:"invalid"}),input({requestedAt:"2026-02-30T12:00:00.000Z"}),input({requestedAt:"2026-10-27T12:01:00.000Z"}),input({requestedAt:"2026-10-26T12:00:00.000Z"}),{...input(),delivery:"local"},{...input(),status:"approved"}];
 for(const bad of invalidInputs){const result=C.prepareLeaveRequest(fresh,bad,now);assert.equal(result.ok,false,"invalid request: "+JSON.stringify(bad));assert.equal(Object.hasOwn(result,"value"),false);assert.equal(JSON.stringify(fresh),before);}
 for(const bad of [null,[],{},undefined])assert.equal(C.prepareLeaveRequest(fresh,bad,now).ok,false);
 for(const clock of [null,{day:DAY,minutes:-1},{day:"bad",minutes:1260},{day:DAY,minutes:1440}])assert.equal(prepare(fresh,{},clock).ok,false);
 const valid=prepare(fresh).value;
 for(const bad of [null,[],"wrong",{id:"lr-other"},{...receipt(),delivery:"sent"},{...receipt(),status:"pending"},{...receipt(),requestedAt:undefined},{...receipt(),requestedAt:"2026-02-30T12:00:00.000Z"},{...receipt(),day:"2026-10-28"},{...receipt(),leave:"comp",sourceDay:DAY}]){
  const malformed={...plain(valid),leaveRequests:bad&&typeof bad==="object"&&!Array.isArray(bad)?{"lr-request-1":bad}:bad};assert.equal(C.hydrate(malformed,now),null,"malformed receipt must not be silently repaired: "+JSON.stringify(bad));
 }
 const unknownId={...plain(valid),leaveRequests:{"lr-other":receipt()}};assert.equal(C.hydrate(unknownId,now),null,"map key must match the receipt's own ID");
 const symbolReceipt=receipt();symbolReceipt[Symbol("hidden")]=true;assert.equal(C.hydrate({...plain(valid),leaveRequests:{"lr-request-1":symbolReceipt}},now),null);
 const nonenumerable=receipt();Object.defineProperty(nonenumerable,"requestedAt",{value:AT,enumerable:false});assert.equal(C.hydrate({...plain(valid),leaveRequests:{"lr-request-1":nonenumerable}},now),null);
 const snapshot=JSON.stringify(valid),rewound={day:"2026-10-26",minutes:0};assert.ok(C.hydrate(valid,rewound),"receipt history survives a rewound device clock");assert.equal(JSON.stringify(valid),snapshot);
 assert.equal(Object.hasOwn(C.hydrate(initial(),now),"leaveRequests"),false,"old states load without inventing or saving request history");
 const emptyMap={...initial(),leaveRequests:{}};assert.deepEqual(plain(C.hydrate(emptyMap,now).leaveRequests),{});
 console.log("Paper leave requests: atomic home/editor receipt/application, strict snapshots/payload/history, reload/failure/conflict, full/half leave, withdrawal, original-state comp guards and clock rewind passed.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
