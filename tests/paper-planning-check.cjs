"use strict";
const {unknownYear}=require("./paper-calendar-fixture.cjs");
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const context={window:{},Intl,Date};vm.createContext(context);
for(const file of ["paper-holidays.js","paper-core.js"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../day-designs",file),"utf8"),context);
const C=context.window.PaperAttendance,now={day:"2026-10-28",minutes:600},seed=C.seed(now);
const plain=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==="object"){Object.freeze(value);Object.values(value).forEach(freeze);}return value;}

assert.deepEqual(plain(seed.settings.plannedHoursByMonth),{},"new data starts in automatic mode");
assert.equal(C.validateSettings(seed.settings),"");
for(const [day,expected] of [
 ["2026-01-01",160],["2026-02-01",144],["2026-05-06",144],
 ["2026-09-22",152],["2026-10-01",168],["2026-10-28",168],["2026-10-31",168],
 ["2026-11-01",152],["2026-11-30",152],["2026-12-31",184],
 ["2027-01-01",152],["2027-02-28",144],["2027-03-22",176]
])assert.equal(C.plannedHours(seed.settings,day),expected,"full-month weekdays minus published holidays: "+day);
for(const day of ["2025-12-31",`${unknownYear}-01-01`,`${unknownYear}-02-01`]){
 assert.equal(C.plannedHours(seed.settings,day),null,"unpublished months cannot receive an invented total: "+day);
}
for(const day of ["2026-02-30","2026-13-01","2026-10",""])assert.equal(C.plannedHours(seed.settings,day),null);

for(const manual of [0,160,160.5,168,744]){
 const settings=freeze({...plain(seed.settings),plannedHoursByMonth:{"2026-10":manual}}),before=JSON.stringify(settings);
 assert.equal(C.validateSettings(settings),"");
 assert.equal(C.plannedHours(settings,"2026-10-01"),manual,"manual hours apply from the start of the month");
 assert.equal(C.plannedHours(settings,"2026-10-31"),manual,"manual hours apply through the end of the month");
 assert.equal(C.plannedHours(settings,"2026-11-01"),152,"the following month returns to automatic hours");
 assert.equal(JSON.stringify(settings),before,"resolution must not change saved settings");
}
const future={...plain(seed.settings),plannedHoursByMonth:{[`${unknownYear}-01`]:160}};
assert.equal(C.plannedHours(future,`${unknownYear}-01-31`),160,"manual hours work before the holiday calendar is published");
assert.equal(C.plannedHours(future,`${unknownYear}-02-01`),null,"a manual value must not leak into an unpublished neighbor month");
const inherited={...plain(seed.settings),plannedHoursByMonth:Object.create({"2026-10":9})};
assert.equal(C.plannedHours(inherited,"2026-10-28"),168,"only saved own keys are overrides");

const legacy=plain(seed);delete legacy.settings.plannedHoursByMonth;
legacy.submissions["2026-09-01|2026-09-30"]={at:"2026-10-01T00:00:00Z",test:true};
assert.equal(C.validateSettings(legacy.settings),"","old files without the new map remain valid");
for(const manual of [0,160,160.5,744]){
 const input=plain(legacy);input.settings.plannedHours=manual;freeze(input);
 const before=JSON.stringify(input),migrated=C.hydrate(input,now);
 assert.ok(migrated,"valid legacy data survives migration");
 assert.deepEqual(plain(migrated.settings.plannedHoursByMonth),{"2026-10":manual});
 assert.equal(C.plannedHours(migrated.settings,now.day),manual);
 assert.equal(C.plannedHours(migrated.settings,"2026-11-01"),152,"legacy hours are assigned to only the migration month");
 assert.equal(migrated.settings.plannedHours,manual,"retain the legacy field for old consumers");
 const withoutMap=plain(migrated);delete withoutMap.settings.plannedHoursByMonth;
 assert.deepEqual(withoutMap,plain(input),"migration preserves all records, history, defaults, settings and revision");
 assert.equal(JSON.stringify(input),before,"hydration must not mutate imported data");
 assert.notEqual(migrated.records,input.records,"hydration must return a separate record graph");
}
const defaultMigration=C.hydrate(freeze(legacy),now);
assert.deepEqual(plain(defaultMigration.settings.plannedHoursByMonth),{},"the former 168-hour demo default becomes automatic");
assert.equal(C.plannedHours(defaultMigration.settings,"2026-11-01"),152);
const novemberLegacy=plain(legacy);novemberLegacy.settings.plannedHours=160;
const novemberMigration=C.hydrate(novemberLegacy,{...now,day:"2026-11-01"});
assert.deepEqual(plain(novemberMigration.settings.plannedHoursByMonth),{"2026-11":160},"migration uses the current month, not a fixed demo month");
const alreadyMigrated=plain(seed);alreadyMigrated.settings.plannedHours=160;
const savedAutomatic=C.hydrate(alreadyMigrated,now);
assert.deepEqual(plain(savedAutomatic.settings.plannedHoursByMonth),{},"an existing empty map does not revive a removed override");
assert.equal(C.plannedHours(savedAutomatic.settings,now.day),168);
const savedManual=plain(seed);savedManual.settings.plannedHoursByMonth={"2026-10":0,"2026-11":168};
assert.deepEqual(plain(C.hydrate(savedManual,now)),savedManual,"existing monthly choices round-trip unchanged");

for(const map of [
 null,[],0,"160",true,
 {"2026-1":160},{"26-01":160},{"2026-00":160},{"2026-13":160},{"2026-10-01":160},
 {"2026-10":-1},{"2026-10":744.01},{"2026-10":NaN},{"2026-10":Infinity},
 {"2026-10":"160"},{"2026-10":null},{"2026-10":undefined}
]){
 const settings={...plain(seed.settings),plannedHoursByMonth:map};
 assert.match(C.validateSettings(settings),/勤務予定/,"reject malformed monthly overrides: "+String(map));
 assert.equal(C.hydrate({...seed,settings},now),null,"bad monthly data must not hydrate");
}
console.log("Paper monthly planning checks passed");
