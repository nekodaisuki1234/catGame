"use strict";
// Keep unknown-calendar cases beyond the bundled data as yearly updates extend it.
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const context={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../day-designs/paper-holidays.js"),"utf8"),context);
const unknownYear=Number(context.window.PaperHolidays.end.slice(0,4))+1;
const unknownMonth=`${unknownYear}-06`;
const juneFirst=new Date(`${unknownMonth}-01T00:00:00Z`);
const firstMonday=1+(8-juneFirst.getUTCDay())%7;
const dayAt=offset=>`${unknownMonth}-${String(firstMonday+offset).padStart(2,"0")}`;
const unknownDay=dayAt(0),unknownNextDay=dayAt(1),unknownWeekend=dayAt(5),unknownAfterWeekend=dayAt(7);
module.exports={unknownYear,unknownMonth,unknownDay,unknownNextDay,unknownWeekend,unknownAfterWeekend,unknownTime:`${unknownDay}T12:00:00Z`};
