"use strict";
const {unknownMonth,unknownTime}=require("./paper-calendar-fixture.cjs");
// Run with Playwright/Chromium; PAPER_PLAYWRIGHT_MODULE can point to an installed module.
const {chromium}=require(process.env.PAPER_PLAYWRIGHT_MODULE||"playwright");
const assert=require("node:assert/strict"),http=require("node:http"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,".."),server=http.createServer((req,res)=>{
 const file=path.resolve(root,"."+new URL(req.url,"http://local").pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{res.setHeader("Content-Type",file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":"text/html");res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
async function run(){
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.PAPER_CHROMIUM_PATH||(fs.existsSync("/usr/bin/chromium")?"/usr/bin/chromium":undefined),args:["--no-sandbox"]}),errors=[];
 const url="http://127.0.0.1:"+server.address().port+"/day-designs/a-paper.html?screen=1";
 const fresh=async(time,options={})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:"ja-JP"}),page=await context.newPage();
  page.on("pageerror",error=>errors.push(error.message));await page.clock.install({time:new Date(time)});await page.goto(url);
  await page.evaluate(options=>{
   const C=window.PaperAttendance,state=C.seed(C.clock());state.records={};
   // Ten completed workdays give 80 hours: the difference between 168 and 160 is visible in the ring.
   for(const day of ["2026-10-01","2026-10-02","2026-10-05","2026-10-06","2026-10-07","2026-10-08","2026-10-09","2026-10-13","2026-10-14","2026-10-15"]){
    state.records[day]={...C.empty(state),start:"09:00",end:"18:00",breakMinutes:60,allocation:{P1:8,P2:0,P3:0,P4:0,SET:0}};
   }
   state.settings.plannedHoursByMonth=options.overrides||{};
   if(Object.hasOwn(options,"legacy")){delete state.settings.plannedHoursByMonth;state.settings.plannedHours=options.legacy;}
   localStorage.setItem(C.KEY,JSON.stringify(state));
  },options);await page.reload();return page;
 };
 const state=page=>page.evaluate(()=>JSON.parse(localStorage.getItem(window.PaperAttendance.KEY)));
 const openPlan=async page=>{
  await page.locator("#nav-settings").click();
  await page.locator("[data-action=settings-tab][data-tab=sheet]").click();
  assert.equal(await page.locator("main h1").innerText(),"設定");
  assert.equal(await page.locator("[data-action=settings-tab][data-tab=sheet]").getAttribute("aria-pressed"),"true");
  assert.equal(await page.locator("#settingsForm").isVisible(),true);
 };
 const savePlan=page=>page.locator("#settingsForm button[type=submit]").click();
 const setMode=(page,mode)=>page.locator("#plannedHoursMode").selectOption(mode);
 const expectMode=async(page,mode,value)=>{
  assert.equal(await page.locator("#plannedHoursMode").inputValue(),mode);
  assert.equal(await page.locator("#plannedHours").isDisabled(),false,"automatic plans must remain directly editable");
  assert.equal(await page.locator("#plannedHours").inputValue(),value);
 };
 const expectSummary=async(page,planned,percent,remaining,offset)=>{
  assert.equal(await page.locator("#plannedHoursValue").innerText(),String(planned));
  assert.match(await page.locator(".planned-caption").innerText(),/勤務予定/);
  assert.equal(await page.locator("#monthlyPercent").innerText(),percent);
  assert.equal(await page.locator("#remainingHours").innerText(),remaining);
  assert.ok(Math.abs(Number(await page.locator("#progressArc").getAttribute("stroke-dashoffset"))-offset)<0.001,"progress arc must use the active month's plan");
  assert.doesNotMatch(await page.locator(".performance-panel").innerText(),/NaN|Infinity/);
 };
 const moveClock=async(page,time)=>{await page.clock.setSystemTime(new Date(time));await page.clock.runFor(1100);};
 const noOverflow=async(page,label)=>{
  for(const width of [320,390,430]){
   await page.setViewportSize({width,height:844});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+" overflow at "+width);
   for(const selector of ["#plannedHoursValue","[data-action=edit-plan]","#plannedHoursMode","#plannedHours","#plannedHoursHint","#planMode","#planHoursInput","#planHoursHint"]){
    const node=page.locator(selector);if(!await node.count())continue;
    const box=await node.boundingBox();assert.ok(box&&box.x>=-1&&box.x+box.width<=width+1,label+" "+selector+" outside viewport at "+width);
   }
  }
  await page.setViewportSize({width:390,height:844});
 };
 const openPlanDialog=async page=>{
  await page.locator("[data-action=edit-plan]").click();
  assert.equal(await page.locator("#paperDialog").evaluate(node=>node.open),true);
  assert.equal(await page.locator("#planForm").getAttribute("data-month"),"2026-10");
  assert.equal(await page.locator("main h1").innerText(),"今日の勤怠");
 };
 const savePlanDialog=async page=>{
  await page.locator("#planForm button[type=submit]").click();
  await page.waitForFunction(()=>!document.querySelector("#paperDialog").open);
 };
 try{
  // A monthly plan is a small, independent edit, even with an invalid settings draft elsewhere.
  const compact=await fresh("2026-10-27T12:00:00Z",{overrides:{"2026-09":152,"2026-11":144}});
  await openPlan(compact);await compact.locator("#minHours").fill("");await compact.locator("#projectName").fill("");
  await compact.locator("#maxHours").fill("186");await compact.locator("#nav-home").click();
  const beforeCompact=await state(compact);await openPlanDialog(compact);
  assert.equal(await compact.locator("#planMode").inputValue(),"auto");assert.equal(await compact.locator("#planHoursInput").isEditable(),true);
  await compact.locator("#planHoursInput").fill("160");
  assert.equal(await compact.locator("#planMode").inputValue(),"manual","typing a plan must select manual mode automatically");
  await noOverflow(compact,"compact monthly plan");await savePlanDialog(compact);
  const afterCompact=await state(compact);
  assert.deepEqual(afterCompact.settings,{...beforeCompact.settings,plannedHoursByMonth:{"2026-09":152,"2026-10":160,"2026-11":144}},"the dialog must save only this month's override");
  assert.deepEqual(afterCompact.submissions,beforeCompact.submissions);await expectSummary(compact,160,"50%","予定まで 80時間",50);
  await openPlan(compact);assert.equal(await compact.locator("#minHours").inputValue(),"");assert.equal(await compact.locator("#projectName").inputValue(),"");
  assert.equal(await compact.locator("#maxHours").inputValue(),"186");await expectMode(compact,"manual","160");
  await compact.locator("#nav-home").click();await compact.reload();await expectSummary(compact,160,"50%","予定まで 80時間",50);
  await openPlanDialog(compact);await compact.locator("[data-action=plan-auto]").click();
  assert.equal(await compact.locator("#planMode").inputValue(),"auto");assert.equal(await compact.locator("#planHoursInput").inputValue(),"168");
  await savePlanDialog(compact);assert.deepEqual((await state(compact)).settings.plannedHoursByMonth,{"2026-09":152,"2026-11":144});
  await expectSummary(compact,168,"48%","予定まで 88時間",100-80/168*100);
  console.log("PASS direct monthly dialog typing, isolated save despite invalid settings drafts, other-month preservation, reload and automatic reset");

  const page=await fresh("2026-10-27T12:00:00Z");
  assert.deepEqual((await state(page)).settings.plannedHoursByMonth,{});
  assert.equal(await page.locator("#homeWorkdays").innerText(),"21日");
  await expectSummary(page,168,"48%","予定まで 88時間",100-80/168*100);
  await openPlan(page);await expectMode(page,"auto","168");
  const hint=await page.locator("#plannedHoursHint").innerText();assert.match(hint,/2026/);assert.match(hint,/10/);assert.match(hint,/土日|祝日/);assert.match(hint,/8/);
  console.log("PASS October's automatic plan covers all 21 business days, including days after today");

  // The mode switch must preserve a manual draft while showing the computed value in automatic mode.
  await setMode(page,"manual");await expectMode(page,"manual","168");await page.locator("#plannedHours").fill("160");
  await setMode(page,"auto");await expectMode(page,"auto","168");await setMode(page,"manual");await expectMode(page,"manual","160");
  await setMode(page,"auto");await page.locator('[data-action="project-tab"][data-index="1"]').click();await page.locator('[data-action="place-tab"][data-index="1"]').click();
  await expectMode(page,"auto","168");await setMode(page,"manual");await expectMode(page,"manual","160");
  await page.locator('[data-action="project-tab"][data-index="0"]').click();await page.locator('[data-action="place-tab"][data-index="0"]').click();
  await page.locator("#minHours").fill("150");await page.locator("#maxHours").fill("187");await page.locator("#projectName").fill("PJの下書き");
  await page.locator('[data-action="project-tab"][data-index="1"]').click();await expectMode(page,"manual","160");assert.equal(await page.locator("#minHours").inputValue(),"150");assert.equal(await page.locator("#maxHours").inputValue(),"187");
  await page.locator('[data-action="place-tab"][data-index="1"]').click();await expectMode(page,"manual","160");await page.locator("#placeName").fill("場所の下書き");
  await page.locator('[data-action="project-tab"][data-index="0"]').click();assert.equal(await page.locator("#projectName").inputValue(),"PJの下書き");
  await page.locator('[data-action="place-tab"][data-index="0"]').click();await page.locator('[data-action="place-tab"][data-index="1"]').click();assert.equal(await page.locator("#placeName").inputValue(),"場所の下書き");await expectMode(page,"manual","160");
  assert.deepEqual((await state(page)).settings.plannedHoursByMonth,{},"changing mode or selectors must not save a draft");
  await savePlan(page);assert.deepEqual((await state(page)).settings.plannedHoursByMonth,{"2026-10":160});
  assert.equal((await state(page)).settings.projects[0].name,"PJの下書き");assert.equal((await state(page)).settings.places[1].name,"場所の下書き");
  await page.locator("#nav-home").click();await expectSummary(page,160,"50%","予定まで 80時間",50);
  await page.clock.runFor(1100);await expectSummary(page,160,"50%","予定まで 80時間",50);
  await page.reload();await expectSummary(page,160,"50%","予定まで 80時間",50);await openPlan(page);await expectMode(page,"manual","160");
  console.log("PASS manual 160 persists, summary rendering and live updates use it, and PJ/place selectors retain settings drafts");

  // Crossing into November must use its 19 business days, then restore October's own override.
  await page.locator("#nav-home").click();await moveClock(page,"2026-11-03T12:00:00Z");
  assert.equal(await page.locator("#homeWorkdays").innerText(),"19日");await expectSummary(page,152,"0%","予定まで 152時間",100);
  await openPlan(page);await expectMode(page,"auto","152");assert.match(await page.locator("#plannedHoursHint").innerText(),/11/);
  await page.locator("#nav-home").click();await moveClock(page,"2026-10-27T12:00:00Z");await expectSummary(page,160,"50%","予定まで 80時間",50);
  await moveClock(page,"2026-11-03T12:00:00Z");await openPlan(page);await setMode(page,"manual");await page.locator("#plannedHours").fill("144");await savePlan(page);
  assert.deepEqual((await state(page)).settings.plannedHoursByMonth,{"2026-10":160,"2026-11":144});
  await page.locator("#nav-home").click();await moveClock(page,"2026-10-27T12:00:00Z");await openPlan(page);await expectMode(page,"manual","160");
  await setMode(page,"auto");await savePlan(page);assert.deepEqual((await state(page)).settings.plannedHoursByMonth,{"2026-11":144},"automatic mode deletes only the current month's override");
  await page.locator("#nav-home").click();await expectSummary(page,168,"48%","予定まで 88時間",100-80/168*100);
  await moveClock(page,"2026-11-03T12:00:00Z");await expectSummary(page,144,"0%","予定まで 144時間",100);
  await moveClock(page,"2026-10-27T12:00:00Z");
  console.log("PASS month rollover, November holidays, restoring October's override, and isolated automatic resets");

  // Empty is invalid; an explicitly entered zero is a valid override with no ratio.
  await openPlan(page);await setMode(page,"manual");await page.locator("#plannedHours").fill("");
  await page.locator('[data-action="project-tab"][data-index="1"]').click();await page.locator('[data-action="place-tab"][data-index="1"]').click();await expectMode(page,"manual","");
  const blankRevision=(await state(page)).revision;await savePlan(page);
  assert.equal((await state(page)).revision,blankRevision);assert.deepEqual((await state(page)).settings.plannedHoursByMonth,{"2026-11":144});
  assert.equal(await page.locator("#plannedHours").evaluate(node=>node.validity.valueMissing),true);
  await setMode(page,"auto");await expectMode(page,"auto","168");await setMode(page,"manual");await expectMode(page,"manual","");
  await page.locator("#plannedHours").fill("0");await savePlan(page);assert.deepEqual((await state(page)).settings.plannedHoursByMonth,{"2026-10":0,"2026-11":144});
  await page.locator("#nav-home").click();await expectSummary(page,0,"—","予定未設定",100);await page.clock.runFor(1100);await expectSummary(page,0,"—","予定未設定",100);
  assert.match(await page.locator(".progress-ring").getAttribute("aria-label"),/予定未設定/);await noOverflow(page,"zero-plan home");
  await page.reload();await expectSummary(page,0,"—","予定未設定",100);await openPlan(page);await expectMode(page,"manual","0");await noOverflow(page,"manual-plan settings");
  await setMode(page,"auto");await expectMode(page,"auto","168");await noOverflow(page,"automatic-plan settings");
  console.log("PASS blank rejection, blank draft preservation, explicit zero, finite progress, and 320/390/430px home/settings layouts");

  // Dates outside the published holiday calendar cannot invent an automatic plan.
  const unknown=await fresh(unknownTime,{overrides:{"2026-11":144}});
  assert.equal(await unknown.locator("#homeWorkdays").innerText(),"—日");await expectSummary(unknown,"—","—","予定未設定",100);await noOverflow(unknown,"unknown-calendar home");
  await openPlan(unknown);await expectMode(unknown,"auto","");assert.match(await unknown.locator("#plannedHoursHint").innerText(),/未収録/);await noOverflow(unknown,"unknown-calendar settings");
  await setMode(unknown,"manual");assert.equal(await unknown.locator("#plannedHours").isEnabled(),true);await unknown.locator("#plannedHours").fill("120");await savePlan(unknown);
  assert.deepEqual((await state(unknown)).settings.plannedHoursByMonth,{"2026-11":144,[unknownMonth]:120});await unknown.locator("#nav-home").click();await expectSummary(unknown,120,"0%","予定まで 120時間",100);
  await unknown.reload();await expectSummary(unknown,120,"0%","予定まで 120時間",100);await openPlan(unknown);await expectMode(unknown,"manual","120");
  await setMode(unknown,"auto");await expectMode(unknown,"auto","");await savePlan(unknown);assert.deepEqual((await state(unknown)).settings.plannedHoursByMonth,{"2026-11":144});
  await unknown.locator("#nav-home").click();await expectSummary(unknown,"—","—","予定未設定",100);
  console.log("PASS unknown-calendar automatic plan stays unavailable, manual plans save/reload, and automatic reset can save an editable blank field");

  // The former global 168 default becomes automatic; a customized legacy value is retained for the migration month.
  const legacyDefault=await fresh("2026-11-03T12:00:00Z",{legacy:168});await expectSummary(legacyDefault,152,"0%","予定まで 152時間",100);
  await openPlan(legacyDefault);await expectMode(legacyDefault,"auto","152");await savePlan(legacyDefault);assert.deepEqual((await state(legacyDefault)).settings.plannedHoursByMonth,{});
  const legacyManual=await fresh("2026-11-03T12:00:00Z",{legacy:160});await expectSummary(legacyManual,160,"0%","予定まで 160時間",100);
  await openPlan(legacyManual);await expectMode(legacyManual,"manual","160");await savePlan(legacyManual);assert.deepEqual((await state(legacyManual)).settings.plannedHoursByMonth,{"2026-11":160});
  await legacyManual.locator("#nav-home").click();await moveClock(legacyManual,"2026-10-27T12:00:00Z");await expectSummary(legacyManual,168,"48%","予定まで 88時間",100-80/168*100);
  assert.deepEqual(errors,[]);console.log("PASS legacy default/custom migration is month-scoped, with no browser errors");
 }finally{await browser.close();}
}
run().then(()=>server.close(),error=>{console.error(error);server.close();process.exitCode=1});
