"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {unknownYear,unknownDay,unknownNextDay}=require('./paper-calendar-fixture.cjs');
const context={window:{},Intl,Date};vm.createContext(context);
for(const file of ['paper-holidays.js','paper-core.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../day-designs',file),'utf8'),context);
const C=context.window.PaperAttendance,R=require('../day-designs/paper-reminders.js')(C);
const plain=value=>JSON.parse(JSON.stringify(value));
const now=(day,minutes=540)=>({day,minutes});
const state=(day,startDay=day)=>plain(C.createState(now(day),{startDay}));
const work=s=>({...plain(C.empty(s)),start:'09:00',end:'18:00',note:'作業内容',allocation:{P1:8,P2:0,P3:0,P4:0,SET:0}});
const kind=(plan,type)=>plan.events.filter(event=>event.kind===type);
const status=value=>({submissionStatus:()=>value});

assert.equal(Object.isFrozen(R.policy),true);assert.equal(Object.isFrozen(R.policy.missing),true);assert.equal(Object.isFrozen(R.policy.submission),true);
assert.deepEqual(plain(R.policy),{timeZone:'Asia/Tokyo',missing:{time:'09:00'},submission:{time:'09:00',deadline:'closing-day'}});
for(const [instant,expected] of [
 [now('2026-10-09',539),{day:'2026-10-09',time:'09:00'}],
 [now('2026-10-09'),{day:'2026-10-13',time:'09:00'}],
 [now('2026-10-10'),{day:'2026-10-13',time:'09:00'}],
 [now('2026-10-12',0),{day:'2026-10-13',time:'09:00'}],
 [now('2026-12-31',900),{day:'2027-01-04',time:'09:00'}]
])assert.deepEqual(plain(R.nextMissingAt(instant)),expected);
assert.equal(R.nextMissingAt(now(unknownDay,0)),null,'unpublished weekdays cannot become scheduled workdays');
assert.equal(R.nextMissingAt(now(`${unknownYear}-01-01`)),null,'year extension must not predict holidays');
for(const invalid of [null,{},[],{day:'bad',minutes:540},{day:'2026-02-30',minutes:540},now('2026-10-28',-1),now('2026-10-28',1440),now('2026-10-28',NaN)]){
 assert.equal(R.nextMissingAt(invalid),null);assert.equal(R.plan(state('2026-10-28'),invalid).blocked[0].reason,'invalid-now');
}

const sample=state('2026-10-28','2026-10-19');
sample.records['2026-10-19']={...C.empty(sample),leave:'paid'};
sample.records['2026-10-20']={...C.empty(sample),leave:'holiday'};
sample.records['2026-10-21']={...C.empty(sample),leave:'special'};
sample.records['2026-10-22']={...C.empty(sample),leave:'comp'};
sample.records['2026-10-23']={...C.empty(sample),leave:'am'};
sample.records['2026-10-26']={...work(sample),end:''};
sample.records['2026-10-27']=work(sample);
sample.records['2026-10-28']={...work(sample),end:''};
const original=JSON.stringify(sample);
assert.equal(R.plan(sample,now('2026-10-28',539)).events.length,0,'no notification before 09:00');
const planned=R.plan(sample,now('2026-10-28'));
assert.equal(kind(planned,'missing').length,1,'group all missing dates into one event');
assert.deepEqual(plain(planned.events[0].missingDays),['2026-10-23','2026-10-26']);
assert.equal(planned.events[0].key,'missing:2026-10-28');assert.equal(planned.events[0].scheduledAt,'2026-10-28T09:00:00+09:00');
assert.equal(R.plan(sample,now('2026-10-28',1200)).events[0].key,planned.events[0].key,'same-day retries share a deduplication key');
assert.notEqual(R.plan(sample,now('2026-10-29')).events[0].key,planned.events[0].key,'unresolved dates may remind next business morning');
assert.equal(JSON.stringify(sample),original,'planning must not persist, migrate or mutate input');
const corrected=plain(sample);corrected.records['2026-10-23']=work(corrected);corrected.records['2026-10-26']=work(corrected);
assert.equal(kind(R.plan(corrected,now('2026-10-28')),'missing').length,0,'today remains excluded even while currently working');
for(const day of ['2026-10-24','2026-10-25','2026-10-12'])assert.equal(kind(R.plan(state(day,'2026-10-01'),now(day)),'missing').length,0,'no weekend/public-holiday reminder');
assert.equal(R.plan(state('2026-10-28'),now('2026-10-28')).events.length,0,'first day has no past dates');
const futureStart=state('2026-10-15','2026-10-16');assert.equal(R.plan(futureStart,now('2026-10-15'),status('unsubmitted')).events.length,0,'no period before attendance starts');
const unknown=R.plan(state(unknownNextDay,unknownDay),now(unknownNextDay));
assert.equal(unknown.events.length,0);assert.ok(unknown.blocked.some(issue=>issue.kind==='missing'&&issue.reason==='calendar-unavailable'));
assert.equal(R.plan({...sample,mode:'demo'},now('2026-10-28')).blocked[0].reason,'demo-mode');
assert.equal(R.plan({...sample,records:null},now('2026-10-28')).blocked[0].reason,'invalid-state');
console.log('PASS 09:00 JST business-day planning, holiday/year boundaries, grouped missing dates, full/half leave, incomplete/current records, start date, deterministic keys and pure validation');

for(const [day,start,end] of [
 ['2026-10-15','2026-09-16','2026-10-15'],
 ['2026-10-31','2026-10-01','2026-10-31'],
 ['2026-11-15','2026-10-16','2026-11-15'],
 ['2028-02-29','2028-02-01','2028-02-29']
]){
 const data=state(day),before=JSON.stringify(data);
 assert.equal(kind(R.plan(data,now(day,539),status('unsubmitted')),'submission').length,0);
 const due=kind(R.plan(data,now(day),status('unsubmitted')),'submission');assert.equal(due.length,1);
 assert.deepEqual(plain(due[0].period),{start,end,label:day.endsWith('-15')?'15日締め':'月末締め'});
 assert.equal(due[0].scheduledAt,day+'T09:00:00+09:00');assert.equal(due[0].key,'submission:'+start+'|'+end);
 assert.equal(kind(R.plan(data,now(day),status('submitted')),'submission').length,0);
 assert.equal(JSON.stringify(data),before);
}
for(const options of [undefined,{},null,status('unknown'),status(true),status('テスト提出済'),status(Promise.resolve('unsubmitted')),{submissionStatus(){throw Error('unavailable');}}]){
 const result=R.plan(state('2026-10-31'),now('2026-10-31'),options);
 assert.equal(kind(result,'submission').length,0);assert.ok(result.blocked.some(issue=>issue.kind==='submission'&&issue.reason==='submission-status-unavailable'));
}
const exported=state('2026-10-31'),period=C.periods('2026-10-31')[2];
for(const test of [true,false]){
 exported.submissions[C.periodKey(period)]={at:'2026-10-31T00:00:00.000Z',test};
 assert.equal(kind(R.plan(exported,now('2026-10-31')),'submission').length,0,'local history is not authoritative');
 assert.equal(kind(R.plan(exported,now('2026-10-31'),status('unsubmitted')),'submission').length,1,'test/export history cannot suppress a genuine unsubmitted reminder');
}
assert.equal(kind(R.plan(state('2026-10-30'),now('2026-10-30'),status('unsubmitted')),'submission').length,0,'closing-day reminders do not invent an early deadline');
const mutating=R.plan(state('2026-10-31'),now('2026-10-31'),{submissionStatus(period){period.end='1900-01-01';return 'unsubmitted';}});
assert.equal(kind(mutating,'submission')[0].period.end,'2026-10-31','status lookups cannot mutate planned period metadata');
assert.ok(!JSON.stringify(planned.events).includes('作業内容'),'lock-screen copy contains no notes or employee details');
const browser={window:{PaperAttendance:C}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../day-designs/paper-reminders.js'),'utf8'),browser);
assert.deepEqual(plain(browser.window.PaperReminders.policy),plain(R.policy));
console.log('PASS 15th/month-end including weekends and leap day, authoritative submission gating, unknown status blocking, ignored mock/export history and browser/Node API parity');
