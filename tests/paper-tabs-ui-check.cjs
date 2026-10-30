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
 const tab=(page,panel,editor=false)=>page.locator("#"+(editor?"editor":"home")+"WorkTab-"+panel);
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
   await page.setViewportSize({width,height:844});await tab(page,'note',editor).click();
   const prefix=editor?'editor':'home',card=editor?'.work-content-tabs[data-work-context=editor]':'.work-fields';
   const before=await page.locator(card).evaluate(node=>node.getBoundingClientRect().height);
   await tab(page,'phases',editor).click();assert.equal(await page.locator('#'+prefix+'WorkPanel-note').isVisible(),false);assert.equal(await page.locator('#'+prefix+'WorkPanel-phases').isVisible(),true);
   const after=await page.locator(card).evaluate(node=>node.getBoundingClientRect().height);
   assert.ok(Math.abs(before-after)<=1,'switching work tabs must not move the sections below at '+width);
   const metrics=await page.locator('[role="tab"]:visible,.phase-button:visible,.leave-choice:visible').evaluateAll(nodes=>nodes.map(node=>{
    const r=node.getBoundingClientRect();return {name:node.textContent.trim(),left:r.left,right:r.right,width:r.width,height:r.height,scroll:node.scrollWidth,client:node.clientWidth};
   }));
   for(const m of metrics){assert.ok(m.width>=43.5&&m.height>=43.5,m.name+' needs a 44px tap target');assert.ok(m.left>=-1&&m.right<=width+1,m.name+' overflows the viewport');assert.ok(m.scroll<=m.client+1,m.name+' clips');}
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow at '+width);
   await tab(page,'note',editor).click();
  }
  await page.setViewportSize({width:390,height:844});
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
   const original=await stored(page);assert.equal(await tab(page,'note').getAttribute('aria-selected'),'true');
   await geometry(page);assert.deepEqual(await stored(page),original,'viewing tabs must not write attendance');
   assert.equal(await page.locator('#workNote').inputValue(),'自由入力はそのまま残す');assert.equal(await tab(page,'phases').locator('.phase-count').innerText(),'2');
   await tab(page,'note').focus();await page.keyboard.press('ArrowRight');assert.equal(await tab(page,'phases').getAttribute('aria-selected'),'true');
   assert.equal(await tab(page,'phases').evaluate(node=>node===document.activeElement),true);await page.keyboard.press('Home');assert.equal(await tab(page,'note').getAttribute('tabindex'),'0');
   await page.locator('#workNote').fill('タブを切り替えても残るメモ');await tab(page,'phases').click();await settle(page);
   await page.locator('[data-action="work-phase"][data-phase="meeting"]').click();await page.clock.runFor(50);await settle(page);
   await tab(page,'note').click();assert.equal(await page.locator('#workNote').inputValue(),'タブを切り替えても残るメモ');assert.equal(await tab(page,'phases').locator('.phase-count').innerText(),'3');
   await screenshot(page,(entry.includes('-app')?'local':'demo')+'-paper-tabs-home');
   console.log('PASS '+entry+' compact, stable mobile tabs, keyboard switching, selection count and retained free memo');

   await page.locator('[data-detail="leave"]').click();const beforeLeave=(await stored(page)).revision;
   await leave(page,'am').click();await settle(page);assert.equal((await record(page)).leave,'am');assert.equal((await stored(page)).revision,beforeLeave+1,'one tap saves exactly one revision');
   assert.equal((await record(page)).note,'タブを切り替えても残るメモ');assert.deepEqual((await record(page)).phases,['design','test','meeting']);
   await leave(page,'paid').click();await settle(page);assert.equal((await record(page)).leave,'paid');assert.equal(await page.locator('#startPunch').isDisabled(),true);
   await page.reload();await ready(page);await page.locator('[data-detail="leave"]').click();assert.equal(await leave(page,'paid').getAttribute('aria-pressed'),'true');
   await leave(page,'').click();await settle(page);assert.equal((await record(page)).leave,'');assert.equal(await page.locator('#startPunch').isDisabled(),false);

   const compRevision=(await stored(page)).revision;await leave(page,'comp').click();await settle(page);
   assert.equal((await stored(page)).revision,compRevision,'a comp day without a source cannot auto-save');assert.equal(await page.locator('#leaveSourceDay').isVisible(),true);
   await page.locator('#leaveSourceDay').selectOption('2026-10-24');await page.locator('#leaveForm button[type=submit]').click();await settle(page);
   assert.equal((await record(page)).leave,'comp');assert.equal((await record(page)).sourceDay,'2026-10-24');
   await geometry(page);await screenshot(page,(entry.includes('-app')?'local':'demo')+'-paper-tabs-leave');

   const accepted=await stored(page);await page.evaluate(()=>{window.tabsOriginalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error('quota')};});
   await leave(page,'special').click();await settle(page);assert.deepEqual(await stored(page),accepted);assert.match(await page.locator('#leaveSaveStatus').innerText(),/未保存/);
   await page.locator('[data-detail="summary"]').click();await page.locator('[data-detail="leave"]').click();assert.equal(await leave(page,'special').getAttribute('aria-pressed'),'true');
   await page.evaluate(()=>Storage.prototype.setItem=window.tabsOriginalSetItem);await page.locator('#leaveForm button[type=submit]').click();await settle(page);
   assert.equal((await record(page)).leave,'special');assert.equal((await record(page)).sourceDay,'');assert.doesNotMatch(await page.locator('#leaveSaveStatus').innerText(),/未保存/);
   console.log('PASS '+entry+' one-tap leave persistence, full-day punch state, explicit comp source and failed-save draft/retry');

   await fixture(page,true);await page.locator('[data-detail="leave"]').click();const worked=await stored(page),height=await page.locator('#leaveForm').evaluate(node=>node.getBoundingClientRect().height);
   await leave(page,'paid').click();await settle(page);assert.deepEqual(await stored(page),worked,'full leave must not erase existing punches');assert.equal(await page.locator('#previewError').innerText(),'');
   assert.match(await page.locator('#studyToast').innerText(),/保存できません/);assert.equal(await page.locator('#studyToast').evaluate(node=>node.classList.contains('is-warning')),true);
   assert.equal(await page.locator('#leaveForm').evaluate(node=>node.getBoundingClientRect().height),height,'a validation toast must not move the form');
   await page.locator('#nav-records').click();await page.locator('#recordList [data-day="'+DAY+'"]').click();const beforeEditor=await stored(page);
   await leave(page,'pm',true).click();assert.deepEqual(await stored(page),beforeEditor,'editor leave remains staged until Update');
   await geometry(page,true);await tab(page,'phases',true).click();await page.locator('[data-action="editor-phase"][data-phase="operations"]').click();
   await tab(page,'note',true).click();await page.locator('#editNote').fill('編集画面でも入力を保持');await screenshot(page,(entry.includes('-app')?'local':'demo')+'-paper-tabs-editor');
   await page.locator('#dayForm button[type=submit]').click();await settle(page);assert.equal((await record(page)).leave,'pm');assert.equal((await record(page)).note,'編集画面でも入力を保持');assert.ok((await record(page)).phases.includes('operations'));assert.equal((await record(page)).allocation.P2,2);

   await fixture(page);await page.locator('[data-detail="leave"]').click();await page.evaluate(()=>window.__tabsAdapter.hold=true);await leave(page,'pm').click();
   await page.waitForFunction(()=>document.querySelector('#previewApp').getAttribute('aria-busy')==='true');
   assert.equal((await record(page)).leave,'');for(const button of await page.locator('[data-action="home-leave"]').all())assert.equal(await button.isDisabled(),true);
   await page.locator('#nav-records').click();await page.locator('#nav-home').click();assert.equal(await leave(page,'paid').isDisabled(),true);
   await page.evaluate(()=>window.__tabsAdapter.release());await settle(page);assert.equal((await record(page)).leave,'pm');assert.equal(await leave(page,'paid').isDisabled(),false);
   console.log('PASS '+entry+' existing-work validation toast, staged editor changes and serial pending-save controls');await context.close();
  }
  assert.deepEqual(errors,[]);console.log('PASS tabbed work and leave icons in both entries without browser errors');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);server.close();process.exitCode=1;});
