"use strict";
const {chromium}=require(process.env.PAPER_PLAYWRIGHT_MODULE||"playwright");
const assert=require("node:assert/strict"),http=require("node:http"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,".."),server=http.createServer((req,res)=>{
 const file=path.resolve(root,"."+new URL(req.url,"http://local").pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{res.setHeader("Content-Type",file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":"text/html");res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
async function run(){
 await new Promise(r=>server.listen(0,"127.0.0.1",r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.PAPER_CHROMIUM_PATH||(fs.existsSync("/usr/bin/chromium")?"/usr/bin/chromium":undefined),args:["--no-sandbox"]});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:"ja-JP"}),page=await context.newPage(),errors=[];
  page.on("pageerror",e=>errors.push(e.message));await page.clock.install({time:new Date("2026-10-27T12:00:00Z")});
  const url="http://127.0.0.1:"+server.address().port+"/day-designs/a-paper.html?screen=1";
  await page.goto(url);
  async function fixture(){
   await page.evaluate(()=>{
    const C=window.PaperAttendance,now=C.clock(),state=C.seed(now);state.records={};
    for(const day of C.dates(C.FIRST,C.add(now.day,-1)))if(C.workday(day))state.records[day]={...C.empty(state),leave:"holiday"};
    state.records["2026-04-01"]={...C.empty(state),leave:"paid"};
    state.records["2026-10-20"]={...C.empty(state),leave:"am",start:"09:00",end:"13:00",breakMinutes:0,allocation:{P1:4,P2:0,P3:0,P4:0,P5:0,SET:0}};
    delete state.records["2026-10-26"];localStorage.setItem(C.KEY,JSON.stringify(state));
   });await page.reload();
  }
  const heading=t=>page.waitForFunction(v=>document.querySelector("main h1")?.textContent===v,t);
  const positions=()=>page.evaluate(()=>Object.fromEntries([".hero-composition","#punchActions",".time-area","#restEditor",".work-fields"].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return[s,{top:r.top+scrollY,height:r.height}];})));
  await fixture();
  assert.equal(await page.locator(".wordmark").innerText(),"SET");
  assert.equal(await page.locator("#homeOverview #homePaidLeave,#homeOverview #homeWorkdays").count(),0,"leave and workday metrics belong to performance, not the clock header");
  assert.equal(await page.locator("#detailArea .performance-panel #homePaidLeave").count(),1);
  assert.equal(await page.locator("#detailArea .performance-panel #homeWorkdays").count(),1);
  assert.equal(await page.locator("#homePaidLeave").textContent(),"1.5日");assert.equal(await page.locator("#homeWorkdays").textContent(),"21日");
  await page.locator("#nav-records").click();
  assert.match(await page.locator(".month-holidays").innerText(),/10\/12\s+スポーツの日/);
  assert.equal(await page.locator(".month-holiday-list li").count(),1);
  await page.locator("#monthInput").fill("2026-06");await page.locator("#monthInput").dispatchEvent("change");
  assert.equal(await page.locator(".month-holiday-empty").innerText(),"今月の祝日はありません");
  await page.locator("#nav-home").click();
  assert.equal(await page.locator("#homeMissingNotice").isVisible(),true);assert.match(await page.locator("#homeMissingNotice").innerText(),/1日/);
  const before=await positions();
  if(process.env.PAPER_SCREENSHOT_DIR){fs.mkdirSync(process.env.PAPER_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.PAPER_SCREENSHOT_DIR,"paper-holiday-warning.png")});}
  await page.locator("#homeMissingNotice").click();await heading("過去の未入力");assert.equal(await page.locator(".missing-day-link").count(),1);
  await page.locator(".missing-day-link").click();await heading("勤怠の編集");assert.equal(await page.locator("#editDate").inputValue(),"2026-10-26");
  await page.locator("#editLeave").selectOption("paid");await page.locator("#dayForm button[type=submit]").click();await page.locator("[data-action=editor-back]").click();await heading("過去の未入力");
  assert.equal(await page.locator(".missing-day-link").count(),0);assert.match(await page.locator(".missing-complete").innerText(),/未入力はありません/);
  await page.locator("[data-action=missing-back]").click();await heading("今日の勤怠");assert.equal(await page.locator("#homeMissingNotice").isVisible(),false);
  assert.equal(await page.locator("#homePaidLeave").textContent(),"2.5日");assert.deepEqual(await positions(),before,"resolving missing records must not move the clock, punches or fields");
  if(process.env.PAPER_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.PAPER_SCREENSHOT_DIR,"paper-holiday-clear.png")});
  console.log("PASS home fiscal leave, full-month business days, past-only missing list and paid-leave resolution with zero layout shift");
  // Public/company leave suppresses warnings; clearing it makes the warning return.
  await page.locator("[data-action=edit-day][data-day='2026-10-26']").click();await page.locator("#editLeave").selectOption("holiday");await page.locator("#dayForm button[type=submit]").click();await page.locator("[data-action=editor-back]").click();await heading("今日の勤怠");
  assert.equal(await page.locator("#homeMissingNotice").isVisible(),false);assert.equal(await page.locator("#homePaidLeave").textContent(),"1.5日");
  await page.locator("[data-action=edit-day][data-day='2026-10-26']").click();await page.locator("#editLeave").selectOption("");await page.locator("#dayForm button[type=submit]").click();await page.locator("[data-action=editor-back]").click();await heading("今日の勤怠");assert.equal(await page.locator("#homeMissingNotice").isVisible(),true);
  for(const width of [320,390,430,1280]){
   await page.setViewportSize({width,height:844});await fixture();const withWarning=await positions();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"home overflow "+width);
   const slot=await page.locator("#homeMissingSlot").boundingBox();assert.equal(slot.height,44);
   await page.evaluate(()=>{const C=window.PaperAttendance,state=JSON.parse(localStorage.getItem(C.KEY));state.records["2026-10-26"]={...C.empty(state),leave:"holiday"};state.revision++;localStorage.setItem(C.KEY,JSON.stringify(state));});await page.reload();
   assert.equal(await page.locator("#homeMissingNotice").isVisible(),false);assert.deepEqual(await positions(),withWarning,"layout moved at "+width);
  }
  console.log("PASS company-holiday suppression, cleared-leave warnings, fixed 44px notice and identical 320–1280px layouts");
  // The holiday name appears on the initial screen, list and dedicated editor.
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00Z"));await page.reload();
  assert.equal(await page.locator(".hero-holiday").innerText(),"文化の日");assert.equal(await page.locator("#homeWorkdays").textContent(),"19日");
  await page.locator("#nav-records").click();const holiday=page.locator(".paper-record[data-day='2026-11-03']");assert.equal(await holiday.evaluate(n=>n.classList.contains("is-holiday")),true);assert.match(await holiday.innerText(),/文化の日/);
  assert.equal(await page.locator(".month-holiday-list li").count(),2);
  assert.match(await page.locator(".month-holidays").innerText(),/11\/3\s+文化の日/);
  assert.match(await page.locator(".month-holidays").innerText(),/11\/23\s+勤労感謝の日/);
  await holiday.click();assert.equal(await page.locator(".editor-holiday-name").innerText(),"文化の日");await page.locator("#editStart").fill("09:00");await page.locator("#editEnd").fill("18:00");await page.locator("#editAllocP1").fill("8");await page.locator("#dayForm button[type=submit]").click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(window.PaperAttendance.KEY)).records["2026-11-03"].end),"18:00");
  await page.clock.setFixedTime(new Date("2028-06-15T12:00:00Z"));await page.reload();await page.locator("#nav-records").click();
  assert.equal(await page.locator(".month-holiday-empty").innerText(),"この月の祝日データは未収録です");
  assert.equal(await page.locator(".month-holiday-list li").count(),0);
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00Z"));await page.reload();await page.locator("#nav-records").click();
  for(const width of [320,390,430,1280]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"holiday row overflow "+width);assert.equal(await page.locator(".month-holiday-list li").count(),2);}
  assert.deepEqual(errors,[]);console.log("PASS SET wordmark, performance metrics, monthly holiday names/empty/unknown states, 320–1280px holiday rows and normal work records on public holidays");
 }finally{await browser.close();}
}
run().then(()=>server.close(),e=>{console.error(e);server.close();process.exitCode=1});
