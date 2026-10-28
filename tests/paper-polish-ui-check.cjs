"use strict";
// Run with Playwright/Chromium; PAPER_PLAYWRIGHT_MODULE can point to an installed module.
const {chromium}=require(process.env.PAPER_PLAYWRIGHT_MODULE||"playwright");
const assert=require("node:assert/strict"),http=require("node:http"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,".."),server=http.createServer((req,res)=>{
 const file=path.resolve(root,"."+new URL(req.url,"http://local").pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{res.setHeader("Content-Type",file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":"text/html");res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
const ENTRIES=[{file:"a-paper.html?screen=1",mode:"demo",key:"day-paper-attendance-v1"},{file:"a-paper-app.html",mode:"local",key:"day-paper-local-v1"}];
const OCTOBER="2026-10-27T12:00:00Z",HOLIDAY="2026-11-03T12:00:00Z",WIDTHS=[320,390,430];
async function run(){
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.PAPER_CHROMIUM_PATH||(fs.existsSync("/usr/bin/chromium")?"/usr/bin/chromium":undefined),args:["--no-sandbox"]}),errors=[];
 const origin="http://127.0.0.1:"+server.address().port;
 const ready=page=>page.locator("#startPunch").waitFor();
 const raw=page=>page.evaluate(()=>localStorage.getItem(window.PaperConfig.storageKey));
 const stored=async page=>JSON.parse(await raw(page));
 const fixture=async(page,{missing=true}={})=>{
  await page.evaluate(({missing})=>{
   const C=window.PaperAttendance,config=window.PaperConfig,now=C.clock();
   const state=config.mode==="local"?C.createState(now,{startDay:"2026-10-01"}):C.seed(now);
   state.records={};
   for(const day of C.dates(C.firstDay(state),C.add(now.day,-1)))if(C.workday(day))state.records[day]={...C.empty(state),leave:"holiday"};
   const previous=C.dates(C.firstDay(state),C.add(now.day,-1)).filter(day=>C.workday(day)).at(-1);
   if(missing&&previous)delete state.records[previous];
   state.settings.plannedHoursByMonth={"2026-09":152,"2026-11":144};
   state.submissions={"2026-10-01|2026-10-15":{at:"2026-10-16T09:00:00+09:00",test:true}};
   localStorage.setItem(config.storageKey,JSON.stringify(state));
  },{missing});await page.reload();await ready(page);
 };
 const fresh=async(entry,time=OCTOBER)=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:"ja-JP"}),page=await context.newPage();
  page.on("pageerror",error=>errors.push(entry.mode+": "+error.message));
  await page.clock.install({time:new Date(time)});await page.goto(origin+"/day-designs/"+entry.file);await ready(page);await fixture(page);
  assert.deepEqual(await page.evaluate(()=>({mode:window.PaperConfig.mode,key:window.PaperConfig.storageKey})),{mode:entry.mode,key:entry.key});
  return {context,page};
 };
 const openSettings=async page=>{await page.locator("#nav-settings").click();await page.locator("[data-action=settings-tab][data-tab=sheet]").click();};
 const openPlan=async(page,month="2026-10")=>{
  await page.locator("[data-action=edit-plan]").click();
  assert.equal(await page.locator("#paperDialog").evaluate(node=>node.open),true);
  assert.equal(await page.locator("#planForm").getAttribute("data-month"),month);
  assert.equal(await page.locator("#planHoursInput").isEditable(),true);
 };
 const savePlan=async page=>{await page.locator("#planForm button[type=submit]").click();await page.waitForFunction(()=>!document.querySelector("#paperDialog").open);};
 const expectSummary=async(page,value)=>{
  assert.equal(await page.locator("#plannedHoursValue").innerText(),String(value));
  assert.doesNotMatch(await page.locator(".performance-panel").innerText(),/NaN|Infinity/);
 };
 const paperAppearance=async page=>{
  const appearance=await page.evaluate(()=>{
   const css=getComputedStyle(document.documentElement),logo=getComputedStyle(document.querySelector(".wordmark"));
   return {theme:document.documentElement.dataset.theme,colors:Object.fromEntries(["--paper","--ink","--muted","--line","--primary","--secondary"].map(name=>[name,css.getPropertyValue(name).trim()])),logoFont:logo.fontFamily,logoColor:logo.color};
  });
  assert.equal(appearance.theme,"paper");assert.deepEqual(appearance.colors,{"--paper":"#f4f3f1","--ink":"#283a4c","--muted":"#626d79","--line":"#cbd0d4","--primary":"#2c425b","--secondary":"#50736a"});
  assert.match(appearance.logoFont,/Georgia/);assert.equal(appearance.logoColor,"rgb(44, 66, 91)");assert.equal(await page.locator(".wordmark").innerText(),"SET");
 };
 // Measure rendered fields and their real tap areas, including a checkbox's associated label.
 const controls=async(page,selector,label)=>{
  const metrics=await page.locator(selector).evaluateAll(nodes=>{
   const visible=node=>{const rect=node.getBoundingClientRect(),style=getComputedStyle(node);return rect.width>0&&rect.height>0&&style.visibility!=="hidden"&&style.display!=="none";};
   return nodes.filter(visible).map((node,index)=>{
    const target=["checkbox","radio"].includes(node.type)?node.closest("label")||node:node,rect=target.getBoundingClientRect();
    return {name:node.id||node.dataset.action||node.tagName+":"+index,left:rect.left,right:rect.right,width:rect.width,height:rect.height,font:parseFloat(getComputedStyle(node).fontSize),field:node.matches("input:not([type=checkbox]):not([type=radio]),select,textarea")};
   });
  });
  assert.ok(metrics.length,label+" must include visible controls");
  const width=page.viewportSize().width;
  for(const metric of metrics){
   assert.ok(metric.left>=-1&&metric.right<=width+1,label+" "+metric.name+" outside viewport: "+JSON.stringify(metric));
   assert.ok(metric.width>=43.5&&metric.height>=43.5,label+" "+metric.name+" tap area below 44px: "+JSON.stringify(metric));
   if(metric.field)assert.ok(metric.font>=16,label+" "+metric.name+" input text below 16px");
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+" page has horizontal overflow");
  const dialog=page.locator("#paperDialog[open]");
  if(await dialog.count())assert.ok(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1),label+" dialog has horizontal overflow");
 };
 const homeControls=".time-area input,.work-fields input,.work-fields select,.work-fields textarea,#restEditor input,#restEditor button,.punch-actions button,[data-action=edit-plan]";
 const formControls=form=>form+" input,"+form+" select,"+form+" textarea,"+form+" button";
 const homePositions=page=>page.evaluate(()=>Object.fromEntries([".hero-composition",".hero-date","#paperClock","#punchActions",".time-area","#restEditor",".work-fields"].map(selector=>{
  const rect=document.querySelector(selector).getBoundingClientRect();return [selector,{top:rect.top+scrollY,height:rect.height}];
 })));
 const clockGeometry=async(page,label,holiday)=>{
  const geometry=await page.evaluate(()=>{
   const date=document.querySelector(".hero-date"),clock=document.querySelector("#paperClock"),wrap=document.querySelector(".clock-wrap"),name=document.querySelector(".hero-holiday");
   const box=node=>{const rect=node.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right,width:rect.width,height:rect.height};};
   const range=document.createRange();range.selectNodeContents(date.firstChild);const rect=range.getBoundingClientRect();
   return {date:box(date),clock:box(clock),wrap:box(wrap),holiday:box(name),dateText:{top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right},font:getComputedStyle(clock).fontFamily,caption:box(document.querySelector(".clock-caption")),punches:box(document.querySelector("#punchActions"))};
  });
  const gap=geometry.clock.top-geometry.date.bottom,wrapGap=geometry.wrap.top-geometry.date.bottom;
  assert.ok(gap>=-0.5&&gap<=12,label+" visible clock/date gap must be at most 12px: "+gap);
  assert.ok(wrapGap>=-0.5&&wrapGap<=8,label+" clock wrapper/date gap must be at most 8px: "+wrapGap);
  assert.ok(geometry.clock.top-geometry.wrap.top<=8,label+" clock line box must remain close to its wrapper");
  assert.ok(geometry.caption.bottom<=geometry.punches.top+1,label+" clock caption overlaps punch controls");assert.match(geometry.font,/Georgia/);
  if(holiday){
   assert.equal(await page.locator(".hero-holiday").innerText(),"文化の日");
   assert.ok(geometry.holiday.width>0&&geometry.holiday.height>0,label+" holiday must be visible");
   assert.ok(Math.abs((geometry.dateText.top+geometry.dateText.bottom)/2-(geometry.holiday.top+geometry.holiday.bottom)/2)<=5,label+" holiday must share the date row");
   assert.ok(geometry.dateText.right<=geometry.holiday.left+1,label+" holiday overlaps the date text");
   assert.ok(geometry.holiday.bottom<=geometry.clock.top+1,label+" holiday overlaps the clock");
  }
 };
 try{
  for(const entry of ENTRIES){
   const {context,page}=await fresh(entry),label=entry.mode;
   await paperAppearance(page);await expectSummary(page,168);
   const original=await stored(page);await openPlan(page);
   assert.equal(await page.locator("#planMode").inputValue(),"auto");assert.equal(await page.locator("#planHoursInput").inputValue(),"168");
   await page.locator("#planHoursInput").fill("160");assert.equal(await page.locator("#planMode").inputValue(),"manual");
   await savePlan(page);await expectSummary(page,160);
   assert.deepEqual((await stored(page)).settings,{...original.settings,plannedHoursByMonth:{"2026-09":152,"2026-10":160,"2026-11":144}});
   await page.reload();await ready(page);await expectSummary(page,160);await openPlan(page);
   assert.equal(await page.locator("#planMode").inputValue(),"manual");assert.equal(await page.locator("#planHoursInput").inputValue(),"160");
   await page.locator("#planHoursInput").fill("158");await page.locator("#planMode").selectOption("auto");
   assert.equal(await page.locator("#planHoursInput").inputValue(),"168");await page.locator("#planMode").selectOption("manual");
   assert.equal(await page.locator("#planHoursInput").inputValue(),"158","mode switches must retain the unsaved manual draft");
   await page.locator("[data-action=plan-auto]").click();assert.equal(await page.locator("#planHoursInput").inputValue(),"168");
   await savePlan(page);await expectSummary(page,168);assert.deepEqual((await stored(page)).settings.plannedHoursByMonth,{"2026-09":152,"2026-11":144});

   // Global settings may contain an invalid draft; a monthly update still saves independently.
   await openSettings(page);assert.equal(await page.locator("#plannedHours").isEditable(),true);
   await page.locator("#plannedHours").fill("156");assert.equal(await page.locator("#plannedHoursMode").inputValue(),"manual");
   await page.locator("#minHours").fill("");await page.locator("#projectName").fill("");await page.locator("#workSummary").fill("未保存の設定下書き");
   await page.locator("#nav-home").click();const beforeIndependent=await stored(page);await openPlan(page);
   assert.equal(await page.locator("#planHoursInput").inputValue(),"168","a plan dialog starts from saved state, independently of the settings draft");
   await page.locator("#planHoursInput").fill("164");await savePlan(page);const independent=await stored(page);
   assert.deepEqual(independent.settings,{...beforeIndependent.settings,plannedHoursByMonth:{"2026-09":152,"2026-10":164,"2026-11":144}});
   for(const key of ["records","defaults","submissions"])assert.deepEqual(independent[key],beforeIndependent[key],label+" plan save must preserve "+key);
   await openSettings(page);assert.equal(await page.locator("#minHours").inputValue(),"");assert.equal(await page.locator("#projectName").inputValue(),"");
   assert.equal(await page.locator("#workSummary").inputValue(),"未保存の設定下書き");assert.equal(await page.locator("#plannedHours").inputValue(),"164");
   await page.locator("#nav-home").click();await page.reload();await ready(page);

   // Blank and out-of-range numbers cannot save; both inclusive endpoints can.
   await openPlan(page);
   for(const value of ["","-1","745"]){
    await page.locator("#planHoursInput").fill(value);const before=await raw(page);await page.locator("#planForm button[type=submit]").click();
    assert.equal(await raw(page),before,label+" invalid monthly value must not save: "+value);assert.equal(await page.locator("#paperDialog").evaluate(node=>node.open),true);
    assert.equal(await page.locator("#planMode").inputValue(),"manual");assert.equal(await page.locator("#planHoursInput").evaluate(node=>node.validity.valid),false);
   }
   await page.locator("#planHoursInput").fill("744");await savePlan(page);await expectSummary(page,744);
   await openPlan(page);await page.locator("#planHoursInput").fill("0");await savePlan(page);await expectSummary(page,0);
   assert.equal(await page.locator("#monthlyPercent").innerText(),"—");assert.equal(await page.locator("#remainingHours").innerText(),"予定未設定");
   await page.reload();await ready(page);await expectSummary(page,0);assert.equal((await stored(page)).settings.plannedHoursByMonth["2026-10"],0);
   await openPlan(page);await page.locator("[data-action=plan-auto]").click();await savePlan(page);await expectSummary(page,168);

   // A stale page must show a conflict toast and retain the other writer's exact bytes.
   await openPlan(page);await page.locator("#planHoursInput").fill("180");
   const external=await page.evaluate(()=>{const key=window.PaperConfig.storageKey,state=JSON.parse(localStorage.getItem(key));state.revision++;state.settings.workSummary="別の画面の更新";state.settings.plannedHoursByMonth["2026-10"]=176;const text=JSON.stringify(state);localStorage.setItem(key,text);return text;});
   await page.locator("#planForm button[type=submit]").click();
   await page.waitForFunction(()=>document.querySelector("#studyToast")?.classList.contains("visible")&&/別の画面.*更新/.test(document.querySelector("#studyToast").textContent));
   assert.equal(await raw(page),external);assert.match(await page.locator("#dialogError").innerText(),/再読み込み/);
   assert.equal(await page.locator("#planHoursInput").inputValue(),"180");assert.equal(await page.locator("#paperDialog").evaluate(node=>node.open),true);
   await page.reload();await ready(page);await expectSummary(page,176);

   // Outside the known holiday calendar an automatic blank remains a valid reset.
   await page.clock.setSystemTime(new Date("2028-06-15T12:00:00Z"));await page.reload();await ready(page);await openPlan(page,"2028-06");
   assert.equal(await page.locator("#planHoursInput").inputValue(),"");assert.equal(await page.locator("#planHoursInput").evaluate(node=>node.required),false);
   await savePlan(page);assert.equal(Object.hasOwn((await stored(page)).settings.plannedHoursByMonth,"2028-06"),false);
   await openPlan(page,"2028-06");await page.locator("#planHoursInput").fill("120");await savePlan(page);await expectSummary(page,120);
   await openPlan(page,"2028-06");await page.locator("[data-action=plan-auto]").click();await savePlan(page);await expectSummary(page,"—");
   assert.equal(Object.hasOwn((await stored(page)).settings.plannedHoursByMonth,"2028-06"),false);
   console.log("PASS "+label+" direct plan edit/reload, automatic reset, isolated invalid-settings draft, numeric bounds, conflict toast and unknown-calendar reset");
   await context.close();

   const visual=await fresh(entry,HOLIDAY),layout=visual.page;
   for(const width of WIDTHS){
    await layout.setViewportSize({width,height:844});await fixture(layout);const screen=label+" "+width+"px";
    await paperAppearance(layout);await clockGeometry(layout,screen,true);await controls(layout,homeControls,screen+" home");
    assert.equal(await layout.locator("#homeMissingNotice").isVisible(),true);const warningPositions=await homePositions(layout);
    assert.equal((await layout.locator("#homeMissingSlot").boundingBox()).height,44);
    await fixture(layout,{missing:false});assert.equal(await layout.locator("#homeMissingNotice").isVisible(),false);
    assert.deepEqual(await homePositions(layout),warningPositions,screen+" resolving a warning must not move the clock, punches or fields");
    await layout.locator("[data-action=rest]").click();await controls(layout,homeControls,screen+" home rest editor");
    await layout.locator("[data-action=detail][data-detail=leave]").click();await layout.locator("#leaveType").selectOption("comp");
    await controls(layout,formControls("#leaveForm"),screen+" leave");
    await layout.locator("#nav-settings").click();await controls(layout,formControls("#defaultsForm"),screen+" defaults");
    await layout.locator("[data-action=settings-tab][data-tab=sheet]").click();await controls(layout,formControls("#settingsForm"),screen+" settings");
    await layout.locator("#nav-home").click();await layout.locator("[data-action=edit-day][data-day='2026-11-03']").click();
    await controls(layout,formControls("#dayForm")+",#editDate,.editor-date-switcher button",screen+" record editor");
    await layout.locator("#nav-home").click();await openPlan(layout,"2026-11");
    await controls(layout,formControls("#planForm")+",#paperDialog .dialog-close",screen+" monthly plan");
    await layout.locator("#paperDialog .dialog-close").click();
   }
   await layout.clock.setSystemTime(new Date(OCTOBER));await fixture(layout);await clockGeometry(layout,label+" ordinary day",false);
   console.log("PASS "+label+" compact date/clock, inline holiday, stable missing-warning space, Paper appearance and 320/390/430px home/settings/editor/leave/plan form geometry");
   await visual.context.close();
  }
  assert.deepEqual(errors,[]);console.log("PASS both HTML entries without browser errors");
 }finally{await browser.close();}
}
run().then(()=>server.close(),error=>{console.error(error);server.close();process.exitCode=1});
