"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const U=require("../scripts/update-paper-holidays.cjs");
// Cabinet Office 2026–2027 CSV snapshot, Shift_JIS including its original header.
const bytes=Buffer.from("jZGWr4LMj2qT+oFFi3iT+oyOk/osjZGWr4LMj2qT+oFFi3iT+pa8j8wNCjIwMjYvMS8xLIyzk/oNCjIwMjYvMS8xMiyQrJBsgsyT+g0KMjAyNi8yLzExLIyajZGLTJRPgsyT+g0KMjAyNi8yLzIzLJNWjWOSYZC2k/oNCjIwMjYvMy8yMCyPdJWqgsyT+g0KMjAyNi80LzI5LI+6mGGCzJP6DQoyMDI2LzUvMyyMm5ZAi0yUT5P6DQoyMDI2LzUvNCyC3YLHguiCzJP6DQoyMDI2LzUvNSyCsYLHguCCzJP6DQoyMDI2LzUvNiyLeJP6DQoyMDI2LzcvMjAsikOCzJP6DQoyMDI2LzgvMTEsjlKCzJP6DQoyMDI2LzkvMjEsjGiYVoLMk/oNCjIwMjYvOS8yMiyLeJP6DQoyMDI2LzkvMjMsj0iVqoLMk/oNCjIwMjYvMTAvMTIsg1iDfIFbg2OCzJP6DQoyMDI2LzExLzMslbaJu4LMk/oNCjIwMjYvMTEvMjMsi86YSoq0jtOCzJP6DQoyMDI3LzEvMSyMs5P6DQoyMDI3LzEvMTEskKyQbILMk/oNCjIwMjcvMi8xMSyMmo2Ri0yUT4LMk/oNCjIwMjcvMi8yMyyTVo1jkmGQtpP6DQoyMDI3LzMvMjEsj3SVqoLMk/oNCjIwMjcvMy8yMiyLeJP6DQoyMDI3LzQvMjksj7qYYYLMk/oNCjIwMjcvNS8zLIyblkCLTJRPk/oNCjIwMjcvNS80LILdgseC6ILMk/oNCjIwMjcvNS81LIKxgseC4ILMk/oNCjIwMjcvNy8xOSyKQ4LMk/oNCjIwMjcvOC8xMSyOUoLMk/oNCjIwMjcvOS8yMCyMaJhWgsyT+g0KMjAyNy85LzIzLI9IlaqCzJP6DQoyMDI3LzEwLzExLINYg3yBW4NjgsyT+g0KMjAyNy8xMS8zLJW2ibuCzJP6DQoyMDI3LzExLzIzLIvOmEqKtI7TgsyT+g0K","base64");
const text=new TextDecoder("shift_jis",{fatal:true}).decode(bytes);
const options={expectedYear:2027},calendar=U.parseCsv(bytes,options);
assert.equal(calendar.start,"2026-01-01");assert.equal(calendar.end,"2027-12-31");
assert.equal(calendar.days["2026-05-06"],"振替休日");
assert.equal(calendar.days["2026-09-22"],"国民の休日");
assert.equal(calendar.days["2027-03-22"],"振替休日");
assert.equal(Object.keys(calendar.days).length,35);
assert.throws(()=>U.parseCsv(bytes,{expectedYear:2028}),/has not been published/);
assert.throws(()=>U.parseCsv(bytes,{expectedYear:NaN}),/Invalid expected year/);
assert.throws(()=>U.parseCsv(Buffer.alloc(0),options),/empty or too large/);
assert.throws(()=>U.parseCsv(Buffer.alloc(2_000_001),options),/too large/);
assert.throws(()=>U.parseCsv(Buffer.from([0x81]),options));
const invalid=[
 [text.replace("国民の祝日・休日名称","違う列"),/header/],
 [text.replace("2026/1/1","2026/2/30"),/date/],
 [text.replace("2026/1/12","2026/1/1"),/duplicate/],
 [text.replace("2026/1/1,元日","2026/1/1,謎の祝日"),/Unknown holiday/],
 [text.replace("2026/1/1,元日\r\n",""),/Incomplete/],
 [text.replace("2026/5/6,休日\r\n",""),/Missing substitute/],
 [text.replace("2026/9/22,休日\r\n",""),/Missing citizen/],
 [text.replace("2026/1/12,成人の日","2026/1/2,休日\r\n2026/1/12,成人の日"),/Cannot classify/],
 [text.split("2027/1/1")[0],/has not been published/]
];
for(const [csv,error] of invalid)assert.throws(()=>U.parseText(csv,options),error);
const current={...calendar,checked:"2026-10-27",source:U.PAGE};
const unchanged=U.prepareUpdate(bytes,current,{...options,checked:"2026-10-30"});
assert.equal(unchanged.changed,false);assert.equal(unchanged.content,null,"no confirmation-date-only PR");
assert.throws(()=>U.prepareUpdate(bytes,{...current,end:"2028-12-31"},options),/remove previously supported/);
const old={...current,end:"2026-12-31",days:Object.fromEntries(Object.entries(calendar.days).filter(([day])=>day.startsWith("2026-")))};
const update=U.prepareUpdate(bytes,old,{...options,checked:"2026-10-30"});
assert.equal(update.changed,true);assert.equal(update.calendar.end,"2027-12-31");
const context={window:{}};vm.runInNewContext(update.content,context);
assert.equal(context.window.PaperHolidays.checked,"2026-10-30");
assert.equal(context.window.PaperHolidays.csvSource,U.CSV);
assert.equal(Object.isFrozen(context.window.PaperHolidays.days),true);
assert.deepEqual(JSON.parse(JSON.stringify(context.window.PaperHolidays.days)),calendar.days);
for(const name of ["a-paper.html","a-paper-app.html"]){
 const html=fs.readFileSync(path.join(__dirname,"../day-designs",name),"utf8");
 const next=U.refreshHolidayAsset(html,calendar);
 assert.match(next,/paper-holidays\.js\?v=holidays-2027-[a-f0-9]{12}/);
 assert.equal(next.replace(/paper-holidays\.js\?v=[^"']+/g,"paper-holidays.js"),html.replace(/paper-holidays\.js\?v=[^"']+/g,"paper-holidays.js"),"only holiday asset URL changes");
 assert.equal(U.refreshHolidayAsset(next,calendar),next,"stable cache key");
}
assert.throws(()=>U.refreshHolidayAsset("<html></html>",calendar),/exactly one/);
assert.throws(()=>U.refreshHolidayAsset('<script src="paper-holidays.js"></script>'.repeat(2),calendar),/exactly one/);
console.log("PASS official Shift_JIS CSV, complete years, substitute/citizen names, invalid/truncated/future input, retained years, no-op and holiday-only cache refresh");
