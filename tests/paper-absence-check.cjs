"use strict";
const {unknownDay,unknownNextDay}=require("./paper-calendar-fixture.cjs");
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const context={window:{},Intl,Date};vm.createContext(context);
for(const file of ["paper-holidays.js","paper-core.js"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../day-designs",file),"utf8"),context);
const C=context.window.PaperAttendance,now={day:"2026-10-28",minutes:20*60},base=C.createState(now,{startDay:"2026-10-01"});
const allocation=minutes=>({P1:Math.max(0,minutes)/60,P2:0,P3:0,P4:0,SET:0});
const work=(minutes,leave="")=>({...C.empty(base),start:"09:00",end:C.time(9*60+60+minutes),leave,note:"開発作業",allocation:allocation(minutes)});
const leave=kind=>({...C.empty(base),leave:kind});
const state=records=>({...C.clone(base),records});
const warnings=(record,day="2026-10-27")=>C.validateRecord(record,day,now,base.settings,{strictAllocation:true});
const day="2026-10-27";

// Each completed weekday has its own eight-hour target, with exact-minute arithmetic.
for(const [minutes,expected] of [[0,480],[180,300],[240,240],[420,60],[479,1],[480,0],[481,0],[540,0]]){
 assert.equal(C.absenceMinutes(work(minutes),day,now),expected,"full-day work: "+minutes);
 assert.equal(warnings(work(minutes)).ok,true,"short work remains saveable: "+minutes);
}
for(const kind of ["am","pm"]){
 for(const [minutes,expected] of [[0,240],[180,60],[239,1],[240,0],[241,0],[300,0],[480,0]])assert.equal(C.absenceMinutes(work(minutes,kind),day,now),expected,kind+" credits four hours: "+minutes);
 assert.equal(C.absenceMinutes(leave(kind),day,now),0,"half leave without punches is a missing record, not confirmed absence");
}

// Holidays, full-day leave, future days and unfinished days are excluded.
for(const kind of ["paid","holiday","special","comp"])assert.equal(C.absenceMinutes(leave(kind),day,now),0,kind+" exempts the day");
for(const date of ["2026-10-12","2026-10-24","2026-10-25"]){
 assert.equal(C.absenceMinutes(work(180),date,now),0,"holiday work has no weekday target: "+date);
 assert.doesNotMatch(warnings(work(180),date).warnings.join(),/欠勤|1日8時間/);
}
for(const record of [undefined,C.empty(base),{...work(180),start:"",end:""},{...work(180),end:""}])assert.equal(C.absenceMinutes(record,day,now),0,"missing or unfinished punches remain separate");
assert.equal(C.absenceMinutes({...work(180),end:""},now.day,now),0,"clock-in does not create a shortage during the workday");
assert.equal(warnings({...work(180),end:""},now.day).warnings.length,0,"no clock-in shortage toast");
assert.equal(C.absenceMinutes(work(420),now.day,now),60,"today counts after clock-out");
assert.equal(C.absenceMinutes(work(420),"2026-10-29",now),0,"a saved future fixture does not count");
assert.equal(C.absenceMinutes(work(420),unknownDay,{day:unknownNextDay,minutes:1200}),0,"unpublished weekday calendars cannot invent a target");
assert.equal(C.absenceMinutes({...work(420),breakMinutes:null},day,now),0,"an invalid edit draft cannot produce NaN");
assert.equal(C.absenceMinutes({...work(420),start:"18:00",end:"09:00"},day,now),0,"invalid reversed times wait for correction");

// Negative actual hours keep their warning and cannot create more than a full day's absence.
for(const [kind,expected] of [["",480],["am",240],["pm",240]]){
 const negative=work(-30,kind),checked=warnings(negative);
 assert.equal(C.worked(negative,day,now),-30);assert.equal(C.absenceMinutes(negative,day,now),expected);
 assert.equal(checked.ok,true);assert.match(checked.warnings.join(),/休憩時間を引いた/);
 assert.doesNotMatch(checked.warnings.join(),/欠勤時間/);
}
assert.match(warnings(work(420)).warnings.join(),/1時間00分.*欠勤時間/);
assert.match(warnings(work(180,"am")).warnings.join(),/半休4時間分.*1時間00分.*欠勤時間/);
assert.doesNotMatch(warnings(work(240,"pm")).warnings.join(),/欠勤時間/);
const mismatch=C.validateRecord({...work(420),allocation:allocation(480)},day,now,base.settings);
assert.equal(mismatch.ok,true);assert.match(mismatch.warnings.join(),/工数合計/);assert.match(mismatch.warnings.join(),/欠勤時間/);

// Daily shortages accumulate without overtime on other days cancelling them.
const data=state({
 "2026-09-30":work(420),"2026-10-01":work(420),"2026-10-02":work(540),
 "2026-10-05":work(180,"am"),"2026-10-06":work(240,"pm"),
 "2026-10-07":leave("paid"),"2026-10-08":leave("holiday"),"2026-10-09":leave("special"),
 "2026-10-12":work(180),"2026-10-13":leave("comp"),"2026-10-14":leave("am"),
 "2026-10-15":{...work(180),end:""},"2026-10-17":work(180),"2026-10-18":work(420),
 "2026-10-19":work(-30),"2026-10-20":work(-30,"pm"),"2026-10-28":work(420),
 "2026-10-29":work(420),"2026-11-02":work(420)
});
const before=JSON.stringify(data),sum=C.summary(data,C.month(now.day),now);
assert.equal(sum.absenceMinutes,900);assert.equal(sum.absenceDays,5);
assert.equal(C.summary(data,C.month("2026-09-01"),now).absenceMinutes,0,"records before the configured start are excluded");
assert.equal(C.summary(data,C.month("2026-11-01"),now).absenceMinutes,0,"future-month records are excluded");
assert.ok(C.pastMissing(data,now).includes("2026-10-14"));assert.ok(C.pastMissing(data,now).includes("2026-10-15"));assert.ok(C.pastMissing(data,now).includes("2026-10-16"));
for(const manual of [0,80,160,744]){
 const changed=C.clone(data);changed.settings.plannedHoursByMonth={"2026-10":manual};
 assert.equal(C.summary(changed,C.month(now.day),now).absenceMinutes,900,"monthly planning overrides do not alter the daily eight-hour rule");
}
const later=state({"2026-10-01":work(420),"2026-10-27":work(420)});later.settings.attendanceStartDay="2026-10-26";
assert.equal(C.summary(later,C.month(now.day),now).absenceMinutes,60);
const historical=C.createState(now,{startDay:"2026-03-28"});historical.records["2026-03-30"]=work(420);
assert.equal(C.absenceMinutes(historical.records["2026-03-30"],"2026-03-30",now),60,"local records may begin before the legacy demo's April start");
assert.equal(C.summary(historical,C.month("2026-03-01"),now).absenceMinutes,60);
historical.settings.attendanceStartDay="2026-03-31";
assert.equal(C.summary(historical,C.month("2026-03-01"),now).absenceMinutes,0,"the actual configured start clips absence totals");
assert.equal(JSON.stringify(data),before,"derived summaries do not mutate records or settings");

// The existing submission threshold remains independent of the new warning-only eight-hour rule.
for(const [record,ok] of [[work(420),true],[work(240),false],[work(240,"am"),true],[work(180,"pm"),true],[work(-30),false]]){
 const result=C.submissionCheck(state({[day]:record}),{start:day,end:day},now);
 assert.equal(result.ok,ok,"preserve submission policy for "+record.leave+" "+C.worked(record,day,now));
}
console.log("Paper absence: minute-accurate daily shortages, four-hour half-leave credit, completed weekday exclusions, missing-day separation, negative cap, monthly totals and warning-only submission compatibility passed.");
