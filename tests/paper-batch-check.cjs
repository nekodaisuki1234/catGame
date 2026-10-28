"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const context={window:{},Intl,Date};vm.createContext(context);
for(const file of ["paper-holidays.js","paper-core.js"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../day-designs",file),"utf8"),context);
const C=context.window.PaperAttendance,now={day:"2026-10-27",minutes:18*60},base=C.seed(now);
const allocation=minutes=>({P1:minutes/60,P2:0,P3:0,P4:0,P5:0,SET:0});
const work=(changes={})=>({...C.empty(base),start:"09:00",end:"18:00",note:"休日のリリース対応",allocation:allocation(480),...changes});
const comp=sourceDay=>({...C.empty(base),leave:"comp",sourceDay,note:""});
const state=records=>({...C.clone(base),records,submissions:{}});
const check=(data,day,r)=>C.validateRecordChange(data,day,r,now);
const messages=result=>result.errors.flatMap(error=>error.messages).join("\n");

// A live day is provisional; a completed day retains a real negative result.
const working=work({end:"",allocation:allocation(0)});
for(const minutes of [540,570,600,660]){
 const reference={...now,minutes},result=C.validateRecord(working,now.day,reference,base.settings,{strictAllocation:true});
 assert.equal(C.worked(working,now.day,reference),Math.max(0,minutes-600));
 assert.equal(result.ok,true,"ongoing work with zero allocation can be edited after its net becomes positive");
 assert.equal(result.warnings.length,0,"starting work does not trigger a negative or allocation toast");
}
assert.equal(C.worked({...working,breakMinutes:1440},now.day,now),0);
const provisional={...working,allocation:allocation(120)};
assert.equal(C.validateRecord(provisional,now.day,now,base.settings,{strictAllocation:true}).ok,true,"manual provisional allocations do not block editing before clock-out");
assert.match(messages(C.submissionCheck(state({[now.day]:provisional}),{start:now.day,end:now.day},now)),/出勤・退勤/,"provisional allocations never make an unfinished day submittable");
const negative=work({end:"09:30",allocation:allocation(0)});
assert.equal(C.worked(negative,now.day,now),-30);
for(const strictAllocation of [false,true]){
 const saved=C.validateRecord(negative,now.day,now,base.settings,{strictAllocation});
 assert.equal(saved.ok,true);assert.match(saved.warnings.join(),/−0時間30分/);
}
assert.match(messages(C.submissionCheck(state({[now.day]:negative}),{start:now.day,end:now.day},now)),/マイナス/);

// Recompute only P1, so manual work on the other five projects survives time edits.
const split=work({allocation:{P1:4,P2:1,P3:1.5,P4:.5,P5:0,SET:1}}),original=JSON.stringify(split);
for(const [changes,expected] of [[{end:"19:00"},5],[{breakMinutes:90},3.5],[{end:"18:01"},4+1/60]]){
 const adjusted=C.allocateToP1({...split,...changes},now.day,now);
 assert.equal(adjusted.allocation.P1,expected);
 for(const key of ["P2","P3","P4","P5","SET"])assert.equal(adjusted.allocation[key],split.allocation[key]);
 assert.equal(C.validateRecord(adjusted,now.day,now,base.settings,{strictAllocation:true}).ok,true);
}
assert.equal(JSON.stringify(split),original,"allocation helper does not mutate its argument");
for(const incomplete of [working,{...split,end:""},{...C.empty(base)}]){
 const adjusted=C.allocateToP1(incomplete,now.day,now);
 assert.notEqual(adjusted,incomplete);assert.notEqual(adjusted.allocation,incomplete.allocation);
 assert.equal(JSON.stringify(adjusted),JSON.stringify(incomplete),"no provisional allocation is created for an unfinished or empty record");
}
const tooMuch=C.allocateToP1({...split,end:"12:00"},now.day,now);
assert.equal(tooMuch.allocation.P1,0);assert.equal(tooMuch.allocation.P3,1.5);
assert.match(C.validateRecord(tooMuch,now.day,now,base.settings).warnings.join(),/工数合計/);
assert.equal(C.validateRecord(tooMuch,now.day,now,base.settings,{strictAllocation:true}).ok,false);
const negativeSplit=C.allocateToP1({...split,end:"09:30"},now.day,now);
assert.equal(negativeSplit.allocation.P1,0);assert.equal(negativeSplit.allocation.SET,1);
assert.equal(C.validateRecord(negativeSplit,now.day,now,base.settings,{strictAllocation:true}).ok,true,"negative completed work still saves while retaining other projects");

// Candidate lists use actual past weekend/official-holiday work, once per full day.
const candidates=state({
 "2026-10-10":work(),"2026-10-11":work({end:"11:00",allocation:allocation(60)}),
 "2026-10-12":work({end:"14:00",allocation:allocation(240)}),"2026-10-17":work({start:"22:00",end:"06:00",overnight:true,allocation:allocation(420)}),
 "2026-10-09":work(),"2026-10-24":work(),"2026-10-18":work({end:"10:00",allocation:allocation(0)}),
 "2026-10-04":negative,"2026-10-03":working,"2026-03-28":work(),"2026-11-03":work(),
 "2026-10-25":{...C.empty(base),leave:"paid"},"2026-10-26":{...work(),sourceDay:"2026-10-10"}
});
assert.equal(C.compSources(candidates,"2026-10-20",now).join(),"2026-10-17,2026-10-12,2026-10-11,2026-10-10");
assert.equal(C.compSources(candidates,"2026-10-28",now).length,0,"future leave days do not offer source choices");
candidates.records["2026-10-20"]=comp("2026-10-12");
assert.ok(C.compSources(candidates,"2026-10-20",now).includes("2026-10-12"),"the currently edited leave may retain its own source");
assert.equal(C.compSources(candidates,"2026-10-21",now).includes("2026-10-12"),false,"another leave cannot reuse that full day");
assert.ok(C.compSources(candidates,"2026-10-21",now).includes("2026-10-10"),"stale source metadata on a work record does not consume a day");
const unknown=state({"2028-01-03":work(),"2028-01-08":work()});
assert.equal(C.workday("2028-01-03"),null);
assert.equal(C.compSources(unknown,"2028-01-10",{day:"2028-01-10",minutes:1080}).join(),"2028-01-08","unpublished weekdays must not be invented as official holidays");

const source="2026-09-26",leaveDay="2026-10-26",nextDay="2026-10-27",linked=state({[source]:work(),[leaveDay]:comp(source)}),linkedBefore=JSON.stringify(linked);
assert.equal(check(linked,leaveDay,comp(source)).ok,true,"an existing valid link can be saved without being mistaken for a duplicate");
for(const invalidSource of ["","2026-10-09",leaveDay,"2026-11-03","2026-09-27"]){
 const result=check(linked,leaveDay,comp(invalidSource));assert.equal(result.ok,false,"source must be real eligible work: "+invalidSource);
}
assert.match(check(linked,nextDay,comp(source)).error,/使用済み/);
for(const changed of [null,{...C.empty(base)},{...C.empty(base),leave:"paid"},working,negative,work({end:"10:00",allocation:allocation(0)})]){
 const result=check(linked,source,changed);assert.equal(result.ok,false,"an active source cannot be removed or lose positive work");
 assert.match(result.error,/2026-10-26.*先に.*代休を解除/);
}
assert.equal(check(linked,source,C.allocateToP1(work({end:"19:00"}),source,now)).ok,true,"source duration may change while it remains positive completed work");
assert.equal(JSON.stringify(linked),linkedBefore,"all relationship validation is pure");
assert.equal(check(linked,"2026-10-23",work()).ok,true,"an unrelated edit is not blocked by existing relationships");
const brokenUnrelated=state({...linked.records,"2026-10-22":comp("")});
assert.equal(check(brokenUnrelated,"2026-10-23",work()).ok,true,"unrelated legacy link errors remain independently repairable");

// Exercise the complete register/reject/release/delete lifecycle.
const lifecycle=C.clone(linked);
assert.equal(check(lifecycle,nextDay,comp(source)).ok,false);
assert.equal(check(lifecycle,leaveDay,{...C.empty(base),leave:"paid"}).ok,true);
lifecycle.records[leaveDay]={...C.empty(base),leave:"paid"};
assert.ok(C.compSources(lifecycle,nextDay,now).includes(source),"releasing comp leave makes its source reusable");
assert.equal(check(lifecycle,source,null).ok,true);delete lifecycle.records[source];
assert.equal(C.compSources(lifecycle,nextDay,now).includes(source),false);

// Shape validation stays compatible with old records; link integrity is checked on submission.
assert.equal(C.LEAVES.comp,"代休");assert.equal(C.fullLeave(comp(source)),true);assert.equal(C.empty(base).sourceDay,"");
const legacy=work();delete legacy.sourceDay;
assert.equal(C.validateRecord(legacy,leaveDay,now,base.settings).ok,true);
assert.ok(C.hydrate(state({[leaveDay]:legacy}),now));
for(const sourceDay of [null,42,"2026-02-30","2026-03-31"])assert.equal(C.validateRecord({...comp(source),sourceDay},leaveDay,now,base.settings).ok,false);
assert.equal(C.validateRecord(comp(""),leaveDay,now,base.settings).ok,true,"a missing source remains loadable for repair");
assert.ok(C.hydrate(state({[leaveDay]:comp("")}),now));
assert.equal(C.submissionCheck(linked,{start:leaveDay,end:leaveDay},now).ok,true,"source may be outside the submitted period");
for(const records of [{[leaveDay]:comp("")},{[leaveDay]:comp(source)},{[source]:negative,[leaveDay]:comp(source)},{[source]:work(),[leaveDay]:comp(source),[nextDay]:comp(source)}]){
 const data=state(records),result=C.submissionCheck(data,{start:leaveDay,end:nextDay},now);
 assert.equal(result.ok,false);assert.ok(result.errors.some(error=>error.day===leaveDay));
 const prepared=C.prepareSubmission(data,{start:leaveDay,end:nextDay},now);
 assert.equal(prepared.ok,false);assert.equal(Object.hasOwn(prepared,"bytes"),false,"direct preparation cannot bypass relationship checks");
}
const badSource=state({[source]:work({end:"10:00",allocation:allocation(0)}),[leaveDay]:comp(source)});
assert.ok(C.submissionCheck(badSource,{start:source,end:source},now).errors.some(error=>error.day===leaveDay),"submitting a source also rechecks its dependent leave outside that period");
const counts=state({...linked.records,"2026-10-20":{...C.empty(base),leave:"paid"},"2026-10-21":{...C.empty(base),leave:"am"},"2026-10-22":{...C.empty(base),leave:"pm"}});
assert.equal(C.summary(counts,C.month(leaveDay),now).leave,2,"comp leave is excluded from paid-leave usage");
assert.equal(C.missing(linked,{start:leaveDay,end:leaveDay},now).length,0);

const history=C.clone(linked),sourceKey=source+"|"+source,leaveKey=leaveDay+"|"+leaveDay,otherKey="2026-08-01|2026-08-31";
for(const key of [sourceKey,leaveKey,otherKey])history.submissions[key]={at:"2026-10-27T09:00:00Z",test:false};
C.invalidateSubmissions(history,source);
assert.equal(history.submissions[sourceKey],undefined);assert.equal(history.submissions[leaveKey],undefined);
assert.ok(history.submissions[otherKey],"unrelated output history survives a source edit");

const bytes=Buffer.from(C.prepareSubmission(linked,{start:leaveDay,end:leaveDay},now).bytes),entries={};let cursor=0;
while(bytes.readUInt32LE(cursor)===0x04034b50){
 const size=bytes.readUInt32LE(cursor+18),nameLength=bytes.readUInt16LE(cursor+26),extra=bytes.readUInt16LE(cursor+28),start=cursor+30+nameLength+extra;
 entries[bytes.subarray(cursor+30,cursor+30+nameLength).toString()]=bytes.subarray(start,start+size).toString();cursor=start+size;
}
const sheet=entries["xl/worksheets/sheet1.xml"];
assert.match(sheet,/代休元の休日出勤日/);assert.match(sheet,/<c r="P8"[^>]*><is><t[^>]*>2026-09-26<\/t><\/is><\/c>/);
assert.match(sheet,/代休/);assert.doesNotMatch(sheet,/有給休暇/);

for(const d of ["2026-10-10","2026-10-11","2026-10-12"]){
 for(const minutes of [0,60,240]){
  const r=work({end:C.time(600+minutes),allocation:allocation(minutes)}),result=C.submissionCheck(state({[d]:r}),{start:d,end:d},now,{halfLeaveExemptsShortHours:false});
  assert.equal(result.ok,true,"weekend and official-holiday work do not require paid leave for short hours");
  const missingNote=C.submissionCheck(state({[d]:{...r,note:"\u3000"}}),{start:d,end:d},now);
  assert.match(messages(missingNote),/作業内容/);
 }
}
console.log("A. Paper: provisional time, P1 remainder, comp source eligibility, one-to-one lifecycle, dependency guards, history and XLSX checks passed.");
