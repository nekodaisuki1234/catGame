"use strict";
const {chromium}=require(process.env.PAPER_PLAYWRIGHT_MODULE||"playwright");
const assert=require("node:assert/strict"),http=require("node:http"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,".."),server=http.createServer((req,res)=>{
 const file=path.resolve(root,"."+new URL(req.url,"http://local").pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{res.setHeader("Content-Type",file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":"text/html");res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
const screenshotDir=process.env.PAPER_SCREENSHOT_DIR;
const snapshot=page=>page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)])));
async function run(){
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.PAPER_CHROMIUM_PATH||(fs.existsSync("/usr/bin/chromium")?"/usr/bin/chromium":undefined),args:["--no-sandbox"]});
 try{
  const origin="http://127.0.0.1:"+server.address().port,errors=[],external=[];
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:"ja-JP",reducedMotion:"reduce"});let page=await context.newPage();
  page.on("pageerror",error=>errors.push(error.message));
  await context.route("**/*",route=>{
   if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}
   return route.continue();
  });
  await page.clock.install({time:new Date("2026-10-27T12:00:00Z")});
  await page.goto(origin+"/day-designs/a-paper.html?screen=1");await page.locator("#startPunch").waitFor();
  await page.evaluate(()=>{
   const C=window.PaperAttendance,now=C.clock(),demo=C.seed(now),local=C.createState(now,{startDay:"2026-10-01"});
   demo.revision=17;local.revision=29;local.settings.employee={name:"保存済みの社員",department:"確認用",id:"LOCAL-29"};
   localStorage.setItem("day-paper-attendance-v1",JSON.stringify(demo));
   localStorage.setItem("day-paper-local-v1",JSON.stringify(local));
   localStorage.setItem("login-test-unrelated","そのまま残す");
  });
  await page.reload();await page.locator("#startPunch").waitFor();
  const before=await snapshot(page);
  await page.locator("#nav-settings").click();
  const preview=page.locator("a.login-preview-link");assert.match(await preview.getAttribute("href"),/a-paper-login\.html/);
  assert.equal(await preview.getAttribute("target"),"_blank");
  const app=page,popup=page.waitForEvent("popup");await preview.click();page=await popup;
  page.on("pageerror",error=>errors.push(error.message));await page.clock.install({time:new Date("2026-10-27T12:00:00Z")});
  await page.locator("#microsoftLogin").waitFor();
  assert.equal(await app.locator("#nav-settings").getAttribute("aria-current"),"page","preview discovery must preserve the existing settings screen");
  assert.match(new URL(page.url()).pathname,/\/a-paper-login\.html$/);
  assert.equal(await page.locator("input,textarea").count(),0,"a mock must not collect credentials");
  assert.match(await page.locator("#loginPreview").innerText(),/プレビュー|モック|未接続|接続/);
  assert.deepEqual(await snapshot(page),before,"opening the login preview must preserve both app stores and unrelated data");
  assert.equal(await page.evaluate(()=>window.PaperAttendance||window.PaperConfig||null),null,"the standalone mock must not boot or impersonate an authenticated app");

  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:430,height:844},{width:1280,height:900}]){
   await page.setViewportSize(viewport);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"login overflow at "+viewport.width);
   for(const selector of ["#microsoftLogin","#loginDemo"]){
    const box=await page.locator(selector).boundingBox();assert.ok(box.width>=44&&box.height>=44,selector+" touch target at "+viewport.width);
    assert.ok(box.x>=-1&&box.x+box.width<=viewport.width+1,selector+" inside viewport at "+viewport.width);
   }
   if(screenshotDir&&(viewport.width===390||viewport.width===1280)){
    fs.mkdirSync(screenshotDir,{recursive:true});await page.screenshot({path:path.join(screenshotDir,"paper-login29-"+viewport.width+".png"),fullPage:true});
   }
  }
  await page.setViewportSize({width:390,height:844});
  const login=page.locator("#microsoftLogin"),box=await login.boundingBox(),url=page.url();
  await login.click();assert.match(await page.locator("#loginToast").innerText(),/未接続|準備中|接続されていません/);
  assert.equal(await page.locator("#loginToast").getAttribute("role"),"status");
  assert.equal(page.url(),url,"mock sign-in must not claim a completed login or redirect to a pretend account");
  assert.deepEqual(await login.boundingBox(),box,"login feedback must not move the action or page layout");
  await page.clock.runFor(6100);await login.focus();await page.keyboard.press("Enter");
  assert.equal(await page.locator("#loginToast").getAttribute("data-visible"),"true");
  await page.clock.runFor(6100);await page.keyboard.press("Space");
  assert.equal(await page.locator("#loginToast").getAttribute("data-visible"),"true");
  assert.deepEqual(await snapshot(page),before,"clicking or keyboard-activating the mock cannot create sessions or alter attendance");
  assert.deepEqual(external,[],"the mock must not call authentication services or any external host");
  console.log("PASS login preview discovery, credential-free mock, untouched demo/local records, accessible unconnected feedback and mobile/desktop layout");

  await page.locator("#loginDemo").click();await page.locator("#startPunch").waitFor();
  assert.equal(new URL(page.url()).pathname,"/day-designs/a-paper.html");
  assert.equal(await page.locator("html").getAttribute("data-app-mode"),"demo");
  assert.equal(await page.evaluate(()=>window.PaperConfig.mode),"demo");
  assert.deepEqual(await snapshot(page),before,"opening the explicit demo must not create an auth session or rewrite existing records");
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log("PASS explicit demo navigation retains demo mode and all previously saved data without browser errors");
  await context.close();
 }finally{await browser.close();}
}
run().then(()=>server.close(),error=>{console.error(error);server.close();process.exitCode=1});
