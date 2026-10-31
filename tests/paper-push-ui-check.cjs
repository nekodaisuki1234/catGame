"use strict";
const {chromium}=require(process.env.PAPER_PLAYWRIGHT_MODULE||"playwright");
const assert=require("node:assert/strict"),http=require("node:http"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,".."),server=http.createServer((req,res)=>{
 const file=path.resolve(root,"."+new URL(req.url,"http://local").pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{res.setHeader("Content-Type",file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":file.endsWith(".webmanifest")?"application/manifest+json":file.endsWith(".png")?"image/png":file.endsWith(".svg")?"image/svg+xml":"text/html");res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
const snapshot=page=>page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)])));
async function run(){
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.PAPER_CHROMIUM_PATH||(fs.existsSync("/usr/bin/chromium")?"/usr/bin/chromium":undefined),args:["--no-sandbox"]});
 try{
  const origin="http://127.0.0.1:"+server.address().port,errors=[];
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:"ja-JP"});
  await context.addInitScript(()=>{
   const state=window.__pushHarness={standalone:false,permission:"default",requests:0,registrations:0,shown:[],hold:false,activeGesture:false};
   Object.defineProperty(navigator,"userAgent",{configurable:true,get:()=>"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"});
   Object.defineProperty(navigator,"standalone",{configurable:true,get:()=>state.standalone});
   function Notification(){}
   Object.defineProperty(Notification,"permission",{get:()=>state.permission});
   Notification.requestPermission=()=>{
    state.requests++;state.activeGesture=navigator.userActivation.isActive;
    if(state.hold)return new Promise(resolve=>{state.release=value=>{state.permission=value;resolve(value);};});
    state.permission="granted";return Promise.resolve("granted");
   };
   Object.defineProperty(window,"Notification",{configurable:true,value:Notification});
   Object.defineProperty(window,"PushManager",{configurable:true,value:function(){}});
   Object.defineProperty(navigator,"serviceWorker",{configurable:true,value:{register:async()=>{state.registrations++;return {active:{state:"activated"},showNotification:async(title,options)=>state.shown.push({title,options})};}}});
  });
  const demo=await context.newPage();demo.on("pageerror",error=>errors.push(error.message));await demo.clock.install({time:new Date("2026-10-27T12:00:00Z")});
  await demo.goto(origin+"/day-designs/a-paper.html?screen=1");await demo.locator("#startPunch").waitFor();
  await demo.evaluate(()=>{
   const C=window.PaperAttendance,now=C.clock();
   localStorage.setItem("day-paper-attendance-v1",JSON.stringify(C.seed(now)));
   localStorage.setItem("day-paper-local-v1",JSON.stringify(C.createState(now)));
   localStorage.setItem("push-unrelated","変更しない");
  });
  const before=await snapshot(demo);await demo.locator("#nav-settings").click();await demo.locator("#pushSettings").waitFor();
  assert.equal(await demo.locator("[data-action=push-test]").count(),0,"fictional demo must not request notification permissions");
  const link=demo.locator("[data-push-local]");assert.equal(await link.getAttribute("target"),"_blank");assert.match(await link.getAttribute("href"),/a-paper-app\.html\?notifications=1/);
  const popup=demo.waitForEvent("popup");await link.click();const page=await popup;page.on("pageerror",error=>errors.push(error.message));await page.clock.install({time:new Date("2026-10-27T12:00:00Z")});
  await page.locator("#pushSettings").waitFor();assert.equal(await page.evaluate(()=>window.PaperConfig.mode),"local");
  assert.equal(await page.locator("#nav-settings").getAttribute("aria-current"),"page");assert.match(await page.locator("#pushHelp").innerText(),/ホーム画面/);
  const button=page.locator("[data-action=push-test]");assert.equal(await button.isDisabled(),true);
  assert.deepEqual(await page.evaluate(()=>({requests:window.__pushHarness.requests,registrations:window.__pushHarness.registrations})),{requests:0,registrations:0});
  assert.deepEqual(await snapshot(page),before,"opening install guidance must preserve demo/local attendance");
  assert.equal(await demo.locator('link[rel="manifest"]').count(),0);assert.match(await page.locator('link[rel="manifest"]').getAttribute("href"),/paper\.webmanifest/);
  await page.evaluate(()=>window.__pushHarness.standalone=true);await page.locator("#nav-home").click();await page.locator("#nav-settings").click();
  assert.equal(await button.isDisabled(),false);
  const rules=page.locator(".push-reminder-rules");await rules.waitFor();
  assert.match(await rules.innerText(),/翌営業日\s+09:00/);assert.match(await rules.innerText(),/15日・月末日（当日）/);assert.match(await rules.innerText(),/期限当日\s+09:00/);
  assert.match(await page.locator("#reminderNext").innerText(),/10月28日.*09:00/);
  await page.clock.setSystemTime(new Date("2026-10-30T09:30:00Z"));await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  assert.match(await page.locator("#reminderNext").innerText(),/11月2日.*09:00/,"Friday after 09:00 previews the next business morning");
  for(const width of [320,390,430]){
   await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"push settings overflow at "+width);
   const box=await button.boundingBox();assert.ok(box.width>=44&&box.height>=44,"manual notification target at "+width);
  }
  await page.setViewportSize({width:390,height:844});
  if(process.env.PAPER_SCREENSHOT_DIR){fs.mkdirSync(process.env.PAPER_SCREENSHOT_DIR,{recursive:true});await page.locator("#pushSettings").screenshot({path:path.join(process.env.PAPER_SCREENSHOT_DIR,"paper-push33-settings.png")});}
  await page.evaluate(()=>window.__pushHarness.hold=true);await button.click();await page.waitForFunction(()=>window.__pushHarness.requests===1);
  assert.equal(await page.locator("#pushSettings").getAttribute("aria-busy"),"true");assert.equal(await button.isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.__pushHarness.activeGesture),true,"permission must start directly inside a user gesture");
  assert.equal(await page.evaluate(()=>window.__pushHarness.registrations),0,"registration must wait for accepted permission");assert.deepEqual(await snapshot(page),before);
  await page.evaluate(()=>window.__pushHarness.release("granted"));await page.waitForFunction(()=>window.__pushHarness.shown.length===1);
  await page.waitForFunction(()=>document.querySelector("#pushSettings").getAttribute("aria-busy")==="false");
  assert.equal(await button.isDisabled(),false);assert.match(await page.locator("#pushStatus").innerText(),/許可/);assert.match(await page.locator("#pushSettings").innerText(),/自動通知.*準備中/);
  assert.match(await page.locator("#studyToast").innerText(),/テスト|通知/);assert.deepEqual(await snapshot(page),before,"a real permission result and notification test cannot write attendance");
  await page.evaluate(()=>window.__pushHarness.permission="denied");await page.locator("#nav-home").click();await page.locator("#nav-settings").click();assert.equal(await button.isDisabled(),true);assert.match(await page.locator("#pushStatus").innerText(),/許可なし|許可されて/);
  assert.deepEqual(await snapshot(page),before);assert.deepEqual(errors,[]);
  console.log("PASS iPhone install guidance, local-only notification test, explicit permission gesture, pending controls, denied handling, unchanged attendance and mobile layout");
  await context.close();
 }finally{await browser.close();}
}
run().then(()=>server.close(),error=>{console.error(error);server.close();process.exitCode=1;});
