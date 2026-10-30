"use strict";
const {chromium}=require(process.env.PAPER_PLAYWRIGHT_MODULE||"playwright");
const assert=require("node:assert/strict"),http=require("node:http"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,".."),server=http.createServer((req,res)=>{
 const file=path.resolve(root,"."+new URL(req.url,"http://local").pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{res.setHeader("Content-Type",file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":"text/html");res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
const DAY="2026-10-27",ENTRIES=["a-paper.html?screen=1","a-paper-app.html"];
const screenshots=process.env.PAPER_SCREENSHOT_DIR;if(screenshots)fs.mkdirSync(screenshots,{recursive:true});
async function run(){
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.PAPER_CHROMIUM_PATH||(fs.existsSync("/usr/bin/chromium")?"/usr/bin/chromium":undefined),args:["--no-sandbox"]}),errors=[];
 const origin="http://127.0.0.1:"+server.address().port;
 const ready=page=>page.locator("#startPunch").waitFor();
 const stored=page=>page.evaluate(()=>JSON.parse(localStorage.getItem(window.PaperConfig.storageKey)));
 const record=async page=>(await stored(page)).records[DAY];
 const settle=async page=>{await page.waitForFunction(()=>document.querySelector("#previewApp").getAttribute("aria-busy")!=="true");await page.clock.runFor(50);};
 const sendLeave=async page=>{if(!await page.locator('#paperDialog').evaluate(node=>node.open))await page.locator('#leaveForm button[type=submit]').click();await page.locator('[data-action=confirm-leave-request]').click();await settle(page);};
 const tab=(page,panel,editor=false)=>page.locator(editor?"#editorWorkTab-"+panel:"#detailTab-"+panel);
 const leave=(page,value,editor=false)=>page.locator('[data-action="'+(editor?'editor-leave':'home-leave')+'"][data-leave="'+value+'"]');
 const fixture=async(page,complete=false)=>{
  await page.evaluate(({day,complete})=>{
   const C=window.PaperAttendance,config=window.PaperConfig,state=config.mode==='local'?C.createState(C.clock(),{startDay:'2026-10-01'}):C.seed(C.clock());
   const work={...C.empty(state),start:'09:00',end:'18:00',note:'自由入力はそのまま残す',allocation:{P1:6,P2:2,P3:0,P4:0,SET:0},phases:['design','test']};
   state.records={'2026-10-24':work,[day]:complete?work:{...C.empty(state),note:'自由入力はそのまま残す',phases:['design','test']}};state.submissions={};localStorage.setItem(config.storageKey,JSON.stringify(state));
  },{day:DAY,complete});await page.reload();await ready(page);
 };
 const screenshot=async(page,name)=>{if(screenshots){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(screenshots,name+'.png'),fullPage:true});}};
 const geometry=async(page,editor=false)=>{
  for(const width of [320,390,430]){
   await page.setViewportSize({width,height:844});
   if(editor){await tab(page,'phases',true).click();}
   else{
    const bar=page.locator('.detail-tabs');assert.equal(await bar.locator('[role=tab]').count(),4);
    assert.equal(await page.locator('.punch-pane .work-fields').count(),0,'work content must live below the shared tabs');
    const top=await bar.evaluate(node=>node.getBoundingClientRect().top+scrollY);
    for(const id of ['work','summary','leave','allocation']){
     await tab(page,id).click();assert.equal(await page.locator('#detailPanel-'+id).isVisible(),true);
     assert.equal(await page.locator('.home-detail-panel:visible').count(),1);
     assert.equal(await bar.evaluate(node=>node.getBoundingClientRect().top+scrollY),top,'the shared tab bar must not move when switching');
    }
    await tab(page,'work').click();
   }
   const metrics=await page.locator('[role="tab"]:visible,.phase-button:visible,.leave-choice:visible').evaluateAll(nodes=>nodes.map(node=>{
    const r=node.getBoundingClientRect();return {name:node.textContent.trim(),left:r.left,right:r.right,width:r.width,height:r.height,scroll:node.scrollWidth,client:node.clientWidth};
   }));
   for(const m of metrics){assert.ok(m.width>=43.5&&m.height>=43.5,m.name+' needs a 44px tap target');assert.ok(m.left>=-1&&m.right<=width+1,m.name+' overflows the viewport');assert.ok(m.scroll<=m.client+1,m.name+' clips');}
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow at '+width);
  }
  await page.setViewportSize({width:390,height:844});if(editor)await tab(page,'note',true).click();
 };
 try{
  for(const entry of ENTRIES){
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'ja-JP'}),page=await context.newPage();
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>{
    const control=window.__tabsAdapter={calls:0,hold:false};window.PaperRepositoryFactory=options=>{
     const repository=window.PaperRepository.createLocal(options);return {...repository,async save(next,saveOptions){control.calls++;if(control.hold)await new Promise(resolve=>{control.release=resolve;});return repository.save(next,saveOptions);}};
    };
   });
   await page.clock.install({time:new Date('2026-10-27T12:00:00Z')});await page.goto(origin+'/day-designs/'+entry);await ready(page);await fixture(page);
   const original=await stored(page);assert.equal(await tab(page,'summary').getAttribute('aria-selected'),'true');
   assert.equal(await page.locator('.work-fields').isVisible(),false);await geometry(page);assert.deepEqual(await stored(page),original,'viewing tabs must not write attendance');
   assert.equal(await page.locator('#workNote').inputValue(),'自由入力はそのまま残す');
   await tab(page,'work').focus();await page.keyboard.press('ArrowRight');assert.equal(await tab(page,'summary').getAttribute('aria-selected'),'true');
   assert.equal(await tab(page,'summary').evaluate(node=>node===document.activeElement),true);await page.keyboard.press('Home');assert.equal(await tab(page,'work').getAttribute('tabindex'),'0');
   await page.evaluate(()=>window.originalWorkNode=document.querySelector('#workNote'));
   await page.locator('#workNote').fill('タブを切り替えても残るメモ');await tab(page,'summary').click();await settle(page);await tab(page,'work').click();
   await page.locator('[data-action="work-phase"][data-phase="meeting"]').click();await page.clock.runFor(50);await settle(page);
   await tab(page,'leave').click();await tab(page,'work').click();assert.equal(await page.locator('#workNote').inputValue(),'タブを切り替えても残るメモ');
   assert.equal(await page.evaluate(()=>window.originalWorkNode===document.querySelector('#workNote')),true,'switching top-level panels keeps the editor DOM and its draft');
   assert.equal(await page.locator('#homePhaseChoices [aria-pressed=true]').count(),3);
   await screenshot(page,(entry.includes('-app')?'local':'demo')+'-paper-batch23-work');await tab(page,'summary').click();await screenshot(page,(entry.includes('-app')?'local':'demo')+'-paper-batch23-home');
   console.log('PASS '+entry+' top-level work tab, shorter initial screen, keyboard navigation and retained memo/phase input');

   await page.locator('[data-detail="leave"]').click();const beforeLeave=(await stored(page)).revision;
   await leave(page,'am').click();assert.equal((await stored(page)).revision,beforeLeave,'choosing a leave only stages it');await sendLeave(page);assert.equal((await record(page)).leave,'am');assert.equal((await stored(page)).revision,beforeLeave+1,'confirmed send saves exactly one revision');
   assert.equal((await record(page)).note,'タブを切り替えても残るメモ');assert.deepEqual((await record(page)).phases,['design','test','meeting']);
   await leave(page,'paid').click();await sendLeave(page);assert.equal((await record(page)).leave,'paid');assert.equal(await page.locator('#startPunch').isDisabled(),true);
   await page.reload();await ready(page);await page.locator('[data-detail="leave"]').click();assert.equal(await leave(page,'paid').getAttribute('aria-pressed'),'true');
   await leave(page,'').click();await sendLeave(page);assert.equal((await record(page)).leave,'');assert.equal(await page.locator('#startPunch').isDisabled(),false);

   const compRevision=(await stored(page)).revision;await leave(page,'comp').click();await settle(page);
   assert.equal((await stored(page)).revision,compRevision,'a comp day without a source cannot auto-save');assert.equal(await page.locator('#leaveSourceDay').isVisible(),true);
   await page.locator('#leaveSourceDay').selectOption('2026-10-24');await sendLeave(page);
   assert.equal((await record(page)).leave,'comp');assert.equal((await record(page)).sourceDay,'2026-10-24');
   await geometry(page);await tab(page,'leave').click();await screenshot(page,(entry.includes('-app')?'local':'demo')+'-paper-batch23-leave');

   const accepted=await stored(page);await page.evaluate(()=>{window.tabsOriginalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error('quota')};});
   await leave(page,'special').click();await sendLeave(page);assert.deepEqual(await stored(page),accepted);assert.match(await page.locator('#leaveSaveStatus').innerText(),/未保存|未送信|選択中/);await page.locator('#paperDialog [data-action=close-dialog]').last().click();
   await page.locator('[data-detail="summary"]').click();await page.locator('[data-detail="leave"]').click();assert.equal(await leave(page,'special').getAttribute('aria-pressed'),'true');
   await page.evaluate(()=>Storage.prototype.setItem=window.tabsOriginalSetItem);await sendLeave(page);
   assert.equal((await record(page)).leave,'special');assert.equal((await record(page)).sourceDay,'');assert.doesNotMatch(await page.locator('#leaveSaveStatus').innerText(),/未保存|未送信|選択中/);
   console.log('PASS '+entry+' staged leave choices and confirmed request persistence, full-day punch state, explicit comp source and failed-save draft/retry');

   await fixture(page,true);await tab(page,'leave').click();
   const beforeClear=await stored(page);await page.evaluate(()=>{window.clearOriginalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error('quota')};});
   await leave(page,'paid').click();await sendLeave(page);assert.deepEqual(await stored(page),beforeClear,'a rejected leave save cannot clear recorded punches');assert.equal(await page.locator('#startTime').inputValue(),'09:00');
   await page.evaluate(()=>Storage.prototype.setItem=window.clearOriginalSetItem);await sendLeave(page);
   const off=await record(page);assert.equal(off.leave,'paid');assert.equal(off.start,'');assert.equal(off.end,'');assert.equal(off.overnight,false);assert.equal(await page.locator('#startTime').inputValue(),'');assert.equal(await page.locator('#endTime').inputValue(),'');assert.deepEqual(off.allocation,{P1:0,P2:0,P3:0,P4:0,SET:0});
   assert.equal(await page.evaluate(day=>{const C=window.PaperAttendance,s=JSON.parse(localStorage.getItem(window.PaperConfig.storageKey));return C.worked(s.records[day],day,C.clock());},DAY),0);
   await page.locator('#nav-records').click();await page.locator('#recordList [data-day="'+DAY+'"]').click();const beforeEditor=await stored(page);
   assert.match(await page.locator('#editWorked').innerText(),/^0/);assert.equal(await page.locator('#editStart').isDisabled(),true);
   await leave(page,'pm',true).click();assert.deepEqual(await stored(page),beforeEditor,'editor leave remains staged until Update');assert.equal(await page.locator('#editStart').isDisabled(),false);
   assert.equal(await page.locator('#editStart').inputValue(),'');assert.equal(await page.locator('#editEnd').inputValue(),'');await page.locator('#editStart').fill('09:00');await page.locator('#editEnd').fill('18:00');await page.locator('#editEnd').dispatchEvent('change');
   await geometry(page,true);await tab(page,'phases',true).click();await page.locator('[data-action="editor-phase"][data-phase="operations"]').click();
   await tab(page,'note',true).click();await page.locator('#editNote').fill('編集画面でも入力を保持');await screenshot(page,(entry.includes('-app')?'local':'demo')+'-paper-batch23-editor');
   await page.locator('#dayForm button[type=submit]').click();if(await page.locator("[data-action=confirm-leave-request]").count())await page.locator("[data-action=confirm-leave-request]").click();await settle(page);assert.equal((await record(page)).leave,'pm');assert.equal((await record(page)).note,'編集画面でも入力を保持');assert.ok((await record(page)).phases.includes('operations'));assert.equal((await record(page)).allocation.P1,8);
   await fixture(page,true);await page.locator('#nav-records').click();await page.locator('#recordList [data-day="'+DAY+'"]').click();await leave(page,'am',true).click();await page.locator('#dayForm button[type=submit]').click();if(await page.locator("[data-action=confirm-leave-request]").count())await page.locator("[data-action=confirm-leave-request]").click();await settle(page);assert.equal((await record(page)).allocation.P2,2,'half-day leave preserves manual allocations');
   await leave(page,'holiday',true).click();assert.equal(await page.locator('#editStart').inputValue(),'');assert.equal(await page.locator('#editEnd').inputValue(),'');assert.equal(await page.locator('#editOvernight').isChecked(),false);assert.match(await page.locator('#editWorked').innerText(),/^0/);await page.locator('#dayForm button[type=submit]').click();if(await page.locator("[data-action=confirm-leave-request]").count())await page.locator("[data-action=confirm-leave-request]").click();await settle(page);assert.equal((await record(page)).leave,'holiday');assert.equal((await record(page)).allocation.P2,0);

   await fixture(page);await page.locator('[data-detail="leave"]').click();await page.evaluate(()=>window.__tabsAdapter.hold=true);await leave(page,'pm').click();await page.locator('#leaveForm button[type=submit]').click();await page.locator('[data-action=confirm-leave-request]').click();
   await page.waitForFunction(()=>document.querySelector('#previewApp').getAttribute('aria-busy')==='true');
   assert.equal((await record(page)).leave,'');for(const button of await page.locator('[data-action="home-leave"]').all())assert.equal(await button.isDisabled(),true);
   await page.keyboard.press('Escape');await page.locator('#nav-records').click();await page.locator('#nav-home').click();assert.equal(await leave(page,'paid').isDisabled(),true);
   await page.evaluate(()=>window.__tabsAdapter.release());await settle(page);assert.equal((await record(page)).leave,'pm');assert.equal(await leave(page,'paid').isDisabled(),false);
   console.log('PASS '+entry+' zero-hour full leave clears clock times only on accepted saves, staged editor changes and serial pending-save controls');await context.close();
  }
  assert.deepEqual(errors,[]);console.log('PASS tabbed work and leave icons in both entries without browser errors');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);server.close();process.exitCode=1;});
