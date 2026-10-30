"use strict";
const {chromium}=require(process.env.PAPER_PLAYWRIGHT_MODULE||"playwright");
const assert=require("node:assert/strict"),http=require("node:http"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,".."),server=http.createServer((req,res)=>{
 const file=path.resolve(root,"."+new URL(req.url,"http://local").pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{res.setHeader("Content-Type",file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":"text/html");res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
const DAY="2026-10-27",INSTANT="2026-10-27T12:00:00Z",ENTRIES=["a-paper.html?screen=1","a-paper-app.html"];
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
 const select=(page,value)=>page.locator('[data-action="home-leave"][data-leave="'+value+'"]');
 const send=page=>page.locator('#leaveForm button[type=submit]');
 const confirm=page=>page.locator('[data-action=confirm-leave-request]');
 const dialog=page=>page.locator('#paperDialog');
 const openLeave=page=>page.locator('[data-detail=leave]').click();
 const cancel=async page=>{await page.locator('#paperDialog [data-action=close-dialog]').last().click();assert.equal(await dialog(page).evaluate(node=>node.open),false);};
 const fixture=async(page,{complete=true,source=true}={})=>{
  await page.clock.setSystemTime(new Date(INSTANT));
  await page.evaluate(({day,complete,source})=>{
   const C=window.PaperAttendance,config=window.PaperConfig,state=config.mode==='local'?C.createState(C.clock(),{startDay:'2026-10-01'}):C.seed(C.clock());
   const working={...C.empty(state),start:'09:00',end:'18:00',note:'申請で失わない作業内容',phases:['design','meeting'],allocation:{P1:6,P2:2,P3:0,P4:0,SET:0}};
   state.records={[day]:complete?working:{...C.empty(state),note:'申請で失わない作業内容',phases:['design','meeting']}};
   if(source)state.records['2026-10-24']={...working};state.submissions={};delete state.leaveRequests;
   localStorage.setItem(config.storageKey,JSON.stringify(state));
  },{day:DAY,complete,source});await page.reload();await ready(page);await openLeave(page);
 };
 const popupGeometry=async page=>{
  for(const width of [320,390,430]){
   await page.setViewportSize({width,height:844});
   const box=await dialog(page).boundingBox();assert.ok(box.x>=-1&&box.x+box.width<=width+1,'confirmation outside '+width+'px viewport');
   assert.ok(await dialog(page).evaluate(node=>node.scrollWidth<=node.clientWidth+1),'confirmation has horizontal overflow');
   for(const button of await dialog(page).locator('button:visible').all()){const r=await button.boundingBox();assert.ok(r.width>=43.5&&r.height>=43.5,'confirmation needs 44px controls');}
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow while confirming');
  }
  await page.setViewportSize({width:390,height:844});
 };
 try{
  for(const entry of ENTRIES){
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'ja-JP'}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>{
    const control=window.__leaveAdapter={calls:0,hold:false};window.PaperRepositoryFactory=options=>{
     const repo=window.PaperRepository.createLocal(options);return {...repo,async save(next,saveOptions){control.calls++;if(control.hold)await new Promise(resolve=>{control.release=resolve;});return repo.save(next,saveOptions);}};
    };
   });
   await page.clock.install({time:new Date(INSTANT)});await page.goto(origin+'/day-designs/'+entry);await ready(page);await fixture(page);
   const before=await raw(page);assert.equal(await send(page).innerText(),'送信');await page.reload();await ready(page);await openLeave(page);assert.equal(await raw(page),before,'old data without request history loads without writes');
   await send(page).click();await settle(page);assert.equal(await dialog(page).evaluate(node=>node.open),false);assert.equal(await raw(page),before,'no-leave is not a new leave application');
   await select(page,'paid').click();assert.equal(await raw(page),before,'choosing a leave cannot persist attendance or a receipt');assert.equal(await page.locator('#startTime').inputValue(),'09:00');
   await send(page).click();assert.equal(await dialog(page).evaluate(node=>node.open),true);assert.match(await dialog(page).innerText(),/管理者に休暇申請を行います/);assert.match(await dialog(page).innerText(),/10月27日/);assert.match(await dialog(page).innerText(),/有給休暇/);assert.match(await dialog(page).innerText(),/管理者への送信先は未接続です/);
   assert.equal(await raw(page),before,'opening confirmation cannot persist anything');await popupGeometry(page);
   if(screenshots){await page.screenshot({path:path.join(screenshots,(entry.includes('-app')?'local':'demo')+'-paper-leave-request-confirm.png'),fullPage:false});}
   await cancel(page);assert.equal(await raw(page),before,'cancelling confirmation cannot clear punches or apply leave');assert.equal(await select(page,'paid').getAttribute('aria-pressed'),'true','cancel retains the chosen draft');

   await send(page).click();await page.evaluate(()=>window.__leaveAdapter.hold=true);const calls=await page.evaluate(()=>window.__leaveAdapter.calls);
   await confirm(page).evaluate(node=>{node.click();node.click();});await page.waitForFunction(()=>document.querySelector('#previewApp').getAttribute('aria-busy')==='true');
   assert.equal(await confirm(page).isDisabled(),true);assert.equal(await raw(page),before,'an unaccepted request cannot alter attendance');assert.equal(await page.evaluate(()=>window.__leaveAdapter.calls),calls+1,'double confirm cannot start concurrent writes');
   await page.evaluate(()=>{window.__leaveAdapter.hold=false;window.__leaveAdapter.release()});await settle(page);assert.equal(await dialog(page).evaluate(node=>node.open),false);
   const applied=await stored(page),receipt=receipts(applied)[0];assert.equal(applied.revision,JSON.parse(before).revision+1);assert.equal(receipts(applied).length,1);
   assert.equal(applied.records[DAY].leave,'paid');assert.equal(applied.records[DAY].start,'');assert.equal(applied.records[DAY].end,'');assert.equal(applied.records[DAY].overnight,false);assert.deepEqual(applied.records[DAY].allocation,{P1:0,P2:0,P3:0,P4:0,SET:0});
   assert.equal(applied.records[DAY].note,'申請で失わない作業内容');assert.deepEqual(applied.records[DAY].phases,['design','meeting']);
   assert.equal(receipt.id,Object.keys(applied.leaveRequests)[0]);assert.equal(receipt.day,DAY);assert.equal(receipt.leave,'paid');assert.equal(receipt.sourceDay,'');assert.equal(receipt.delivery,'local');assert.ok(Number.isFinite(Date.parse(receipt.requestedAt)));
   assert.match((await page.locator('#studyToast').innerText())+' '+(await page.locator('#leaveSaveStatus').innerText()),/未接続|このブラウザ|デモ/,'completion cannot claim actual administrator delivery');
   const completed=await raw(page);await send(page).evaluate(node=>node.click());await settle(page);assert.equal(await dialog(page).evaluate(node=>node.open),false);assert.equal(await raw(page),completed,'repeating an unchanged submitted request cannot create another receipt');
   await select(page,'').click();assert.equal(await raw(page),completed);await send(page).click();await confirm(page).click();await settle(page);const withdrawn=await stored(page);assert.equal(withdrawn.records[DAY].leave,'');assert.equal(withdrawn.records[DAY].start,'');assert.equal(withdrawn.records[DAY].end,'');assert.equal(receipts(withdrawn).length,2);assert.equal(receipts(withdrawn).at(-1).leave,'');
   console.log('PASS '+entry+' staged request, exact confirmation, cancel, one atomic local receipt, duplicate guard, full-leave clear and withdrawal without time revival');

   await fixture(page);await select(page,'comp').click();const beforeComp=await raw(page);await send(page).click();await settle(page);assert.equal(await dialog(page).evaluate(node=>node.open),false);assert.equal(await raw(page),beforeComp);assert.match(await page.locator('#studyToast').innerText(),/代休|休日出勤/);
   await page.locator('#leaveSourceDay').selectOption('2026-10-24');await send(page).click();assert.match(await dialog(page).innerText(),/10月24日/);await confirm(page).click();await settle(page);assert.equal((await stored(page)).records[DAY].sourceDay,'2026-10-24');assert.equal(receipts(await stored(page))[0].sourceDay,'2026-10-24');
   for(const width of [320,390,430]){
    await page.setViewportSize({width,height:844});const form=page.locator('#leaveForm'),button=await send(page).boundingBox(),right=await form.evaluate(node=>{const b=node.getBoundingClientRect(),s=getComputedStyle(node);return b.right-parseFloat(s.paddingRight)-parseFloat(s.borderRightWidth)});assert.ok(Math.abs(right-button.x-button.width)<=1,'send must stay on the right');
   }
   await page.setViewportSize({width:390,height:844});
   await fixture(page);await select(page,'paid').click();await send(page).click();const beforeFailure=await raw(page);
   await page.evaluate(()=>{window.leaveOriginalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error('quota')};});await confirm(page).click();await settle(page);
   assert.equal(await raw(page),beforeFailure);assert.equal(await dialog(page).evaluate(node=>node.open),true);assert.equal((await stored(page)).records[DAY].start,'09:00');assert.equal(receipts(await stored(page)).length,0);assert.match(await page.locator('#dialogError').innerText(),/保存|記録/);
   await page.evaluate(()=>Storage.prototype.setItem=window.leaveOriginalSetItem);await confirm(page).click();await settle(page);assert.equal((await stored(page)).records[DAY].start,'');assert.equal(receipts(await stored(page)).length,1);
   console.log('PASS '+entry+' validated compensatory source, right-aligned send, rejected-save atomicity and retained confirmation retry');

   await fixture(page);await select(page,'paid').click();await send(page).click();await page.clock.setSystemTime(new Date('2026-10-27T15:01:00Z'));await page.clock.runFor(1100);assert.match(await dialog(page).innerText(),/10月27日/);await confirm(page).click();await settle(page);
   const midnight=await stored(page);assert.equal(receipts(midnight).length,1);assert.equal(receipts(midnight)[0].day,DAY);assert.equal(midnight.records[DAY].leave,'paid');assert.equal(midnight.records['2026-10-28'],undefined,'midnight cannot redirect a confirmed request to a new day');
   await fixture(page);await select(page,'am').click();await send(page).click();const external=await page.evaluate(()=>{const key=window.PaperConfig.storageKey,s=JSON.parse(localStorage.getItem(key));s.revision++;s.records['2026-10-27'].note='別の画面の更新';const value=JSON.stringify(s);localStorage.setItem(key,value);return value;});
   await confirm(page).click();await settle(page);assert.equal(await raw(page),external,'a stale confirmation cannot overwrite a newer revision');assert.equal(receipts(await stored(page)).length,0);assert.equal(await dialog(page).evaluate(node=>node.open),true);assert.match(await page.locator('#dialogError').innerText(),/更新|保存|再読み込み|確認/);
   await cancel(page);await context.close();console.log('PASS '+entry+' immutable target day across midnight and protected stale confirmations');
  }
  assert.deepEqual(errors,[]);console.log('PASS leave requests in both entries without browser errors or fabricated administrator delivery');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);server.close();process.exitCode=1;});
