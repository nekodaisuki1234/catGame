(function(global){
"use strict";
// Cabinet Office, Japan: verified published calendars, not predicted equinox dates.
// Source: https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html
// Checked: 2026-10-27. The source publishes 2026 and 2027; 2028 is due in Feb 2027.
// Generic official "休日" entries are labelled by Article 3: (2) substitute,
// (3) the holiday between two national holidays (commonly "国民の休日").
global.PaperHolidays=Object.freeze({
 start:"2026-01-01",end:"2027-12-31",checked:"2026-10-27",
 source:"https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html",
 days:Object.freeze({
  "2026-01-01":"元日","2026-01-12":"成人の日","2026-02-11":"建国記念の日","2026-02-23":"天皇誕生日",
  "2026-03-20":"春分の日","2026-04-29":"昭和の日","2026-05-03":"憲法記念日","2026-05-04":"みどりの日",
  "2026-05-05":"こどもの日","2026-05-06":"振替休日","2026-07-20":"海の日","2026-08-11":"山の日",
  "2026-09-21":"敬老の日","2026-09-22":"国民の休日","2026-09-23":"秋分の日","2026-10-12":"スポーツの日",
  "2026-11-03":"文化の日","2026-11-23":"勤労感謝の日",
  "2027-01-01":"元日","2027-01-11":"成人の日","2027-02-11":"建国記念の日","2027-02-23":"天皇誕生日",
  "2027-03-21":"春分の日","2027-03-22":"振替休日","2027-04-29":"昭和の日","2027-05-03":"憲法記念日",
  "2027-05-04":"みどりの日","2027-05-05":"こどもの日","2027-07-19":"海の日","2027-08-11":"山の日",
  "2027-09-20":"敬老の日","2027-09-23":"秋分の日","2027-10-11":"スポーツの日","2027-11-03":"文化の日",
  "2027-11-23":"勤労感謝の日"
 })
});
})(window);
