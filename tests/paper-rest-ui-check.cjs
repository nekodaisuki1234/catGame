"use strict";
// Run with Playwright/Chromium; PAPER_PLAYWRIGHT_MODULE can point to an installed module.
const {chromium}=require(process.env.PAPER_PLAYWRIGHT_MODULE||"playwright");
const assert=require("node:assert/strict"),http=require("node:http"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,".."),server=http.createServer((req,res)=>{
 const file=path.resolve(root,"."+new URL(req.url,"http://local").pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{res.setHeader("Content-Type",file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":"text/html");res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
const DAY="2026-10-27",FINISHED="2026-10-27T12:00:00Z",MINUTES=[0,30,45,60,90];
const ENTRIES=[{file:"a-paper.html?screen=1",mode:"demo"},{file:"a-paper-app.html",mode:"local"}];
async function run(){
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.PAPER_CHROMIUM_PATH||(fs.existsSync("/usr/bin/chromium")?"/usr/bin/chromium":undefined),args:["--no-sandbox"]}),errors=[];
 const origin="http://127.0.0.1:"+server.address().port;
 const ready=page=>page.locator("#startPunch").waitFor();
 const raw=page=>page.evaluate(()=>localStorage.getItem(window.PaperConfig.storageKey));
 const stored=async page=>JSON.parse(await raw(page));
 const record=async page=>(await stored(page)).records[DAY];
 const selected=page=>page.locator("[data-action=quick-rest][aria-pressed=true]").evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.minutes)));
 const button=(page,minutes)=>page.locator("[data-action=quick-rest][data-minutes='"+minutes+"']");
 const settle=async page=>{await page.waitForFunction(()=>document.querySelector("#previewApp")?.getAttribute("aria-busy")!=="true");await page.clock.runFor(40);};
 const saved=async(page,minutes)=>{
  await page.waitForFunction(({day,minutes})=>JSON.parse(localStorage.getItem(window.PaperConfig.storageKey)||"null")?.records[day]?.breakMinutes===minutes,{day:DAY,minutes});
  await settle(page);
 };
 const choose=async(page,minutes)=>{await button(page,minutes).click();await saved(page,minutes);};
 const text=async(page,selector)=>(await page.locator(selector).textContent()).replace(/\s+/g,"");
 const noTimeWarning=async page=>assert.doesNotMatch(await page.locator("#studyToast").innerText(),/欠勤|不足しています|休憩時間を引いた|マイナス/);
 const fixture=async(page,kind="empty")=>{
  await page.evaluate(({kind,day})=>{
   const C=window.PaperAttendance,config=window.PaperConfig,now=C.clock(),state=config.mode==="local"?C.createState(now,{startDay:"2026-10-01"}):C.seed(now);
   state.records={};state.submissions={};
   if(kind!=="empty")state.records[day]={...C.empty(state),start:"09:00",end:kind==="complete"?"18:00":"",note:"保存済みの作業内容",allocation:{P1:kind==="complete"?6:0,P2:kind==="complete"?2:0,P3:0,P4:0,P5:0,SET:0}};
   localStorage.setItem(config.storageKey,JSON.stringify(state));
  },{kind,day:DAY});await page.reload();await ready(page);
 };
 const fresh=async(entry,{delayed=false}={})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:"ja-JP"}),page=await context.newPage();
  page.on("pageerror",error=>errors.push(entry.mode+": "+error.message));
  if(delayed)await page.addInitScript(()=>{
   const control=window.__restAdapter={saveCalls:0,holdSave:false};
   window.PaperRepositoryFactory=options=>{
    const repository=window.PaperRepository.createLocal(options);
    return {...repository,async save(next,saveOptions){
     control.saveCalls++;
     if(control.holdSave)await new Promise((resolve,reject)=>{control.releaseSave=resolve;control.rejectSave=()=>reject(new Error("休憩時間を保存できませんでした"));});
     return repository.save(next,saveOptions);
    }};
   };
  });
  await page.clock.install({time:new Date(FINISHED)});await page.goto(origin+"/day-designs/"+entry.file);await ready(page);await fixture(page);return {context,page};
 };
 try{
  for(const entry of ENTRIES){
   const {context,page}=await fresh(entry),label=entry.mode;
   assert.equal(await page.evaluate(()=>window.PaperConfig.mode),entry.mode);
   assert.equal((await stored(page)).defaults.breakMinutes,60,"the standard starting break is one hour");
   assert.equal(await page.locator("#restForm").count(),0,"one-tap choices do not require opening the detailed editor");
   assert.deepEqual(await page.locator("[data-action=quick-rest]").evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.minutes))),MINUTES);
   for(const minutes of MINUTES)assert.equal(await button(page,minutes).isVisible(),true);
   assert.deepEqual(await selected(page),[60]);
   await choose(page,45);assert.equal(await page.locator("#restForm").count(),0);assert.deepEqual(await selected(page),[45]);
   assert.equal((await record(page)).start,"");assert.equal((await record(page)).end,"");await noTimeWarning(page);
   assert.equal((await stored(page)).defaults.breakMinutes,60,"today's choice does not overwrite the standard for future days");
   await page.reload();await ready(page);assert.deepEqual(await selected(page),[45]);assert.equal((await record(page)).breakMinutes,45);

   // Re-selecting the saved value must not rewrite data or clear submission history.
   await page.evaluate(({day})=>{const key=window.PaperConfig.storageKey,state=JSON.parse(localStorage.getItem(key));state.submissions[day+"|"+day]={at:"2026-10-27T12:00:00Z",test:true};state.revision++;localStorage.setItem(key,JSON.stringify(state));},{day:DAY});
   await page.reload();await ready(page);const unchanged=await raw(page);await button(page,45).click();await settle(page);assert.equal(await raw(page),unchanged);

   // The manual editor retains minute-level changes outside the preset values.
   await page.locator("[data-action=rest]").click();await page.locator("#restHours").fill("1");await page.locator("#restMinutes").fill("15");
   await page.locator("#restForm button[type=submit]").click();await saved(page,75);assert.deepEqual(await selected(page),[]);
   await page.locator("[data-action=rest]").click();assert.equal(await page.locator("#restHours").inputValue(),"1");assert.equal(await page.locator("#restMinutes").inputValue(),"15");
   await choose(page,60);assert.deepEqual(await selected(page),[60]);assert.equal(await page.locator("#restForm").count(),0);
   await fixture(page,"working");await choose(page,90);await noTimeWarning(page);assert.equal((await record(page)).end,"");
   console.log("PASS "+label+" always-visible one-tap breaks, one-hour standard, persisted selection, unchanged-value protection, custom minutes and no pre-clock-out warning");

   // Completed-day break changes adjust only P1 and recompute monthly absence.
   await fixture(page,"complete");await choose(page,90);let r=await record(page);
   assert.equal(r.allocation.P1,5.5);assert.equal(r.allocation.P2,2);assert.equal(await text(page,"#homeAbsence"),"0時間30分");
   assert.match(await page.locator("#studyToast").innerText(),/欠勤/);assert.match(await page.locator("#studyToast").innerText(),/0時間30分/);
   await choose(page,0);r=await record(page);assert.equal(r.allocation.P1,7);assert.equal(r.allocation.P2,2);assert.equal(await text(page,"#homeAbsence"),"0時間00分");await noTimeWarning(page);
   await choose(page,60);

   // A failed note save leaves a real unsaved draft, which a break change must preserve.
   await page.evaluate(()=>{window.restOriginalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error("quota")};});
   await page.locator("#workNote").fill("再保存する作業内容");await page.locator("#workNote").dispatchEvent("change");await settle(page);
   await page.locator("#workNote").evaluate(node=>node.blur());await settle(page);
   assert.match(await page.locator("#workSaveStatus").innerText(),/未保存/);
   await page.evaluate(()=>Storage.prototype.setItem=window.restOriginalSetItem);
   await page.locator("[data-detail=allocation]").click();await page.locator("#allocP2").fill("1.5");await page.locator("#allocP1").fill("6.5");
   await choose(page,90);
   assert.equal(await page.locator("#workNote").inputValue(),"再保存する作業内容");assert.match(await page.locator("#workSaveStatus").innerText(),/未保存/);
   assert.equal((await record(page)).note,"保存済みの作業内容");assert.equal((await record(page)).allocation.P2,2);
   assert.equal(await page.locator("#allocP2").inputValue(),"1.5");assert.equal(Number(await page.locator("#allocP1").inputValue()),6);
   for(const width of [320,390,430]){
    await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+" preset controls overflow at "+width);
    const metrics=await page.locator("[data-action=quick-rest]").evaluateAll(nodes=>nodes.map(node=>{const rect=node.getBoundingClientRect();return {minutes:node.dataset.minutes,left:rect.left,right:rect.right,width:rect.width,height:rect.height};}));
    for(const metric of metrics){assert.ok(metric.width>=43.5&&metric.height>=43.5,label+" preset "+metric.minutes+" tap area at "+width);assert.ok(metric.left>=-1&&metric.right<=width+1,label+" preset "+metric.minutes+" outside viewport at "+width);}
   }
   console.log("PASS "+label+" P1-only recalculation, absence warning updates, note/allocation draft preservation and 320/390/430px touch targets");
   await context.close();

   // The async adapter must accept a write before selection changes; rapid taps cannot race it.
   const asyncView=await fresh(entry,{delayed:true}),pending=asyncView.page;
   await pending.evaluate(()=>window.__restAdapter.holdSave=true);const initial=await raw(pending);await button(pending,45).click();
   await pending.waitForFunction(()=>window.__restAdapter.saveCalls===1);assert.equal(await raw(pending),initial);assert.deepEqual(await selected(pending),[60]);
   for(const minutes of MINUTES)assert.equal(await button(pending,minutes).isDisabled(),true);
   await pending.evaluate(()=>{for(const minutes of [90,30,45])document.querySelector('[data-action="quick-rest"][data-minutes="'+minutes+'"]').dispatchEvent(new MouseEvent("click",{bubbles:true}));});
   assert.equal(await pending.evaluate(()=>window.__restAdapter.saveCalls),1);
   await pending.evaluate(()=>window.__restAdapter.releaseSave());await saved(pending,45);assert.deepEqual(await selected(pending),[45]);
   await pending.locator("[data-action=rest]").click();await pending.locator("#restHours").fill("1");await pending.locator("#restMinutes").fill("17");
   const accepted=await raw(pending);await button(pending,30).click();await pending.waitForFunction(()=>window.__restAdapter.saveCalls===2);
   assert.equal(await raw(pending),accepted);assert.deepEqual(await selected(pending),[45]);await pending.evaluate(()=>window.__restAdapter.rejectSave());await settle(pending);
   assert.equal(await raw(pending),accepted);assert.deepEqual(await selected(pending),[45]);assert.equal(await pending.locator("#restForm").isVisible(),true);
   assert.equal(await pending.locator("#restHours").inputValue(),"1");assert.equal(await pending.locator("#restMinutes").inputValue(),"17");
   assert.match(await pending.locator("#studyToast").innerText(),/保存/);assert.equal(await button(pending,30).isDisabled(),false);
   await pending.evaluate(()=>window.__restAdapter.holdSave=false);await choose(pending,60);assert.deepEqual(await selected(pending),[60]);assert.equal(await pending.locator("#restForm").count(),0);
   // Recreated controls after navigation must recover from a failed in-flight save too.
   await pending.evaluate(()=>window.__restAdapter.holdSave=true);const beforeNavigation=await raw(pending),nextCall=await pending.evaluate(()=>window.__restAdapter.saveCalls+1);
   await button(pending,90).click();await pending.waitForFunction(expected=>window.__restAdapter.saveCalls===expected,nextCall);
   await pending.locator("#nav-records").click();await pending.locator("#nav-home").click();await ready(pending);
   assert.deepEqual(await selected(pending),[60]);for(const minutes of MINUTES)assert.equal(await button(pending,minutes).isDisabled(),true);
   await pending.evaluate(()=>window.__restAdapter.rejectSave());await settle(pending);assert.equal(await raw(pending),beforeNavigation);assert.deepEqual(await selected(pending),[60]);
   for(const minutes of MINUTES)assert.equal(await button(pending,minutes).isDisabled(),false,"recreated quick controls must recover after rejection");
   await pending.evaluate(()=>window.__restAdapter.holdSave=false);await choose(pending,45);assert.deepEqual(await selected(pending),[45]);
   console.log("PASS "+label+" accepted-save selection, pending tap guards, failed-save data/selection/manual-draft retention and retry");
   await asyncView.context.close();
  }
  assert.deepEqual(errors,[]);console.log("PASS quick break integration in both HTML entries without browser errors");
 }finally{await browser.close();}
}
run().then(()=>server.close(),error=>{console.error(error);server.close();process.exitCode=1});
