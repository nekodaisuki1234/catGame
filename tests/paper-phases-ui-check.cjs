"use strict";
// Run with Playwright/Chromium; PAPER_PLAYWRIGHT_MODULE can point to an installed module.
const {chromium}=require(process.env.PAPER_PLAYWRIGHT_MODULE||"playwright");
const assert=require("node:assert/strict"),http=require("node:http"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,".."),server=http.createServer((req,res)=>{
 const file=path.resolve(root,"."+new URL(req.url,"http://local").pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{res.setHeader("Content-Type",file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":"text/html");res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
const DAY="2026-10-27",INSTANT="2026-10-27T12:00:00Z",NOTE="保存済みの自由入力メモ";
const PHASES=["requirements","design","implementation","test","operations","maintenance","investigation","meeting"];
const LABELS=["要件定義","設計","製造","テスト","運用","保守","調査","会議"];
const ENTRIES=[{file:"a-paper.html?screen=1",mode:"demo"},{file:"a-paper-app.html",mode:"local"}];
const screenshots=process.env.PAPER_SCREENSHOT_DIR;
if(screenshots)fs.mkdirSync(screenshots,{recursive:true});
const sorted=values=>[...values].sort();

async function run(){
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.PAPER_CHROMIUM_PATH||(fs.existsSync("/usr/bin/chromium")?"/usr/bin/chromium":undefined),args:["--no-sandbox"]}),errors=[];
 const origin="http://127.0.0.1:"+server.address().port;
 const ready=page=>page.locator("#startPunch").waitFor();
 const raw=page=>page.evaluate(()=>localStorage.getItem(window.PaperConfig.storageKey));
 const stored=async page=>JSON.parse(await raw(page));
 const record=async page=>(await stored(page)).records[DAY];
 const action=editor=>editor?"editor-phase":"work-phase";
 const choices=editor=>editor?"#editorPhaseChoices":"#homePhaseChoices";
 const phase=(page,id,editor=false)=>page.locator('[data-action="'+action(editor)+'"][data-phase="'+id+'"]');
 const selected=(page,editor=false)=>page.locator('[data-action="'+action(editor)+'"][aria-pressed="true"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.phase));
 const settle=async page=>{await page.waitForFunction(()=>document.querySelector("#previewApp")?.getAttribute("aria-busy")!=="true");await page.clock.runFor(40);};
 const saved=async(page,expected)=>{
  await page.waitForFunction(({day,expected})=>{
   const actual=JSON.parse(localStorage.getItem(window.PaperConfig.storageKey)||"null")?.records[day]?.phases;
   return Array.isArray(actual)&&JSON.stringify([...actual].sort())===JSON.stringify([...expected].sort());
  },{day:DAY,expected});await settle(page);
 };
 const choose=async(page,id,expected)=>{await phase(page,id).click();await page.clock.runFor(40);await saved(page,expected);};
 const fixture=async(page,{complete=true,legacy=false,phases=[]}={})=>{
  await page.evaluate(({day,complete,legacy,phases,note})=>{
   const C=window.PaperAttendance,config=window.PaperConfig,now=C.clock(),state=config.mode==="local"?C.createState(now,{startDay:"2026-10-01"}):C.seed(now);
   state.records={};state.submissions={};
   const r={...C.empty(state),note:complete?note:"",start:complete?"09:00":"",end:complete?"18:00":"",allocation:{P1:complete?6:0,P2:complete?2:0,P3:0,P4:0,SET:0},phases};
   if(legacy)delete r.phases;
   state.records[day]=r;localStorage.setItem(config.storageKey,JSON.stringify(state));
  },{day:DAY,complete,legacy,phases,note:NOTE});await page.reload();await ready(page);
 };
 const fresh=async(entry,{delayed=false}={})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:"ja-JP"}),page=await context.newPage();
  page.on("pageerror",error=>errors.push(entry.mode+": "+error.message));
  if(delayed)await page.addInitScript(()=>{
   const control=window.__phaseAdapter={saveCalls:0,holdSave:false};
   window.PaperRepositoryFactory=options=>{
    const repository=window.PaperRepository.createLocal(options);
    return {...repository,async save(next,saveOptions){
     control.saveCalls++;
     if(control.holdSave)await new Promise((resolve,reject)=>{control.releaseSave=resolve;control.rejectSave=()=>reject(new Error("フェーズを保存できませんでした"));});
     return repository.save(next,saveOptions);
    }};
   };
  });
  await page.clock.install({time:new Date(INSTANT)});await page.goto(origin+"/day-designs/"+entry.file);await ready(page);await fixture(page);return {context,page};
 };
 const expectChoices=async(page,editor=false)=>{
  const group=page.locator(choices(editor));
  assert.equal(await group.getAttribute("role"),"group");
  assert.ok(await group.getAttribute("aria-label")||await group.getAttribute("aria-labelledby"),"phase choices need an accessible group label");
  const controls=group.locator('[data-action="'+action(editor)+'"]');
  assert.deepEqual(await controls.evaluateAll(nodes=>nodes.map(node=>node.dataset.phase)),PHASES);
  const captions=await controls.evaluateAll(nodes=>nodes.map(node=>node.textContent.trim()));
  for(const [index,id] of PHASES.entries()){
   assert.ok(captions[index].includes(LABELS[index]),"each phase retains its visible Japanese label");
   assert.equal(await phase(page,id,editor).getAttribute("type"),"button");
   assert.match(await phase(page,id,editor).getAttribute("aria-pressed"),/^(true|false)$/);
   assert.ok(await phase(page,id,editor).locator('svg[aria-hidden="true"]').count()>=1,"each phase has a decorative icon");
  }
 };
 const geometry=async(page,editor,label)=>{
  for(const width of [320,390,430]){
   await page.setViewportSize({width,height:844});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+" page overflow at "+width);
   const metrics=await page.locator(choices(editor)+' [data-action="'+action(editor)+'"]').evaluateAll(nodes=>nodes.map(node=>{
    const box=node.getBoundingClientRect();return {id:node.dataset.phase,left:box.left,right:box.right,width:box.width,height:box.height,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth};
   }));
   for(const metric of metrics){
    assert.ok(metric.left>=-1&&metric.right<=width+1,label+" phase "+metric.id+" outside viewport at "+width);
    assert.ok(metric.width>=43.5&&metric.height>=43.5,label+" phase "+metric.id+" tap area below44px at "+width);
    assert.ok(metric.scrollWidth<=metric.clientWidth+1,label+" phase "+metric.id+" content clips at "+width);
   }
   if(!editor){
    const absent=await page.locator("#homeAbsence").boundingBox(),planned=await page.locator("#plannedHoursValue").boundingBox();
    assert.ok(absent.x<planned.x,label+" absence must be to the left of planned work at "+width);
    const card=await page.locator(".monthly-summary-card").boundingBox(),change=await page.locator("[data-action=edit-plan]").boundingBox();
    assert.ok(change.x+change.width/2>card.x+card.width/2,label+" planned-time edit must be in the right half at "+width);
   }
  }
  await page.setViewportSize({width:390,height:844});
 };
 const screenshot=async(page,name)=>{if(screenshots)await page.screenshot({path:path.join(screenshots,name+".png"),fullPage:true});};
 try{
  for(const entry of ENTRIES){
   const {context,page}=await fresh(entry),label=entry.mode;
   await fixture(page,{legacy:true});const legacy=await raw(page);
   await expectChoices(page);assert.deepEqual(await selected(page),[]);
   assert.equal(await raw(page),legacy,"loading a record without phases must not rewrite storage");
   assert.equal(await page.locator("#workNote").inputValue(),NOTE);
   await choose(page,"requirements",["requirements"]);await choose(page,"test",["requirements","test"]);
   assert.deepEqual(sorted(await selected(page)),sorted(["requirements","test"]));
   assert.equal((await record(page)).note,NOTE,"phase labels cannot replace or append to free text");
   assert.deepEqual((await record(page)).allocation,{P1:6,P2:2,P3:0,P4:0,SET:0});
   await page.locator("#nav-records").click();await page.locator("#nav-home").click();await ready(page);
   assert.deepEqual(sorted(await selected(page)),sorted(["requirements","test"]));
   await page.reload();await ready(page);assert.deepEqual(sorted(await selected(page)),sorted(["requirements","test"]));
   await choose(page,"requirements",["test"]);await choose(page,"test",[]);
   assert.deepEqual((await record(page)).phases,[],"unselecting everything must persist an explicit empty array");
   await fixture(page,{complete:false});await choose(page,"design",["design"]);
   assert.equal((await record(page)).start,"");assert.equal((await record(page)).end,"");assert.equal((await record(page)).note,"");
   assert.doesNotMatch(await page.locator("#studyToast").innerText(),/休憩時間を引いた|不足しています|欠勤/);
   console.log("PASS "+label+" optional legacy phases, multiple selection/removal, reload/navigation persistence, unchanged free text/allocation and phase-only saves before punching");

   // Selected phases complement the free memo; they do not satisfy the required work description.
   await fixture(page,{phases:["test"]});await page.locator("#workNote").fill("");await page.locator("#workNote").dispatchEvent("change");await settle(page);
   const validation=await page.evaluate(day=>{const C=window.PaperAttendance,state=JSON.parse(localStorage.getItem(window.PaperConfig.storageKey));return C.submissionCheck(state,{start:day,end:day},C.clock());},DAY);
   assert.equal((await record(page)).note,"");assert.equal(validation.ok,false);assert.match(JSON.stringify(validation.errors),/作業内容/);
   await fixture(page,{phases:["test"]});

   // Daily editing stages phase changes alongside the memo and saves them together.
   await page.locator("#nav-records").click();await page.locator('#recordList [data-day="'+DAY+'"]').click();await expectChoices(page,true);
   const beforeEditor=await raw(page);await phase(page,"requirements",true).click();await page.locator("#editNote").fill("編集画面で自由に入力した内容");
   assert.equal(await raw(page),beforeEditor,"phase buttons in the editor cannot auto-save a partially edited day");
   await page.locator("[data-action=editor-prev]").click();await page.locator("[data-action=editor-next]").click();
   assert.deepEqual(sorted(await selected(page,true)),sorted(["requirements","test"]));assert.equal(await page.locator("#editNote").inputValue(),"編集画面で自由に入力した内容");
   await geometry(page,true,label+" editor");await screenshot(page,label+"-paper-phases-editor");
   await page.locator("#dayForm button[type=submit]").click();await saved(page,["requirements","test"]);
   assert.equal((await record(page)).note,"編集画面で自由に入力した内容");assert.equal((await record(page)).allocation.P2,2);
   await page.locator("#nav-home").click();await ready(page);assert.deepEqual(sorted(await selected(page)),sorted(["requirements","test"]));
   await geometry(page,false,label+" home");await screenshot(page,label+"-paper-phases-home");
   console.log("PASS "+label+" free-memo submission requirement, staged editor phases with retained drafts, right-side plan editing and 320/390/430px phase controls");

   // Rejected saves retain all three work drafts, and the explicit retry commits them together.
   await fixture(page,{phases:["design"]});const beforeFailure=await raw(page);
   await page.evaluate(()=>{window.phaseOriginalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error("quota")};});
   await phase(page,"maintenance").click();await settle(page);assert.equal(await raw(page),beforeFailure);
   assert.deepEqual(sorted(await selected(page)),sorted(["design","maintenance"]));assert.match(await page.locator("#workSaveStatus").innerText(),/未保存/);
   await page.locator("#workNote").fill("失敗しても残す自由入力");await page.locator("#workNote").dispatchEvent("change");await settle(page);
   await page.locator("#workNote").evaluate(node=>node.blur());await settle(page);
   await page.locator("#workPlace").selectOption("place2");await settle(page);
   assert.equal(await raw(page),beforeFailure);
   await page.locator("#nav-records").click();await page.locator("#nav-home").click();await ready(page);
   assert.deepEqual(sorted(await selected(page)),sorted(["design","maintenance"]));assert.equal(await page.locator("#workNote").inputValue(),"失敗しても残す自由入力");assert.equal(await page.locator("#workPlace").inputValue(),"place2");
   await page.evaluate(()=>Storage.prototype.setItem=window.phaseOriginalSetItem);
   await page.locator("[data-action=retry-work]").click();await saved(page,["design","maintenance"]);
   assert.equal((await record(page)).note,"失敗しても残す自由入力");assert.equal((await record(page)).locationId,"place2");assert.equal(await page.locator("[data-action=retry-work]").count(),0);
   console.log("PASS "+label+" failed phase/note/place saves preserve drafts across navigation and retry all work fields together");
   await context.close();

   // A note's blur save cannot swallow a phase tap; later phase choices coalesce.
   const asyncView=await fresh(entry,{delayed:true}),pending=asyncView.page;
   await fixture(pending,{phases:["design"]});await pending.evaluate(()=>window.__phaseAdapter.holdSave=true);
   const accepted=await raw(pending),firstNote="フェーズを選ぶ直前に入力したメモ",newerNote="保存を待つ間に追記した自由入力";
   await pending.locator("#workNote").fill(firstNote);await phase(pending,"requirements").click();await pending.waitForFunction(()=>window.__phaseAdapter.saveCalls===1);
   assert.equal(await raw(pending),accepted);assert.equal(await pending.locator("#workNote").isDisabled(),false);
   for(const id of PHASES)assert.equal(await phase(pending,id).isDisabled(),false,"phase taps remain available while a memo save is pending");
   for(const id of ["test","maintenance","meeting"])await phase(pending,id).click();
   const combined=["requirements","design","test","maintenance","meeting"];
   assert.deepEqual(sorted(await selected(pending)),sorted(combined));
   assert.equal(await pending.evaluate(()=>window.__phaseAdapter.saveCalls),1,"rapid phase choices must not create concurrent repository saves");
   await pending.locator("#workNote").fill(newerNote);await pending.locator("#workNote").evaluate(node=>node.blur());
   assert.equal(await pending.evaluate(()=>window.__phaseAdapter.saveCalls),1);
   await pending.evaluate(()=>window.__phaseAdapter.releaseSave());
   await pending.waitForFunction(({day,note})=>JSON.parse(localStorage.getItem(window.PaperConfig.storageKey)).records[day].note===note,{day:DAY,note:firstNote});
   await pending.clock.runFor(40);await pending.waitForFunction(()=>window.__phaseAdapter.saveCalls===2);
   assert.equal((await record(pending)).note,firstNote);assert.deepEqual((await record(pending)).phases,["design"],"queued phase changes wait for their own accepted write");
   assert.equal(await pending.locator("#workNote").inputValue(),newerNote);
   await pending.evaluate(()=>window.__phaseAdapter.releaseSave());await saved(pending,combined);
   assert.equal(await pending.evaluate(()=>window.__phaseAdapter.saveCalls),2,"later phase choices should coalesce to one queued write");
   assert.equal((await record(pending)).note,firstNote);assert.equal(await pending.locator("#workNote").inputValue(),newerNote);assert.match(await pending.locator("#workSaveStatus").innerText(),/未保存/);
   await pending.locator("[data-action=retry-work]").click();await pending.waitForFunction(()=>window.__phaseAdapter.saveCalls===3);
   await pending.evaluate(()=>window.__phaseAdapter.releaseSave());await saved(pending,combined);
   assert.equal((await record(pending)).note,newerNote);

   // A rejected phase save keeps the latest selection without an automatic retry loop.
   const beforeNavigation=await raw(pending);await phase(pending,"investigation").click();await pending.clock.runFor(40);await pending.waitForFunction(()=>window.__phaseAdapter.saveCalls===4);
   await phase(pending,"operations").click();const afterFailure=[...combined,"investigation","operations"];
   await pending.locator("#nav-records").click();await pending.locator("#nav-home").click();await ready(pending);
   for(const id of PHASES)assert.equal(await phase(pending,id).isDisabled(),false);
   await pending.evaluate(()=>window.__phaseAdapter.rejectSave());await settle(pending);assert.equal(await raw(pending),beforeNavigation);
   assert.deepEqual(sorted(await selected(pending)),sorted(afterFailure));
   await pending.clock.runFor(100);assert.equal(await pending.evaluate(()=>window.__phaseAdapter.saveCalls),4,"failed saves require explicit retry");
   await pending.evaluate(()=>window.__phaseAdapter.holdSave=false);await pending.locator("[data-action=retry-work]").click();await saved(pending,afterFailure);
   assert.equal((await record(pending)).note,newerNote);assert.equal(await pending.evaluate(()=>window.__phaseAdapter.saveCalls),5);
   console.log("PASS "+label+" blur-then-phase taps, coalesced serial saves, newer free-note drafts and explicit recovery after rejected phase saves");
   await asyncView.context.close();

   // Opening the daily editor before the queue commits must include the pending phases.
   const editorView=await fresh(entry,{delayed:true}),editing=editorView.page;
   await fixture(editing,{phases:["design"]});await editing.evaluate(()=>window.__phaseAdapter.holdSave=true);
   const pendingNote="編集を開く直前に入力したメモ",editorNote="編集中に追記した自由入力";
   await editing.locator("#workNote").fill(pendingNote);await phase(editing,"requirements").click();await editing.waitForFunction(()=>window.__phaseAdapter.saveCalls===1);
   await editing.locator("#nav-records").click();await editing.locator('#recordList [data-day="'+DAY+'"]').click();
   assert.deepEqual(sorted(await selected(editing,true)),sorted(["requirements","design"]),"the editor must show the queued home selection before persistence");
   assert.equal(await editing.locator("#editNote").inputValue(),pendingNote);
   assert.equal(await editing.locator("#editNote").isDisabled(),true,"the editor keeps its normal pending-save guard");
   await editing.evaluate(()=>window.__phaseAdapter.releaseSave());
   await editing.waitForFunction(({day,note})=>JSON.parse(localStorage.getItem(window.PaperConfig.storageKey)).records[day].note===note,{day:DAY,note:pendingNote});
   await editing.clock.runFor(40);await editing.waitForFunction(()=>window.__phaseAdapter.saveCalls===2);
   await editing.evaluate(()=>window.__phaseAdapter.releaseSave());await saved(editing,["requirements","design"]);
   assert.equal(await editing.locator("#editNote").inputValue(),pendingNote);
   assert.deepEqual(sorted(await selected(editing,true)),sorted(["requirements","design"]));
   assert.equal((await record(editing)).note,pendingNote);
   await editing.locator("#editNote").fill(editorNote);await editing.locator("#editPlace").selectOption("place2");
   assert.equal((await record(editing)).note,pendingNote,"unrelated editor fields remain staged until explicit update");
   await editing.evaluate(()=>window.__phaseAdapter.holdSave=false);await editing.locator("#dayForm button[type=submit]").click();await saved(editing,["requirements","design"]);
   assert.equal((await record(editing)).note,editorNote);assert.equal((await record(editing)).locationId,"place2");
   assert.equal(await editing.evaluate(()=>window.__phaseAdapter.saveCalls),3);
   console.log("PASS "+label+" queued home phases enter the daily editor and survive unrelated edits while background saves complete");
   await editorView.context.close();

   // A held write spanning midnight keeps each day's pending phase intent separate.
   const midnightView=await fresh(entry,{delayed:true}),midnight=midnightView.page,nextDay="2026-10-28",oldNote="日付が変わる前の作業メモ";
   await fixture(midnight,{phases:["design"]});await midnight.evaluate(()=>window.__phaseAdapter.holdSave=true);
   await midnight.locator("#workNote").fill(oldNote);await phase(midnight,"requirements").click();await midnight.waitForFunction(()=>window.__phaseAdapter.saveCalls===1);
   await midnight.clock.setSystemTime(new Date("2026-10-27T15:01:00Z"));await midnight.clock.runFor(1100);
   await midnight.waitForFunction(day=>document.querySelector(".hero-date")?.getAttribute("datetime")===day,nextDay);
   assert.deepEqual(await selected(midnight),[],"the new day cannot inherit the previous day's selected phases");
   const nextNote=await midnight.locator("#workNote").inputValue();
   await phase(midnight,"operations").click();assert.deepEqual(await selected(midnight),["operations"]);
   assert.equal(await midnight.evaluate(()=>window.__phaseAdapter.saveCalls),1,"midnight cannot start a concurrent repository save");
   await midnight.evaluate(()=>window.__phaseAdapter.releaseSave());
   await midnight.waitForFunction(({day,note})=>JSON.parse(localStorage.getItem(window.PaperConfig.storageKey)).records[day].note===note,{day:DAY,note:oldNote});
   await midnight.clock.runFor(40);await midnight.waitForFunction(()=>window.__phaseAdapter.saveCalls===2);
   assert.equal((await stored(midnight)).records[nextDay],undefined);
   await midnight.evaluate(()=>window.__phaseAdapter.releaseSave());
   await midnight.waitForFunction(day=>JSON.parse(localStorage.getItem(window.PaperConfig.storageKey)).records[day].phases?.includes("requirements"),DAY);
   await midnight.clock.runFor(40);await midnight.waitForFunction(()=>window.__phaseAdapter.saveCalls===3);
   assert.equal((await stored(midnight)).records[nextDay],undefined,"the new day stays uncommitted until its own queued write is accepted");
   await midnight.evaluate(()=>window.__phaseAdapter.releaseSave());
   await midnight.waitForFunction(day=>JSON.stringify(JSON.parse(localStorage.getItem(window.PaperConfig.storageKey)).records[day]?.phases)==='["operations"]',nextDay);await settle(midnight);
   const finalDays=(await stored(midnight)).records;
   assert.deepEqual(sorted(finalDays[DAY].phases),sorted(["requirements","design"]));assert.equal(finalDays[DAY].note,oldNote);
   assert.deepEqual(finalDays[nextDay].phases,["operations"]);assert.equal(finalDays[nextDay].note,nextNote);assert.equal(finalDays[nextDay].start,"");
   assert.deepEqual(await selected(midnight),["operations"]);assert.equal(await midnight.locator("#workNote").inputValue(),nextNote);
   assert.equal(await midnight.evaluate(()=>window.__phaseAdapter.saveCalls),3);
   console.log("PASS "+label+" held saves and multiple queued dates survive midnight without phase or free-note contamination");
   await midnightView.context.close();
  }
  assert.deepEqual(errors,[]);console.log("PASS phase integration in both HTML entries without browser errors");
 }finally{await browser.close();}
}
run().then(()=>server.close(),error=>{console.error(error);server.close();process.exitCode=1});
