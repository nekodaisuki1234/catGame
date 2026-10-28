"use strict";
// Run with Playwright/Chromium; PAPER_PLAYWRIGHT_MODULE can point to an installed module.
const {chromium}=require(process.env.PAPER_PLAYWRIGHT_MODULE||"playwright");
const assert=require("node:assert/strict"),http=require("node:http"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,".."),server=http.createServer((req,res)=>{
 const file=path.resolve(root,"."+new URL(req.url,"http://local").pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{res.setHeader("Content-Type",file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":"text/html");res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
const DAY="2026-10-27",INSTANT="2026-10-27T12:00:00Z",ENTRIES=[{file:"a-paper.html?screen=1",mode:"demo"},{file:"a-paper-app.html",mode:"local"}];
async function run(){
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.PAPER_CHROMIUM_PATH||(fs.existsSync("/usr/bin/chromium")?"/usr/bin/chromium":undefined),args:["--no-sandbox"]}),errors=[];
 const origin="http://127.0.0.1:"+server.address().port;
 const ready=page=>page.locator("#startPunch").waitFor();
 const raw=page=>page.evaluate(()=>localStorage.getItem(window.PaperConfig.storageKey));
 const stored=async page=>JSON.parse(await raw(page));
 const tab=(page,index)=>page.locator('[data-action="project-tab"][data-index="'+index+'"]');
 const choose=(page,index)=>tab(page,index).click();
 const openSettings=async page=>{await page.locator("#nav-settings").click();await page.locator("[data-action=settings-tab][data-tab=sheet]").click();await page.locator("#settingsForm").waitFor();};
 const saveSettings=async page=>{
  const revision=(await stored(page)).revision;await page.locator("#settingsForm button[type=submit]").click();
  await page.waitForFunction(revision=>JSON.parse(localStorage.getItem(window.PaperConfig.storageKey)).revision>revision,revision);
  await page.waitForFunction(()=>document.querySelector("#previewApp").getAttribute("aria-busy")==="false");
 };
 const expectPlan=async(page,mode,value)=>{assert.equal(await page.locator("#plannedHoursMode").inputValue(),mode);assert.equal(await page.locator("#plannedHours").inputValue(),value);};
 const fresh=async(entry,{shape="canonical"}={})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:"ja-JP"}),page=await context.newPage();
  page.on("pageerror",error=>errors.push(entry.mode+": "+error.message));await page.clock.install({time:new Date(INSTANT)});await page.goto(origin+"/day-designs/"+entry.file);await ready(page);
  const fixture=await page.evaluate(({shape,day})=>{
   const C=window.PaperAttendance,config=window.PaperConfig,now=C.clock(),state=config.mode==="local"?C.createState(now,{startDay:"2026-10-01"}):C.seed(now);
   state.records={};state.revision=9;state.settings.plannedHoursByMonth={"2026-09":152,"2026-11":144};
   state.submissions={"2026-09-01|2026-09-30":{at:"2026-10-01T09:00:00+09:00",test:true}};
   state.records[day]={...C.empty(state),start:"09:00",end:"18:00",note:"入力テストの開発作業",allocation:{...C.empty(state).allocation,P1:shape==="legacy"?7:5,SET:shape==="legacy"?1:3}};
   if(shape==="legacy")state.settings.projects=state.settings.projects.slice(0,4);
   if(shape==="transient"||shape==="overflow"){
    state.settings.projects[4]={id:"P5",name:"移行前の5枠目",description:"保持する担当作業"};
    state.records[day].allocation.P5=shape==="overflow"?10:2;
    state.records[day].allocation.SET=shape==="overflow"?20:1;
    if(shape==="overflow")Object.assign(state.records[day],{end:"16:00",overnight:true,allocation:{...state.records[day].allocation,P1:0}});
   }
   const text=JSON.stringify(state);localStorage.setItem(config.storageKey,text);return text;
  },{shape,day:DAY});await page.reload();await ready(page);return {context,page,fixture};
 };
 const fieldsFit=async(page,label)=>{
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+" has horizontal overflow");
  const width=page.viewportSize().width,metrics=await page.locator("#projectSettingsCard button,#projectName,#projectDescription").evaluateAll(nodes=>nodes.map(node=>{
   const rect=node.getBoundingClientRect();return {id:node.id||node.dataset.action,left:rect.left,right:rect.right,width:rect.width,height:rect.height,font:parseFloat(getComputedStyle(node).fontSize),field:node.matches("input,textarea")};
  }));
  for(const metric of metrics){
   assert.ok(metric.width>=43.5&&metric.height>=43.5,label+" small project control: "+JSON.stringify(metric));
   assert.ok(metric.left>=-1&&metric.right<=width+1,label+" project control outside viewport: "+JSON.stringify(metric));
   if(metric.field)assert.ok(metric.font>=16,label+" project field needs 16px input text");
  }
 };
 const unzip=buffer=>{
  const entries={};let cursor=0;
  while(buffer.readUInt32LE(cursor)===0x04034b50){const size=buffer.readUInt32LE(cursor+18),nameLength=buffer.readUInt16LE(cursor+26),extraLength=buffer.readUInt16LE(cursor+28),start=cursor+30+nameLength+extraLength;entries[buffer.subarray(cursor+30,cursor+30+nameLength).toString()]=buffer.subarray(start,start+size).toString();cursor=start+size;}
  return entries;
 };
 try{
  for(const entry of ENTRIES){
   const {context,page}=await fresh(entry),label=entry.mode;
   assert.deepEqual(await page.evaluate(()=>window.PaperAttendance.PROJECTS),["P1","P2","P3","P4","SET"]);
   await openSettings(page);assert.equal(await page.locator("#projectSelect").count(),0);
   assert.deepEqual(await page.locator("[data-action=project-tab] strong").allTextContents(),["P1","P2","P3","P4","SET"]);
   await expectPlan(page,"auto","168");await page.locator("#plannedHours").fill("160");await expectPlan(page,"manual","160");
   assert.match(await page.locator("#plannedHoursHint").innerText(),/時間を指定/);await saveSettings(page);
   assert.deepEqual((await stored(page)).settings.plannedHoursByMonth,{"2026-09":152,"2026-10":160,"2026-11":144});
   await page.reload();await ready(page);await openSettings(page);await expectPlan(page,"manual","160");
   await page.locator("#plannedHoursMode").selectOption("auto");await expectPlan(page,"auto","168");await saveSettings(page);
   assert.deepEqual((await stored(page)).settings.plannedHoursByMonth,{"2026-09":152,"2026-11":144});

   // Browser autofill can set a value without dispatching input/change; capture must retain it.
   await page.locator("#plannedHours").evaluate(node=>{node.value="164";});await choose(page,1);await expectPlan(page,"manual","164");
   await page.locator("#placeSelect").selectOption("1");await expectPlan(page,"manual","164");await page.locator("#nav-home").click();await openSettings(page);await expectPlan(page,"manual","164");
   await saveSettings(page);assert.equal((await stored(page)).settings.plannedHoursByMonth["2026-10"],164);
   await page.locator("#plannedHoursMode").selectOption("auto");await page.locator("#plannedHours").evaluate(node=>{node.value="166";});await saveSettings(page);
   assert.equal((await stored(page)).settings.plannedHoursByMonth["2026-10"],166);await expectPlan(page,"manual","166");
   await page.locator("#plannedHoursMode").selectOption("auto");await saveSettings(page);await expectPlan(page,"auto","168");
   assert.equal(Object.hasOwn((await stored(page)).settings.plannedHoursByMonth,"2026-10"),false);
   await page.locator("#plannedHours").fill("");await choose(page,3);await page.locator("#placeSelect").selectOption("2");await expectPlan(page,"manual","");
   const invalidPlan=await raw(page);await page.locator("#settingsForm button[type=submit]").click();assert.equal(await raw(page),invalidPlan);assert.equal(await page.locator("#plannedHours").evaluate(node=>node.validity.valueMissing),true);
   await page.locator("#plannedHoursMode").selectOption("auto");await expectPlan(page,"auto","168");
   console.log("PASS "+label+" immediate plan mode change, eventless autofill capture on navigation/submit, automatic reset and blank validation");

   // Each project remains visible in one-tap navigation, with distinct unsaved drafts.
   const names=["基盤設計","アプリ開発","運用改善","品質検証","SET運用支援"],descriptions=names.map((name,index)=>name+"の担当作業 "+(index+1));
   const beforeProjects=await raw(page);
   for(let index=0;index<5;index++){
    await choose(page,index);assert.equal(await tab(page,index).getAttribute("aria-pressed"),"true");
    await page.locator("#projectName").fill(names[index]);await page.locator("#projectDescription").fill(descriptions[index]);
    assert.match(await page.locator("#projectDraftState").innerText(),/未保存/);assert.match(await tab(page,index).getAttribute("aria-label"),/未保存/);
   }
   assert.equal(await raw(page),beforeProjects,"project navigation must not save drafts implicitly");
   await page.locator("#placeName").fill("場所の未保存下書き");await page.locator("#placeSelect").selectOption("0");await page.locator("#nav-home").click();await openSettings(page);
   for(let index=0;index<5;index++){await choose(page,index);assert.equal(await page.locator("#projectName").inputValue(),names[index]);assert.equal(await page.locator("#projectDescription").inputValue(),descriptions[index]);}
   await page.locator("#placeSelect").selectOption("2");assert.equal(await page.locator("#placeName").inputValue(),"場所の未保存下書き");
   await saveSettings(page);assert.deepEqual((await stored(page)).settings.projects.map(project=>({id:project.id,name:project.name,description:project.description})),names.map((name,index)=>({id:index===4?"SET":"P"+(index+1),name,description:descriptions[index]})));
   await page.reload();await ready(page);await openSettings(page);await choose(page,4);assert.equal(await page.locator("#projectName").inputValue(),names[4]);assert.doesNotMatch(await page.locator("#projectDraftState").innerText(),/未保存/);

   // An invalid off-screen project must be brought back into the active editor.
   await choose(page,2);await page.locator("#projectName").fill("");await choose(page,0);const invalidProject=await raw(page);
   await page.locator("#settingsForm button[type=submit]").click();assert.equal(await raw(page),invalidProject);
   assert.equal(await tab(page,2).getAttribute("aria-pressed"),"true");assert.equal(await page.locator("#projectName").inputValue(),"");assert.equal(await page.locator("#projectName").evaluate(node=>node===document.activeElement),true);
   assert.match(await page.locator("#studyToast").innerText(),/P3/);await page.locator("#projectName").fill(names[2]);await saveSettings(page);
   for(const width of [320,390,430]){
    await page.setViewportSize({width,height:844});await page.locator("#projectSettingsCard").scrollIntoViewIfNeeded();const top=await page.evaluate(()=>scrollY);
    await choose(page,0);await choose(page,4);assert.ok(Math.abs(await page.evaluate(()=>scrollY)-top)<=1,label+" project switching must preserve scroll position at "+width);await fieldsFit(page,label+" "+width);
   }
   await page.setViewportSize({width:390,height:844});
   console.log("PASS "+label+" five project drafts, save/reload, place/navigation preservation, invalid-project routing and mobile project controls");

   // The fifth bucket is SET; ordinary time edits preserve its manual allocation.
   await page.locator("#nav-home").click();await page.locator("[data-detail=allocation]").click();assert.equal(await page.locator("#allocP5").count(),0);assert.equal(await page.locator("#allocSET").inputValue(),"3");assert.equal(await page.locator(".wordmark").innerText(),"SET");
   await page.locator("[data-action=quick-rest][data-minutes='90']").click();await page.waitForFunction(day=>JSON.parse(localStorage.getItem(window.PaperConfig.storageKey)).records[day].breakMinutes===90,DAY);await page.clock.runFor(40);
   const r=(await stored(page)).records[DAY];assert.equal(r.allocation.P1,4.5);assert.equal(Object.hasOwn(r.allocation,"P5"),false);assert.equal(r.allocation.SET,3);
   const check=await page.evaluate(day=>{const C=window.PaperAttendance,state=JSON.parse(localStorage.getItem(window.PaperConfig.storageKey));return C.submissionCheck(state,{start:day,end:day},C.clock());},DAY);assert.equal(check.ok,true);
   await page.locator("#nav-records").click();const downloadEvent=page.waitForEvent("download");await page.locator("[data-action=export-month]").click();const download=await downloadEvent,entries=unzip(fs.readFileSync(await download.path()));
   assert.doesNotMatch(entries["xl/worksheets/sheet1.xml"],/P5（時間）/);assert.match(entries["xl/worksheets/sheet1.xml"],/SET（時間）/);assert.match(entries["xl/worksheets/sheet2.xml"],/SET運用支援/);
   await context.close();

   // Old four-project settings gain the fifth SET editor without changing saved bytes.
   const legacy=await fresh(entry,{shape:"legacy"}),old=JSON.parse(legacy.fixture);assert.equal(await raw(legacy.page),legacy.fixture);
   assert.equal((await stored(legacy.page)).revision,old.revision);await openSettings(legacy.page);assert.equal(await legacy.page.locator("[data-action=project-tab]").count(),5);
   assert.equal(await raw(legacy.page),legacy.fixture);await choose(legacy.page,4);assert.equal(await tab(legacy.page,4).locator("strong").innerText(),"SET");
   await legacy.page.locator("#projectName").fill("SETの作業情報");await saveSettings(legacy.page);
   const migrated=await stored(legacy.page);assert.equal(migrated.revision,old.revision+1);assert.equal(migrated.settings.projects.length,5);assert.equal(migrated.settings.projects[4].id,"SET");
   assert.deepEqual(migrated.records,old.records);assert.equal(migrated.records[DAY].allocation.SET,1);assert.equal(Object.hasOwn(migrated.records[DAY].allocation,"P5"),false);
   assert.deepEqual(migrated.settings.projects.slice(0,4),old.settings.projects);assert.deepEqual(migrated.settings.plannedHoursByMonth,old.settings.plannedHoursByMonth);assert.deepEqual(migrated.defaults,old.defaults);
   const malformed=await legacy.page.evaluate(day=>{const key=window.PaperConfig.storageKey,state=JSON.parse(localStorage.getItem(key));state.records[day].allocation.SET=null;const text=JSON.stringify(state);localStorage.setItem(key,text);return text;},DAY);
   await legacy.page.reload();await legacy.page.locator("[data-action=retry-load]").waitFor();assert.equal(await legacy.page.locator("#startPunch").count(),0);assert.equal(await raw(legacy.page),malformed);
   await legacy.context.close();

   // The briefly published six-bucket shape merges P5 into SET exactly once, preserving totals.
   const transient=await fresh(entry,{shape:"transient"}),previous=JSON.parse(transient.fixture);assert.equal(await raw(transient.page),transient.fixture);
   await transient.page.locator("[data-detail=allocation]").click();assert.equal(await transient.page.locator("#allocP5").count(),0);assert.equal(await transient.page.locator("#allocSET").inputValue(),"3");
   await openSettings(transient.page);await choose(transient.page,4);assert.equal(await transient.page.locator("#projectName").inputValue(),previous.settings.projects[4].name);assert.equal(await transient.page.locator("#projectDescription").inputValue(),previous.settings.projects[4].description);
   assert.equal(await raw(transient.page),transient.fixture);await saveSettings(transient.page);
   const combined=await stored(transient.page);assert.equal(combined.revision,previous.revision+1);assert.equal(combined.settings.projects[4].id,"SET");assert.equal(combined.records[DAY].allocation.SET,3);assert.equal(Object.hasOwn(combined.records[DAY].allocation,"P5"),false);
   assert.deepEqual(combined.records[DAY],{...previous.records[DAY],allocation:{P1:5,P2:0,P3:0,P4:0,SET:3}});assert.deepEqual(combined.settings.plannedHoursByMonth,previous.settings.plannedHoursByMonth);assert.deepEqual(combined.defaults,previous.defaults);
   await transient.page.reload();await ready(transient.page);await transient.page.locator("[data-detail=allocation]").click();assert.equal(await transient.page.locator("#allocSET").inputValue(),"3","reloading must not merge the old value again");
   const invalidAlias=await transient.page.evaluate(({fixture,day})=>{const key=window.PaperConfig.storageKey,state=JSON.parse(fixture);state.records[day].allocation.P5=null;const text=JSON.stringify(state);localStorage.setItem(key,text);return text;},{fixture:transient.fixture,day:DAY});
   await transient.page.reload();await transient.page.locator("[data-action=retry-load]").waitFor();assert.equal(await raw(transient.page),invalidAlias);await transient.context.close();

   // A valid legacy merged total above the fresh-input limit remains editable without data loss.
   const overflow=await fresh(entry,{shape:"overflow"});assert.equal(await raw(overflow.page),overflow.fixture);
   await overflow.page.locator("#nav-records").click();await overflow.page.locator('.paper-record[data-day="'+DAY+'"]').click();
   assert.equal(await overflow.page.locator("#editAllocSET").inputValue(),"30");assert.ok(Number(await overflow.page.locator("#editAllocSET").getAttribute("max"))>=30);
   await overflow.page.locator("#editNote").fill("旧配分の合計を保って作業内容だけ更新");const oldRevision=(await stored(overflow.page)).revision;
   await overflow.page.locator("#dayForm button[type=submit]").click();await overflow.page.waitForFunction(revision=>JSON.parse(localStorage.getItem(window.PaperConfig.storageKey)).revision>revision,oldRevision);
   const retained=(await stored(overflow.page)).records[DAY];assert.equal(retained.allocation.SET,30);assert.equal(Object.hasOwn(retained.allocation,"P5"),false);assert.deepEqual(retained.legacyProjectAllocation,{P5:10,SET:20});assert.equal(retained.note,"旧配分の合計を保って作業内容だけ更新");
   await overflow.page.locator("#editAllocSET").fill("20");await overflow.page.locator("#editAllocP1").fill("10");const retainedRevision=(await stored(overflow.page)).revision;
   await overflow.page.locator("#dayForm button[type=submit]").click();await overflow.page.waitForFunction(revision=>JSON.parse(localStorage.getItem(window.PaperConfig.storageKey)).revision>revision,retainedRevision);
   const corrected=(await stored(overflow.page)).records[DAY];assert.equal(corrected.allocation.SET,20);assert.equal(corrected.allocation.P1,10);assert.equal(Object.hasOwn(corrected,"legacyProjectAllocation"),false);assert.equal(await overflow.page.locator("#editAllocSET").getAttribute("max"),"24");
   await overflow.context.close();console.log("PASS "+label+" fifth SET allocation and Excel, no-write old/transient loading, one-time lossless merging, overflow note edits and rejected malformed source values");
  }
  assert.deepEqual(errors,[]);console.log("PASS planning and five-project settings integration in both HTML entries without browser errors");
 }finally{await browser.close();}
}
run().then(()=>server.close(),error=>{console.error(error);server.close();process.exitCode=1});
