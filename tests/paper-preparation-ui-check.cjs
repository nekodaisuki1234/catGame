"use strict";
// Run with Playwright/Chromium; PAPER_PLAYWRIGHT_MODULE can point to an installed module.
const {chromium}=require(process.env.PAPER_PLAYWRIGHT_MODULE||"playwright");
const assert=require("node:assert/strict"),http=require("node:http"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,".."),server=http.createServer((req,res)=>{
 const file=path.resolve(root,"."+new URL(req.url,"http://local").pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{res.setHeader("Content-Type",file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":"text/html");res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
const DEMO_KEY="day-paper-attendance-v1",LOCAL_KEY="day-paper-local-v1";
// The UTC date is still the 27th: a local setup must start on the 28th in Japan.
const INSTANT="2026-10-27T15:12:00Z",DAY="2026-10-28",MONTH="2026-10",DEMO_NOTE="DEMO_ONLY_OLD_WORK_NOTE";
async function run(){
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.PAPER_CHROMIUM_PATH||(fs.existsSync("/usr/bin/chromium")?"/usr/bin/chromium":undefined),args:["--no-sandbox"]}),errors=[];
 const origin="http://127.0.0.1:"+server.address().port;
 // Deliberately contradictory query parameters cannot turn either HTML entry into the other mode.
 const demoUrl=origin+"/day-designs/a-paper.html?screen=1&mode=local";
 const localUrl=origin+"/day-designs/a-paper-app.html?mode=demo&state=working";
 const context=()=>browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:"ja-JP"});
 const newPage=async ctx=>{
  const page=await ctx.newPage();page.on("pageerror",error=>errors.push(error.message));
  await page.clock.install({time:new Date(INSTANT)});return page;
 };
 const ready=page=>page.locator("#startPunch").waitFor();
 const raw=(page,key)=>page.evaluate(key=>localStorage.getItem(key),key);
 const state=async(page,key=LOCAL_KEY)=>JSON.parse(await raw(page,key));
 const saved=async(page,key,day,field,value)=>page.waitForFunction(({key,day,field,value})=>{
  const text=localStorage.getItem(key);return text&&JSON.parse(text).records[day]?.[field]===value;
 },{key,day,field,value});
 const appearance=page=>page.evaluate(()=>{
  const css=getComputedStyle(document.documentElement),app=getComputedStyle(document.querySelector("#previewApp")),logo=getComputedStyle(document.querySelector(".wordmark"));
  return {theme:document.documentElement.dataset.theme,palette:Object.fromEntries(["--paper","--ink","--muted","--line","--primary","--secondary"].map(key=>[key,css.getPropertyValue(key).trim()])),font:app.fontFamily,logoFont:logo.fontFamily,logoColor:logo.color,background:app.backgroundColor};
 });
 const noOverflow=async(page,label)=>{
  for(const width of [320,390,430]){
   await page.setViewportSize({width,height:844});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+" overflow at "+width);
   const small=await page.locator("#previewApp input,#previewApp select,#previewApp textarea").evaluateAll(nodes=>nodes.filter(node=>!["checkbox","hidden"].includes(node.type)).filter(node=>parseFloat(getComputedStyle(node).fontSize)<16).map(node=>node.id));
   assert.deepEqual(small,[],label+" controls must retain 16px text at "+width);
  }
  await page.setViewportSize({width:390,height:844});
 };
 const localProfile=async page=>{
  assert.match(await page.locator(".employee").innerText(),/利用者未設定/);
  assert.equal(await page.locator(".wordmark").innerText(),"SET");
  assert.doesNotMatch(await page.locator("#previewApp").innerText(),/田中|花子|TIS|E001|DEMO_ONLY_OLD_WORK_NOTE/);
 };
 try{
  const shared=await context(),demo=await newPage(shared);
  await demo.goto(demoUrl);await ready(demo);
  assert.match(await demo.locator(".employee").innerText(),/田中 花子/);
  assert.deepEqual(await demo.evaluate(()=>({mode:window.PaperConfig.mode,key:window.PaperConfig.storageKey})),{mode:"demo",key:DEMO_KEY});
  const paperAppearance=await appearance(demo);
  await demo.locator("[data-detail=work]").click();await demo.locator("#workNote").fill(DEMO_NOTE);await demo.locator("#workNote").dispatchEvent("change");
  await saved(demo,DEMO_KEY,DAY,"note",DEMO_NOTE);
  const demoJSON=await raw(demo,DEMO_KEY),demoState=JSON.parse(demoJSON);
  assert.ok(Object.keys(demoState.records).some(day=>day<DAY),"the demo must retain its fictional history");

  const local=await newPage(shared);await local.goto(localUrl);await ready(local);
  assert.equal(await local.locator("html").getAttribute("data-app-mode"),"local");
  assert.deepEqual(await local.evaluate(()=>({mode:window.PaperConfig.mode,key:window.PaperConfig.storageKey})),{mode:"local",key:LOCAL_KEY});
  assert.equal(await raw(local,LOCAL_KEY),null,"opening an empty local app must not persist an initial state");
  assert.equal(await raw(local,DEMO_KEY),demoJSON,"opening local mode must leave the demo's exact stored bytes alone");
  await localProfile(local);
  assert.equal(await local.locator(".lab-toolbar,.sample-controls,[data-state]").count(),0);
  assert.equal(await local.locator(".hero-date").getAttribute("datetime"),DAY);
  assert.equal(await local.locator("#startTime").inputValue(),"");assert.equal(await local.locator("#endTime").inputValue(),"");
  assert.equal(await local.locator("#workNote").inputValue(),"");
  assert.equal(await local.locator("#monthWorked").innerText(),"0時間");assert.equal(await local.locator("#todayWorked").innerText(),"0:00");
  assert.equal(await local.locator("#homeMissingNotice").isVisible(),false,"pre-setup history cannot create missing-day warnings");
  const initial=await local.evaluate(()=>window.PaperConfig.initialState(window.PaperAttendance.clock()));
  assert.equal(initial.mode,"local");assert.equal(initial.settings.attendanceStartDay,DAY);
  assert.deepEqual(initial.settings.employee,{name:"",department:"",id:""});assert.deepEqual(initial.records,{});assert.deepEqual(initial.submissions,{});
  assert.deepEqual(await appearance(local),paperAppearance,"both entries must retain A. Paper's colors and fonts");
  await noOverflow(local,"empty local home");

  // Sample controls must be rejected at the event boundary, even if a caller fabricates them.
  await local.evaluate(()=>{
   for(const dataset of [{state:"working"},{action:"reset"}]){const button=document.createElement("button");Object.assign(button.dataset,dataset);document.body.append(button);button.click();button.remove();}
  });
  assert.equal(await raw(local,LOCAL_KEY),null);assert.equal(await raw(local,DEMO_KEY),demoJSON);
  assert.equal(await local.locator("#startTime").inputValue(),"");assert.equal(await local.locator("#workNote").inputValue(),"");
  console.log("PASS separate HTML modes, untouched demo history, blank local profile, JST setup day, no initial write and guarded sample controls");

  await local.locator("#nav-records").click();
  assert.equal(await local.locator("#monthInput").getAttribute("min"),MONTH);
  assert.equal(await local.locator("[data-action=month-prev]").isDisabled(),true);
  const listedDays=await local.locator("#recordList [data-day]").evaluateAll(nodes=>nodes.map(node=>({day:node.dataset.day,disabled:node.disabled,label:node.textContent})));
  assert.ok(listedDays.some(row=>row.day===DAY&&!row.disabled));
  assert.ok(listedDays.filter(row=>row.day<DAY).every(row=>row.disabled&&row.label.includes("利用開始前")),"dates before setup must be labelled and unavailable");
  const chartMonths=await local.locator("[data-action=chart-month]").evaluateAll(nodes=>nodes.map(node=>node.dataset.month));
  assert.ok(chartMonths.length);assert.ok(chartMonths.every(month=>month>=MONTH+"-01"),"the chart cannot show fake past months");
  await noOverflow(local,"local records");
  await local.locator("#recordList [data-day='"+DAY+"']").click();
  assert.equal(await local.locator("#editDate").getAttribute("min"),DAY);
  assert.equal(await local.locator("#editDate").getAttribute("max"),DAY);
  assert.equal(await local.locator("[data-action=editor-prev]").isDisabled(),true);
  assert.equal(await local.locator("#editNote").inputValue(),"");await noOverflow(local,"local editor");
  await local.locator("#nav-submit").click();await localProfile(local);
  assert.match(await local.locator(".paper-notice").innerText(),/メールは送信されません/);
  assert.equal(await local.locator("[data-action=month-prev]").isDisabled(),true);
  assert.equal(await raw(local,LOCAL_KEY),null,"navigation and empty editing must not save an initial state");
  await local.locator("#nav-home").click();
  const punchTime=await local.evaluate(()=>window.PaperAttendance.clock().time);await local.locator("#startPunch").click();
  await saved(local,LOCAL_KEY,DAY,"start",punchTime);
  const firstSaved=await state(local);
  assert.equal(firstSaved.mode,"local");assert.equal(firstSaved.settings.attendanceStartDay,DAY);
  assert.deepEqual(firstSaved.settings.employee,{name:"",department:"",id:""});
  assert.deepEqual(Object.keys(firstSaved.records),[DAY]);assert.deepEqual(firstSaved.submissions,{});
  assert.equal(firstSaved.defaults.note,"");assert.equal(firstSaved.settings.workSummary,"");assert.equal(firstSaved.records[DAY].note,"");
  assert.doesNotMatch(JSON.stringify(firstSaved),/田中|花子|TIS|DEMO_ONLY_OLD_WORK_NOTE/);
  assert.equal(await raw(local,DEMO_KEY),demoJSON);
  const localJSON=await raw(local,LOCAL_KEY);await local.reload();await ready(local);await localProfile(local);
  assert.equal(await local.locator("#startTime").inputValue(),punchTime);assert.equal(await raw(local,LOCAL_KEY),localJSON);
  await demo.reload();await ready(demo);assert.equal(await demo.locator("#workNote").inputValue(),DEMO_NOTE);
  assert.equal(await raw(demo,DEMO_KEY),demoJSON);assert.equal(await raw(demo,LOCAL_KEY),localJSON);
  console.log("PASS bounded record/month/editor navigation and first real local punch persist across reload without changing either entry's other store");

  // Invalid local bytes are an error to preserve, including a demo state placed under the local key.
  for(const broken of ["{invalid local JSON",demoJSON]){
   const corruptContext=await context(),corrupt=await newPage(corruptContext);
   await corrupt.addInitScript(({key,broken,demoKey,demoJSON})=>{localStorage.setItem(key,broken);localStorage.setItem(demoKey,demoJSON);},{key:LOCAL_KEY,broken,demoKey:DEMO_KEY,demoJSON});
   await corrupt.goto(localUrl);
   await corrupt.waitForFunction(()=>{const node=document.querySelector("#previewError");return node&&/読み込|データ|保存領域/.test(node.textContent);});
   assert.equal(await corrupt.locator("#previewError").isVisible(),true);
   assert.equal(await corrupt.locator("#startPunch,#workNote,#recordList").count(),0,"blocked data cannot render a sample home");
   assert.doesNotMatch(await corrupt.locator("#previewApp").innerText(),/田中|花子|TIS|E001/);
   assert.equal(await raw(corrupt,LOCAL_KEY),broken);assert.equal(await raw(corrupt,DEMO_KEY),demoJSON);
   const retry=corrupt.locator("[data-action=retry-load]");if(await retry.count()){await retry.click();await corrupt.waitForFunction(()=>document.querySelector("#previewError")?.textContent.length>0);}
   assert.equal(await raw(corrupt,LOCAL_KEY),broken,"retry cannot seed over rejected bytes");
   await corruptContext.close();
  }
  console.log("PASS malformed and wrong-mode local data visibly block loading while preserving both stored values");

  const asynchronousContext=await context(),asynchronous=await newPage(asynchronousContext);
  await asynchronous.addInitScript(()=>{
   const control=window.__paperAdapter={loadCalls:0,saveCalls:0,holdLoad:true,holdSave:true,candidates:[]};
   window.PaperRepositoryFactory=options=>{
    control.options={key:options.key,mode:options.mode};const repository=window.PaperRepository.createLocal(options);
    return {...repository,
     async load(){control.loadCalls++;if(control.holdLoad)await new Promise(resolve=>{control.releaseLoad=resolve;});return repository.load();},
     async save(next,saveOptions){
      control.saveCalls++;control.candidates.push(JSON.parse(JSON.stringify(next)));
      if(control.holdSave)await new Promise((resolve,reject)=>{control.releaseSave=resolve;control.rejectSave=()=>reject(new Error("adapter write failed"));});
      return repository.save(next,saveOptions);
     }
    };
   };
  });
  await asynchronous.goto(localUrl);await asynchronous.waitForFunction(()=>window.__paperAdapter?.loadCalls===1);
  assert.equal(await asynchronous.locator("#startPunch").count(),0,"the app must wait for asynchronous load before rendering attendance");
  assert.equal(await raw(asynchronous,LOCAL_KEY),null);
  assert.deepEqual(await asynchronous.evaluate(()=>window.__paperAdapter.options),{key:LOCAL_KEY,mode:"local"});
  await asynchronous.evaluate(()=>window.__paperAdapter.releaseLoad());await ready(asynchronous);await localProfile(asynchronous);
  const asyncTime=await asynchronous.evaluate(()=>window.PaperAttendance.clock().time);
  await asynchronous.locator("#startPunch").click();await asynchronous.waitForFunction(()=>window.__paperAdapter.saveCalls===1);
  assert.equal(await raw(asynchronous,LOCAL_KEY),null,"a pending adapter save cannot appear persisted");
  assert.equal(await asynchronous.locator("#startTime").inputValue(),"");assert.equal(await asynchronous.locator("#punchState").innerText(),"出勤前");
  assert.equal(await asynchronous.locator("#startPunch.is-success,.punch-success").count(),0,"punch success must await the adapter");
  assert.equal(await asynchronous.locator("#startPunch").isDisabled(),true);
  await asynchronous.evaluate(()=>{const node=document.querySelector("#startPunch");node.dispatchEvent(new MouseEvent("click",{bubbles:true}));node.dispatchEvent(new MouseEvent("click",{bubbles:true}));});
  assert.equal(await asynchronous.evaluate(()=>window.__paperAdapter.saveCalls),1,"repeated pending clicks cannot duplicate a punch");
  await asynchronous.evaluate(()=>window.__paperAdapter.releaseSave());await saved(asynchronous,LOCAL_KEY,DAY,"start",asyncTime);
  await asynchronous.waitForFunction(()=>document.querySelector("#startPunch")?.classList.contains("is-success"));
  assert.equal(await asynchronous.locator("#startTime").inputValue(),asyncTime);
  const acceptedJSON=await raw(asynchronous,LOCAL_KEY);await asynchronous.clock.runFor(1100);
  await asynchronous.locator("#endPunch").click();await asynchronous.waitForFunction(()=>window.__paperAdapter.saveCalls===2);
  assert.equal(await raw(asynchronous,LOCAL_KEY),acceptedJSON);assert.equal(await asynchronous.locator("#endTime").inputValue(),"");
  assert.equal(await asynchronous.locator("#endPunch.is-success").count(),0);
  await asynchronous.evaluate(()=>window.__paperAdapter.rejectSave());
  await asynchronous.waitForFunction(()=>/adapter write failed/.test(document.querySelector("#previewError")?.textContent||""));
  assert.equal(await raw(asynchronous,LOCAL_KEY),acceptedJSON,"a rejected save must retain the previously accepted state");
  assert.equal(await asynchronous.locator("#startTime").inputValue(),asyncTime);assert.equal(await asynchronous.locator("#endTime").inputValue(),"");
  assert.equal(await asynchronous.locator("#punchState").innerText(),"勤務中");assert.equal(await asynchronous.locator("#endPunch.is-success").count(),0);
  assert.equal(await asynchronous.evaluate(()=>window.__paperAdapter.saveCalls),2);
  assert.equal(await raw(asynchronous,DEMO_KEY),null,"local adapter calls cannot create a demo store");

  // Typing may continue in the work note while its previous value is being saved.
  const note1="保存を待つ作業内容",note2="保存待ちの間に追記した作業内容";
  await asynchronous.locator("[data-detail=work]").click();await asynchronous.locator("#workNote").fill(note1);await asynchronous.locator("#workNote").dispatchEvent("change");
  await asynchronous.waitForFunction(()=>window.__paperAdapter.saveCalls===3);
  assert.equal(await asynchronous.locator("#workNote").isDisabled(),false,"the work note must remain editable during its save");
  assert.equal(await raw(asynchronous,LOCAL_KEY),acceptedJSON);
  await asynchronous.locator("[data-detail=work]").click();await asynchronous.locator("#workNote").fill(note2);
  // A real blur also attempts auto-save, and must retain the draft without a concurrent write.
  await asynchronous.locator("#workNote").evaluate(node=>node.blur());
  assert.equal(await asynchronous.evaluate(()=>window.__paperAdapter.saveCalls),3);
  await asynchronous.evaluate(()=>window.__paperAdapter.releaseSave());await saved(asynchronous,LOCAL_KEY,DAY,"note",note1);
  await asynchronous.waitForFunction(()=>/未保存/.test(document.querySelector("#workSaveStatus")?.textContent||""));
  assert.equal(await asynchronous.locator("#workNote").inputValue(),note2,"completing an older save cannot discard a newer note draft");
  assert.equal((await state(asynchronous)).records[DAY].note,note1);
  await asynchronous.locator("[data-action=retry-work]").click();await asynchronous.waitForFunction(()=>window.__paperAdapter.saveCalls===4);
  assert.equal((await state(asynchronous)).records[DAY].note,note1);
  assert.equal(await asynchronous.locator("#workNote").inputValue(),note2);
  await asynchronous.evaluate(()=>window.__paperAdapter.releaseSave());await saved(asynchronous,LOCAL_KEY,DAY,"note",note2);
  await asynchronous.waitForFunction(()=>!/未保存|保存中/.test(document.querySelector("#workSaveStatus")?.textContent||""));
  assert.equal(await asynchronous.locator("#workNote").inputValue(),note2);
  assert.equal(await asynchronous.locator("[data-action=retry-work]").count(),0);

  // Settings fields freeze until their submitted snapshot is accepted, then become editable again.
  await asynchronous.locator("#nav-settings").click();
  const defaultNote="次の勤務日の初期作業内容",defaultBreak="75",beforeDefaults=await raw(asynchronous,LOCAL_KEY);
  await asynchronous.locator("#defaultNote").fill(defaultNote);await asynchronous.locator("#defaultBreak").fill(defaultBreak);
  await asynchronous.locator("#defaultsForm button[type=submit]").click();await asynchronous.waitForFunction(()=>window.__paperAdapter.saveCalls===5);
  for(const selector of ["#defaultPlace","#defaultNote","#defaultBreak"])assert.equal(await asynchronous.locator(selector).isDisabled(),true,selector+" must freeze while its save is pending");
  assert.equal(await raw(asynchronous,LOCAL_KEY),beforeDefaults);
  await asynchronous.evaluate(()=>window.__paperAdapter.releaseSave());
  await asynchronous.waitForFunction(({key,note,minutes})=>{const saved=JSON.parse(localStorage.getItem(key));return saved?.defaults.note===note&&saved.defaults.breakMinutes===minutes;},{key:LOCAL_KEY,note:defaultNote,minutes:Number(defaultBreak)});
  await asynchronous.waitForFunction(()=>["defaultPlace","defaultNote","defaultBreak"].every(id=>{const node=document.getElementById(id);return node&&!node.disabled;}));
  assert.equal(await asynchronous.locator("#defaultNote").inputValue(),defaultNote);assert.equal(await asynchronous.locator("#defaultBreak").inputValue(),defaultBreak);
  assert.equal((await state(asynchronous)).records[DAY].note,note2,"saving new-day defaults cannot alter today's saved note");
  assert.equal(await asynchronous.evaluate(()=>window.__paperAdapter.saveCalls),5);
  console.log("PASS newer work-note drafts survive an older async save and retry, while pending defaults freeze and restore their controls");
  await asynchronousContext.close();await shared.close();
  assert.deepEqual(errors,[]);console.log("PASS delayed repository load/save, success only after acceptance, duplicate-punch suppression and rejected-save retention with no browser errors");
 }finally{await browser.close();}
}
run().then(()=>server.close(),error=>{console.error(error);server.close();process.exitCode=1});
