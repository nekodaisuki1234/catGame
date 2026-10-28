"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const context={window:{},Intl,Date};vm.createContext(context);
for(const file of ["paper-holidays.js","paper-core.js"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../day-designs",file),"utf8"),context);
const C=context.window.PaperAttendance,now={day:"2026-10-27",minutes:21*60},day="2026-10-26",period={start:day,end:day},base=C.seed(now);
const allocation=minutes=>({P1:minutes/60,P2:0,P3:0,P4:0,P5:0,SET:0});
const record=(changes={})=>({...C.empty(base),start:"09:00",end:"18:00",note:"結合テストを実施",allocation:allocation(480),...changes});
const stateFor=(r,d=day)=>({...C.clone(base),records:r===undefined?{}:{[d]:r}});
const check=(r,options={})=>C.submissionCheck(stateFor(r),period,now,options);
const messages=result=>result.errors.flatMap(error=>error.messages).join("\n");
const save=(r,options={})=>C.validateRecord(r,day,now,base.settings,options);
const noBytes=result=>{assert.equal(result.ok,false);assert.equal(Object.hasOwn(result,"bytes"),false);};

const fourHours=record({end:"14:00",allocation:allocation(240)}),overFour=record({end:"14:01",allocation:allocation(241)});
assert.equal(check(fourHours).ok,false,"exactly four hours needs registered leave");
assert.match(messages(check(fourHours)),/4時間以下.*有給休暇/);
assert.equal(check(overFour).ok,true,"four hours and one minute passes");
const zeroHours=record({end:"10:00",allocation:allocation(0)});
assert.match(messages(check(zeroHours)),/4時間以下/,"zero net hours is also short work");

for(const leave of ["am","pm"]){
 for(const r of [fourHours,zeroHours]){
  assert.equal(check({...r,leave}).ok,true,"registered half-day leave exempts short hours by default: "+leave);
  assert.equal(check({...r,leave},{halfLeaveExemptsShortHours:true}).ok,true);
  assert.match(messages(check({...r,leave},{halfLeaveExemptsShortHours:false})),/4時間以下/);
 }
 assert.equal(check(record({leave})).ok,true,"half leave still permits longer work");
 assert.equal(check({...C.empty(base),leave}).ok,false,"half leave still needs work punches");
}
for(const leave of ["paid","holiday","special"]){
 const r={...C.empty(base),leave,note:"\u3000"};
 assert.equal(check(r).ok,true,"full-day leave needs neither a work note nor hours: "+leave);
 assert.equal(check({...r,note:42}).ok,false,"full-day leave still validates record shape");
 assert.equal(check({...r,start:"09:00"}).ok,false,"full-day leave cannot hide punches");
 assert.equal(check({...r,allocation:{...r.allocation,P1:-1}}).ok,false,"full-day leave still validates allocation ranges");
}

const negative=record({end:"10:00",breakMinutes:61,allocation:allocation(480)});
assert.equal(C.worked(negative,day,now),-1);
for(const strictAllocation of [false,true]){
 const result=save(negative,{strictAllocation});
 assert.equal(result.ok,true,"negative records remain saveable even in the explicit editor");
 assert.equal(result.value.allocation.P1,8,"negative save preserves entered allocation");
 assert.match(result.warnings.join(),/マイナス|−0時間01分/);
}
assert.ok(C.hydrate(stateFor(negative),now),"negative records survive hydration");
for(const leave of ["","am","pm"]){
 const result=check({...negative,leave});
 assert.equal(result.ok,false,"negative net never submits, including half-day leave");
 assert.match(messages(result),/マイナス/);
 assert.doesNotMatch(messages(result),/4時間以下/,"negative net reports its own cause");
}

for(const note of [""," ","\t\n\r","\u3000"," \u3000\t "]){
 const result=check(record({note}));
 assert.equal(result.ok,false,"whitespace-only work notes cannot submit");
 assert.match(messages(result),/作業内容/);
 assert.equal(result.errors[0].day,day);
}
assert.equal(check(record({note:"\u3000テスト対応\u3000"})).ok,true,"surrounding whitespace is harmless when content exists");
const unfinished=record({end:"",note:"",allocation:allocation(0)});
const unfinishedResult=check(unfinished);
assert.match(messages(unfinishedResult),/出勤・退勤/);
assert.match(messages(unfinishedResult),/作業内容/,"a work record needs a note even before its end punch");
assert.doesNotMatch(messages(unfinishedResult),/4時間以下/,"an unfinished punch has no final net time");

for(const minutes of [0,479,481]){
 const r=record({allocation:allocation(minutes)}),result=check(r);
 assert.equal(result.ok,false,"allocation must exactly match actual minutes: "+minutes);
 assert.match(messages(result),/工数合計/);
 assert.equal(save(r).ok,true,"ordinary persistence continues accepting historical mismatches");
 assert.equal(save(r,{strictAllocation:true}).ok,false,"explicit editor requires exact allocation, including all-zero allocation");
 assert.ok(C.hydrate(stateFor(r),now),"historical mismatches remain loadable");
}
const split=record({allocation:{P1:1.5,P2:1.25,P3:1,P4:.25,P5:.5,SET:3.5}});
assert.equal(check(split).ok,true,"all six allocation buckets count toward the exact sum");
assert.equal(save(split,{strictAllocation:true}).ok,true);
assert.equal(check(overFour).ok,true,"fractional hours representing exact minutes are supported");
assert.equal(save(overFour,{strictAllocation:true}).ok,true);
for(const r of [record({allocation:{P1:7.123,P2:0,P3:0,P4:0,P5:0,SET:0}}),record({allocation:allocation(-1)}),record({note:42}),record({leave:"compensatory"}),record({end:"05:00"})])assert.equal(check(r).ok,false,"submission always performs structural validation first");

const missing=C.submissionCheck(stateFor(undefined),period,now);
assert.equal(missing.ok,false);assert.equal(missing.errors.length,1);assert.equal(missing.errors[0].day,day);
assert.match(messages(missing),/出勤・退勤/);
const tomorrow=C.add(now.day,1),futureState=stateFor({invalid:"future record"},tomorrow);
futureState.records[now.day]=record();
assert.equal(C.submissionCheck(futureState,{start:now.day,end:tomorrow},now).ok,true,"future records are excluded when a period includes today");
assert.equal(C.submissionCheck(futureState,{start:now.day,end:C.month(now.day).end},now).ok,true,"the current month may end after today");
for(const outside of [{start:tomorrow,end:tomorrow},{start:"2026-03-01",end:"2026-03-31"}]){
 const result=C.submissionCheck(futureState,outside,now);
 assert.equal(result.ok,false,"a period must intersect the supported recorded dates");assert.match(messages(result),/対象期間/);
 noBytes(C.prepareSubmission(futureState,outside,now));
}
const holiday="2026-10-12",holidayPeriod={start:holiday,end:holiday};
assert.equal(C.holiday(holiday),"スポーツの日","tests load the real holiday calendar");
for(const r of [undefined,C.empty(base),{...C.empty(base),note:""}])assert.equal(C.submissionCheck(stateFor(r,holiday),holidayPeriod,now).ok,true,"an ordinary holiday without actual work is ignored");
assert.equal(C.submissionCheck(stateFor(record(),holiday),holidayPeriod,now).ok,true,"real holiday work has the same checks");
assert.equal(C.submissionCheck(stateFor(fourHours,holiday),holidayPeriod,now).ok,true,"holiday work is exempt from the short-hours paid-leave check");
assert.match(messages(C.submissionCheck(stateFor(record({note:"\u3000"}),holiday),holidayPeriod,now)),/作業内容/);
assert.match(messages(C.submissionCheck(stateFor(unfinished,holiday),holidayPeriod,now)),/出勤・退勤/);
const overnight=record({start:"22:00",end:"06:00",overnight:true,allocation:allocation(420)});
assert.equal(check(overnight).ok,true,"overnight work uses the following day's end time");
assert.equal(C.worked(overnight,day,now),420);

for(const invalid of [undefined,null,{}, {start:"2026-02-30",end:day},{start:day,end:"not-a-date"},{start:"2026-10-27",end:day},{start:"2026-01-01",end:"2027-02-10"},{start:"2027-01-01",end:"2028-01-02"}]){
 const result=C.submissionCheck(stateFor(record()),invalid,now);
 assert.equal(result.ok,false,"invalid or oversized periods fail before date iteration");
 assert.match(messages(result),/対象期間/);assert.equal(result.errors[0].day,"");
 noBytes(C.prepareSubmission(stateFor(record()),invalid,now));
}
const annual=stateFor(undefined),leapNow={day:"2028-12-31",minutes:now.minutes};
for(const d of C.dates("2028-01-01","2028-12-31"))annual.records[d]={...C.empty(base),leave:"paid",note:""};
assert.equal(C.submissionCheck(annual,{start:"2028-01-01",end:"2028-12-31"},leapNow).ok,true,"a full leap year of 366 dates is not silently truncated");
assert.equal(C.submissionCheck(stateFor(record()),period,{day:"invalid",minutes:0}).ok,false);
assert.equal(C.submissionCheck(null,period,now).ok,false);

for(const r of [fourHours,negative,record({note:"\u3000"}),record({allocation:allocation(0)}),unfinished,undefined]){
 const state=stateFor(r),before=JSON.stringify(state),result=C.prepareSubmission(state,period,now);
 noBytes(result);assert.equal(JSON.stringify(state),before,"failed direct preparation does not change records or submission history");
 assert.equal(JSON.stringify(result.errors),JSON.stringify(C.submissionCheck(state,period,now).errors),"preparation uses the same guard even if a caller bypasses the UI");
}
const ready=stateFor(split),before=JSON.stringify(ready),prepared=C.prepareSubmission(ready,period,now);
assert.equal(prepared.ok,true);assert.equal(prepared.errors.length,0);assert.equal(Buffer.from(prepared.bytes).readUInt32LE(0),0x04034b50,"successful preparation returns real XLSX bytes");
assert.equal(JSON.stringify(ready),before,"successful preparation is also pure and does not mark history");
assert.equal(C.prepareSubmission(stateFor({...fourHours,leave:"am"}),period,now).ok,true);
noBytes(C.prepareSubmission(stateFor({...fourHours,leave:"am"}),period,now,{halfLeaveExemptsShortHours:false}));

for(const r of [record(),overFour,overnight,negative,zeroHours]){
 const original=JSON.stringify(r),assigned=C.allocateToP1(r,day,now),net=Math.max(0,C.worked(r,day,now));
 assert.notEqual(assigned,r);assert.notEqual(assigned.allocation,r.allocation);
 assert.equal(assigned.allocation.P1,net/60);
 for(const key of ["P2","P3","P4","P5","SET"])assert.equal(assigned.allocation[key],0);
 assert.equal(JSON.stringify(r),original,"automatic P1 allocation does not mutate its input");
 assert.equal(assigned.note,r.note);assert.equal(assigned.start,r.start);
}
console.log("A. Paper: submission hours, notes, exact allocations, leave policy, periods, guarded XLSX preparation and P1 allocation checks passed.");
