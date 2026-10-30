"use strict";
const {chromium}=require(process.env.PAPER_PLAYWRIGHT_MODULE||"playwright");
const assert=require("node:assert/strict"),http=require("node:http"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,".."),server=http.createServer((req,res)=>{
 const file=path.resolve(root,"."+new URL(req.url,"http://local").pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{res.setHeader("Content-Type",file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":"text/html");res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
const DAY="2026-10-27",PAST="2026-10-26",ENTRIES=["a-paper.html?screen=1","a-paper-app.html"];
const screenshots=process.env.PAPER_SCREENSHOT_DIR;if(screenshots)fs.mkdirSync(screenshots,{recursive:true});
async function run(){
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.PAPER_CHROMIUM_PATH||(fs.existsSync("/usr/bin/chromium")?"/usr/bin/chromium":undefined),args:["--no-sandbox"]}),errors=[];
 const origin="http://127.0.0.1:"+server.address().port;
 const raw=page=>page.evaluate(()=>localStorage.getItem(window.PaperConfig.storageKey));
 const stored=async page=>JSON.parse(await raw(page));
 const receipts=state=>Object.values(state.leaveRequests||{});
 const ready=page=>page.locator('#startPunch').waitFor();
 const settle=async page=>{await page.waitForFunction(()=>document.querySelector('#previewApp').getAttribute('aria-busy')!=='true');await page.clock.runFor(50);};
 const send=page=>page.locator('[data-action=editor-leave-request]');
 const update=page=>page.locator('#dayForm button[type=submit]');
 const confirm=page=>page.locator('[data-action=confirm-leave-request]');
 const select=(page,value)=>page.locator('[data-action="editor-leave"][data-leave="'+value+'"]');
 const dialogOpen=page=>page.locator('#paperDialog').evaluate(node=>node.open);
 const cancel=async page=>{await page.locator('#paperDialog [data-action=close-dialog]').last().click();assert.equal(await dialogOpen(page),false);};
 const edit=async(page,day)=>{await page.locator('#nav-records').click();await page.locator('#recordList [data-day="'+day+'"]').click();assert.equal(await page.locator('#editDate').inputValue(),day);};
 const change=async(page,id,value)=>{await page.locator('#'+id).fill(value);await page.locator('#'+id).dispatchEvent('change');};
 const fixture=async page=>{
  await page.evaluate(day=>{
   const C=window.PaperAttendance,config=window.PaperConfig,state=config.mode==='local'?C.createState(C.clock(),{startDay:'2026-10-01'}):C.seed(C.clock());
   const work=(note)=>({...C.empty(state),start:'09:00',end:'18:00',note,phases:['design','meeting'],allocation:{P1:6,P2:2,P3:0,P4:0,SET:0}});
   state.records={'2026-10-24':work('休日出勤24'),'2026-10-25':work('休日出勤25'),'2026-10-26':work('過去のメモ'),[day]:work('今日のメモ')};state.submissions={};delete state.leaveRequests;
   localStorage.setItem(config.storageKey,JSON.stringify(state));
  },DAY);await page.reload();await ready(page);
 };
 try{
  for(const entry of ENTRIES){
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'ja-JP'}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   await page.clock.install({time:new Date('2026-10-27T12:00:00Z')});await page.goto(origin+'/day-designs/'+entry);await ready(page);await fixture(page);await edit(page,PAST);
   assert.equal(await send(page).innerText(),'送信');const before=await raw(page);
   await page.locator('#editorWorkTab-note').click();await page.locator('#editNote').fill('編集と休暇申請を一緒に保存 <memo>');await page.locator('#editPlace').selectOption('place2');await change(page,'editBreak','01:30');
   await page.locator('#editorWorkTab-phases').click();assert.equal(await page.locator('[data-action="editor-phase"][data-phase="meeting"]').innerText(),'その他');await page.locator('[data-action="editor-phase"][data-phase="meeting"]').click();await page.locator('[data-action="editor-phase"][data-phase="test"]').click();await page.locator('#editorWorkTab-note').click();
   await select(page,'am').click();assert.equal(await raw(page),before);assert.equal(await page.locator('#editAllocP1').inputValue(),'5.5');assert.equal(await page.locator('#editAllocP2').inputValue(),'2');
   await send(page).click();assert.equal(await dialogOpen(page),true);assert.match(await page.locator('#paperDialog').innerText(),/管理者に休暇申請を行います/);assert.match(await page.locator('#paperDialog').innerText(),/10月26日/);assert.match(await page.locator('#paperDialog').innerText(),/午前半休/);assert.equal(await raw(page),before);await cancel(page);
   await page.locator('[data-action=editor-prev]').click();await page.locator('[data-action=editor-next]').click();assert.equal(await page.locator('#editDate').inputValue(),PAST);assert.equal(await page.locator('#editNote').inputValue(),'編集と休暇申請を一緒に保存 <memo>');assert.equal(await page.locator('#editPlace').inputValue(),'place2');assert.equal(await page.locator('#editLeave').inputValue(),'am');assert.equal(await page.locator('#editBreak').inputValue(),'01:30');
   await send(page).click();await page.evaluate(()=>{window.editorLeaveOriginalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error('quota')};});await confirm(page).click();await settle(page);assert.equal(await raw(page),before);assert.equal(await dialogOpen(page),true);assert.equal(await page.locator('#editNote').inputValue(),'編集と休暇申請を一緒に保存 <memo>');assert.equal(receipts(await stored(page)).length,0);
   await page.evaluate(()=>Storage.prototype.setItem=window.editorLeaveOriginalSetItem);await confirm(page).click();await settle(page);const saved=await stored(page),record=saved.records[PAST];assert.equal(await dialogOpen(page),false);
   assert.equal(record.leave,'am');assert.equal(record.note,'編集と休暇申請を一緒に保存 <memo>');assert.equal(record.locationId,'place2');assert.deepEqual(record.phases,['design','test']);assert.equal(record.breakMinutes,90);assert.equal(record.start,'09:00');assert.equal(record.end,'18:00');assert.deepEqual(record.allocation,{P1:5.5,P2:2,P3:0,P4:0,SET:0});
   assert.equal(receipts(saved).length,1);assert.equal(receipts(saved)[0].day,PAST);assert.equal(receipts(saved)[0].delivery,'local');assert.match(await page.locator('#editorLeaveSaveStatus').innerText(),/未接続|このブラウザ/);
   const beforeOrdinaryReceipts=JSON.stringify(saved.leaveRequests);await page.locator('#editorWorkTab-note').click();await page.locator('#editNote').fill('休暇を変えない通常の編集');await update(page).click();await settle(page);assert.equal(await dialogOpen(page),false);assert.equal(JSON.stringify((await stored(page)).leaveRequests),beforeOrdinaryReceipts,'ordinary attendance edits do not create another leave request');

   const beforeFull=await raw(page);await select(page,'paid').click();assert.equal(await page.locator('#editStart').inputValue(),'');assert.equal(await page.locator('#editEnd').inputValue(),'');await update(page).click();assert.equal(await dialogOpen(page),true,'general Update cannot bypass changed-leave confirmation');assert.equal(await raw(page),beforeFull);await cancel(page);assert.equal(await raw(page),beforeFull);assert.equal(await page.locator('#editLeave').inputValue(),'paid');
   await send(page).click();await confirm(page).click();await settle(page);const full=await stored(page);assert.equal(full.records[PAST].leave,'paid');assert.equal(full.records[PAST].start,'');assert.equal(full.records[PAST].end,'');assert.equal(receipts(full).length,2);
   console.log('PASS '+entry+' past-day editor send, entire edited-form snapshot, cancel/failure drafts, neighboring dates, unchanged-leave normal save and guarded Update');

   await fixture(page);await edit(page,DAY);const beforeMismatch=await raw(page);await select(page,'pm').click();await page.locator('#editAllocP1').fill('5');await send(page).click();await settle(page);assert.equal(await dialogOpen(page),false);assert.equal(await raw(page),beforeMismatch);assert.match(await page.locator('#studyToast').innerText(),/工数合計|一致/);
   await update(page).click();await settle(page);assert.equal(await dialogOpen(page),false);assert.equal(await raw(page),beforeMismatch,'general Update cannot bypass strict allocation validation');
   await page.locator('#editAllocP1').fill('6');await send(page).click();await confirm(page).click();await settle(page);assert.equal((await stored(page)).records[DAY].allocation.P2,2);
   await page.locator('#nav-home').click();await page.locator('[data-detail=leave]').click();assert.equal(await page.locator('#leaveType').inputValue(),'pm');assert.equal(await page.locator('[data-action="home-leave"][data-leave="pm"]').getAttribute('aria-pressed'),'true');assert.match(await page.locator('#leaveSaveStatus').innerText(),/未接続|このブラウザ/);const homeSynced=await raw(page);await page.locator('#leaveForm button[type=submit]').evaluate(node=>node.click());await settle(page);assert.equal(await dialogOpen(page),false);assert.equal(await raw(page),homeSynced,'home sees editor receipt and prevents duplicate submission');

   await fixture(page);await edit(page,PAST);await select(page,'comp').click();const beforeComp=await raw(page);await send(page).click();await settle(page);assert.equal(await dialogOpen(page),false);assert.equal(await raw(page),beforeComp);assert.match(await page.locator('#studyToast').innerText(),/代休|休日出勤/);
   await page.locator('#editSourceDay').selectOption('2026-10-24');await send(page).click();await confirm(page).click();await settle(page);assert.equal((await stored(page)).records[PAST].sourceDay,'2026-10-24');
   const beforeSourceChange=await raw(page);await page.locator('#editSourceDay').selectOption('2026-10-25');await update(page).click();assert.equal(await dialogOpen(page),true,'changing only the comp source also requires confirmation');assert.equal(await raw(page),beforeSourceChange);await confirm(page).click();await settle(page);assert.equal((await stored(page)).records[PAST].sourceDay,'2026-10-25');assert.equal(receipts(await stored(page)).length,2);
   await edit(page,DAY);await select(page,'comp').click();assert.equal(await page.locator('#editSourceDay option[value="2026-10-25"]').count(),0);await page.locator('#editSourceDay').evaluate(node=>node.add(new Option('使用済み元日','2026-10-25')));await page.locator('#editSourceDay').selectOption('2026-10-25');const beforeDuplicate=await raw(page);await send(page).click();await settle(page);assert.equal(await dialogOpen(page),false);assert.equal(await raw(page),beforeDuplicate);assert.match(await page.locator('#studyToast').innerText(),/代休|使用|紐付/);
   for(const width of [320,390,430]){await page.setViewportSize({width,height:844});await send(page).scrollIntoViewIfNeeded();const r=await send(page).boundingBox();assert.ok(r.width>=43.5&&r.height>=43.5);assert.ok(r.x>=-1&&r.x+r.width<=width+1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
   await page.setViewportSize({width:390,height:844});if(screenshots){await page.screenshot({path:path.join(screenshots,(entry.includes('-app')?'local':'demo')+'-paper-leave-editor-parity.png'),fullPage:true});}
   console.log('PASS '+entry+' editor strict allocation, home/editor receipt parity, comp-source changes and duplicate protection, mobile send and その他 phase label');await context.close();
  }
  assert.deepEqual(errors,[]);console.log('PASS matching home/editor leave requests without browser errors');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);server.close();process.exitCode=1;});
