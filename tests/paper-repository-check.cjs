"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const window={},context={window,Intl,Date};vm.createContext(context);
for(const name of ["paper-holidays.js","paper-core.js","paper-repository.js"])vm.runInContext(fs.readFileSync(path.join(__dirname,"../day-designs",name),"utf8"),context);
const C=window.PaperAttendance,R=window.PaperRepository,now={day:"2026-10-27",minutes:21*60},key="test-paper-repository";
const plain=value=>JSON.parse(JSON.stringify(value));
const initial=(mode="demo")=>{const state=mode==="local"?C.createState(now):C.seed(now);state.records={};return state;};
class MemoryStorage{
 constructor(raw=null){this.raw=raw;this.reads=0;this.writes=0;this.failRead=false;this.failWrite=false;}
 getItem(requested){assert.equal(requested,key);this.reads++;if(this.failRead)throw new Error("read denied");return this.raw;}
 setItem(requested,value){assert.equal(requested,key);this.writes++;if(this.failWrite)throw new Error("quota exceeded");this.raw=String(value);}
}
class Events{
 constructor(){this.listeners=new Set();}
 addEventListener(type,listener){assert.equal(type,"storage");this.listeners.add(listener);}
 removeEventListener(type,listener){assert.equal(type,"storage");this.listeners.delete(listener);}
 emit(event){for(const listener of this.listeners)listener(event);}
}
const repository=(storage,options={})=>R.createLocal({key,mode:"demo",initialState:()=>initial(options.mode),now:()=>now,storage,...options});
async function rejectsCode(operation,code,pattern){
 await assert.rejects(operation,error=>{
  assert.equal(error.name,"PaperRepositoryError");assert.equal(error.code,code);assert.ok(error instanceof R.RepositoryError);
  if(pattern)assert.match(error.message,pattern);return true;
 });
}
async function main(){
 assert.equal(R.CONTRACT_VERSION,1);
 const missing=new MemoryStorage(),original=initial(),before=JSON.stringify(original);let initialCalls=0;
 const first=repository(missing,{initialState:()=>{initialCalls++;return original;}});
 await rejectsCode(()=>first.save(original,{expectedRevision:0}),"not_ready",/保存できません/);
 await rejectsCode(()=>first.assertCurrent(0),"not_ready");
 const loaded=await first.load();assert.equal(initialCalls,1);assert.equal(missing.writes,0,"loading absent storage must never write defaults");assert.equal(missing.raw,null);
 loaded.revision=999;loaded.defaults.note="caller draft";loaded.settings.projects[0].name="caller project";
 assert.equal(JSON.stringify(original),before,"load must clone the factory state");
 await first.assertCurrent(0);
 const next=C.clone(original);next.revision=123;next.defaults.note="saved note";const nextBefore=JSON.stringify(next);
 const saved=await first.save(next,{expectedRevision:0});assert.equal(saved.revision,1);assert.equal(JSON.stringify(next),nextBefore,"save owns revision changes without mutating its input");
 assert.equal(JSON.parse(missing.raw).revision,1);assert.equal(saved.defaults.note,"saved note");
 saved.revision=900;saved.defaults.note="mutated response";await first.assertCurrent(1);
 await rejectsCode(()=>first.save(next,{expectedRevision:0}),"conflict",/別の画面/);
 await rejectsCode(()=>first.assertCurrent(undefined),"conflict");
 const reloader=repository(missing),reloaded=await reloader.load();assert.equal(reloaded.revision,1);assert.equal(reloaded.defaults.note,"saved note");assert.equal(missing.writes,1,"reload must not rewrite a valid value");
 reloaded.defaults.note="another caller draft";assert.equal(JSON.parse(missing.raw).defaults.note,"saved note");
 const afterReload=await reloader.save(reloaded,{expectedRevision:1});assert.equal(afterReload.revision,2);assert.equal(JSON.parse(missing.raw).defaults.note,"another caller draft");

 // Compare the exact stored token, including same-revision edits and formatting.
 for(const mutate of [
  state=>JSON.stringify({...state,defaults:{...state.defaults,note:"external change"}}),
  state=>JSON.stringify(state,null,2),
  ()=>null
 ]){
  const store=new MemoryStorage(JSON.stringify(initial())),repo=repository(store),state=await repo.load();
  store.raw=mutate(JSON.parse(store.raw));const external=store.raw,unchanged=JSON.stringify(state);
  await rejectsCode(()=>repo.assertCurrent(0),"conflict");await rejectsCode(()=>repo.save(state,{expectedRevision:0}),"conflict");
  assert.equal(store.writes,0);assert.equal(store.raw,external);assert.equal(JSON.stringify(state),unchanged);
 }
 const shared=new MemoryStorage(),tab1=repository(shared),tab2=repository(shared),tabState1=await tab1.load(),tabState2=await tab2.load();
 await tab1.save(tabState1,{expectedRevision:0});await rejectsCode(()=>tab2.save(tabState2,{expectedRevision:0}),"conflict");
 assert.equal(shared.writes,1,"a second tab cannot overwrite the first absent-state save");
 const latest=await tab2.load();assert.equal(latest.revision,1);await tab2.assertCurrent(1);

 // Failed writes preserve input, raw data, and the adapter revision for a retry.
 const failedStore=new MemoryStorage(),failed=repository(failedStore),failedNext=await failed.load();failedNext.defaults.note="retry me";
 const failedBefore=JSON.stringify(failedNext);failedStore.failWrite=true;
 await rejectsCode(()=>failed.save(failedNext,{expectedRevision:0}),"storage_unavailable",/保存できません/);
 assert.equal(failedStore.raw,null);assert.equal(JSON.stringify(failedNext),failedBefore);failedStore.failWrite=false;await failed.assertCurrent(0);
 assert.equal((await failed.save(failedNext,{expectedRevision:0})).revision,1);
 const readStore=new MemoryStorage(),readRepo=repository(readStore);readStore.failRead=true;
 await rejectsCode(()=>readRepo.load(),"storage_unavailable",/保存領域/);assert.equal(readStore.writes,0);
 readStore.failRead=false;const readNext=await readRepo.load();readStore.failRead=true;
 await rejectsCode(()=>readRepo.assertCurrent(0),"storage_unavailable");await rejectsCode(()=>readRepo.save(readNext,{expectedRevision:0}),"storage_unavailable");
 assert.equal(readStore.writes,0);assert.equal(readNext.revision,0);readStore.failRead=false;assert.equal((await readRepo.save(readNext,{expectedRevision:0})).revision,1);

 // The browser Storage accessor is touched only by operations, never at setup.
 let accessorReads=0;
 Object.defineProperty(window,"localStorage",{configurable:true,get(){accessorReads++;throw new Error("blocked accessor");}});
 const blocked=R.createLocal({key,initialState:()=>initial(),now:()=>now});assert.equal(accessorReads,0);
 const stop=blocked.subscribe(()=>{});stop();assert.equal(accessorReads,0);
 await rejectsCode(()=>blocked.load(),"storage_unavailable");assert.equal(accessorReads,1);
 const recoveredStorage=new MemoryStorage();Object.defineProperty(window,"localStorage",{configurable:true,value:recoveredStorage});
 const recovered=await blocked.load();await blocked.save(recovered,{expectedRevision:0});assert.equal(recoveredStorage.writes,1);

 // Corrupt, empty, malformed, and incompatible data stay untouched and never seed.
 for(const raw of ["", "{bad json", "null", "[]", JSON.stringify({...initial(),version:999}),JSON.stringify({...initial(),defaults:{breakMinutes:-1}})]){
  const store=new MemoryStorage(raw);let seeded=0;const repo=repository(store,{initialState:()=>{seeded++;return initial();}});
  await rejectsCode(()=>repo.load(),"invalid_data",/保存データ/);assert.equal(store.raw,raw);assert.equal(store.writes,0);assert.equal(seeded,0);
  await rejectsCode(()=>repo.save(initial(),{expectedRevision:0}),"not_ready");
 }
 const invalidStore=new MemoryStorage(),invalidRepo=repository(invalidStore),invalid=await invalidRepo.load();invalid.defaults.breakMinutes=-1;
 const invalidBefore=JSON.stringify(invalid);await rejectsCode(()=>invalidRepo.save(invalid,{expectedRevision:0}),"invalid_data");
 assert.equal(JSON.stringify(invalid),invalidBefore);assert.equal(invalidStore.raw,null);assert.equal(invalidStore.writes,0);await invalidRepo.assertCurrent(0);
 const cyclic=initial();cyclic.self=cyclic;await rejectsCode(()=>invalidRepo.save(cyclic,{expectedRevision:0}),"invalid_data");assert.equal(invalidStore.writes,0);
 const invalidInitial=new MemoryStorage();await rejectsCode(()=>repository(invalidInitial,{initialState:()=>null}).load(),"invalid_data");assert.equal(invalidInitial.writes,0);

 const legacy=initial();delete legacy.mode;delete legacy.settings.attendanceStartDay;delete legacy.settings.employee;
 const legacyRaw=JSON.stringify(legacy),legacyStore=new MemoryStorage(legacyRaw),legacyRepo=repository(legacyStore),legacyLoaded=await legacyRepo.load();
 assert.equal(legacyLoaded.mode,undefined);assert.equal(legacyStore.raw,legacyRaw);assert.equal(legacyStore.writes,0,"legacy load must not persist a migration");
 assert.equal((await legacyRepo.save(legacyLoaded,{expectedRevision:0})).revision,1);
 for(const [mode,stored] of [["local",initial("demo")],["demo",initial("local")],["local",legacy],["demo",{...initial(),mode:"unknown"}]]){
  const raw=JSON.stringify(stored),store=new MemoryStorage(raw);await rejectsCode(()=>repository(store,{mode}).load(),"invalid_data");assert.equal(store.raw,raw);assert.equal(store.writes,0);
 }
 const localStore=new MemoryStorage(),local=repository(localStore,{mode:"local"}),localState=await local.load();
 assert.equal(localState.mode,"local");assert.equal(Object.keys(localState.records).length,0);assert.equal(localStore.writes,0);assert.equal((await local.save(localState,{expectedRevision:0})).revision,1);
 const demoOnLocal={...C.clone(localState),mode:"demo"};await rejectsCode(()=>local.save(demoOnLocal,{expectedRevision:1}),"invalid_data");assert.equal(localStore.writes,1);
 const wrongInitial=new MemoryStorage();await rejectsCode(()=>repository(wrongInitial,{mode:"local",initialState:()=>initial("demo")}).load(),"invalid_data");assert.equal(wrongInitial.writes,0);

 // Events only announce changes; receiving one does not accept a new revision.
 const events=new Events(),eventStore=new MemoryStorage(),eventRepo=repository(eventStore,{target:events}),eventState=await eventRepo.load(),notifications=[];
 const unsubscribe=eventRepo.subscribe(event=>notifications.push(plain(event)));assert.equal(events.listeners.size,1);
 events.emit({key:"unrelated",newValue:"other"});assert.equal(notifications.length,0);
 eventStore.raw=JSON.stringify({...initial(),revision:5});events.emit({key,newValue:eventStore.raw,oldValue:null});
 assert.equal(notifications.length,1);assert.equal(notifications[0].key,key);assert.equal(eventState.revision,0);
 await rejectsCode(()=>eventRepo.assertCurrent(0),"conflict");await rejectsCode(()=>eventRepo.save(eventState,{expectedRevision:5}),"conflict");assert.equal(eventStore.writes,0);
 eventStore.raw=null;events.emit({key:null,newValue:null,oldValue:null});assert.equal(notifications.length,2);assert.equal(notifications[1].key,null);
 await eventRepo.assertCurrent(0);unsubscribe();unsubscribe();assert.equal(events.listeners.size,0);
 events.emit({key,newValue:"ignored"});assert.equal(notifications.length,2);
 console.log("paper repository checks passed");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
