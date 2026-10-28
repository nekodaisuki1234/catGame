(function(global){
"use strict";
const CONTRACT_VERSION=1;
const messages={
 conflict:"別の画面で記録が更新されています。再読み込みしてから操作してください。",
 invalid_data:"保存データを読み込めません。元のデータを保護しているため、保存を停止しています。",
 not_ready:"保存できません。先に保存データを読み込んでから再操作してください。"
};
class RepositoryError extends Error{
 constructor(code,message,cause){
  super(message||messages[code]||"保存できませんでした。");
  this.name="PaperRepositoryError";this.code=code;
  if(cause!==undefined)this.cause=cause;
 }
}
/**
 * Async storage port. A future remote adapter can expose the same four methods.
 * load never persists defaults; save owns revision changes and returns a copy.
 * Subscribers announce external changes; callers choose when to reload them.
 */
function createLocal(options={}){
 const {key,mode="demo",initialState,now}=options;
 if(typeof key!=="string"||!key||!["demo","local"].includes(mode)||typeof initialState!=="function"||now!==undefined&&typeof now!=="function")throw new RepositoryError("invalid_data");
 let snapshot=null,token=null;
 const core=()=>{
  const value=global.PaperAttendance;
  if(!value||typeof value.hydrate!=="function"||typeof value.clone!=="function")throw new RepositoryError("not_ready");
  return value;
 };
 const storage=operation=>{
  try{
   const value=options.storage===undefined?global.localStorage:options.storage;
   if(!value||typeof value.getItem!=="function"||typeof value.setItem!=="function")throw new Error("Storage is unavailable");
   return value;
  }catch(cause){throw unavailable(operation,cause);}
 };
 const unavailable=(operation,cause)=>new RepositoryError("storage_unavailable",operation==="load"?"保存領域を読み込めません。ブラウザの保存設定を確認してください。":"保存できませんでした。記録は変更していません。保存設定を確認して再操作してください。",cause);
 const read=(store,operation)=>{
  try{return store.getItem(key);}catch(cause){throw unavailable(operation,cause);}
 };
 const matchesMode=state=>state&&(state.mode===mode||mode==="demo"&&state.mode===undefined);
 const validate=value=>{
  try{
   const C=core(),candidate=C.clone(value);
   if(!matchesMode(candidate))throw new RepositoryError("invalid_data");
   const hydrated=C.hydrate(candidate,now?now():C.clock());
   if(!hydrated||!matchesMode(hydrated))throw new RepositoryError("invalid_data");
   return C.clone(hydrated);
  }catch(cause){
   if(cause instanceof RepositoryError)throw cause;
   throw new RepositoryError("invalid_data",undefined,cause);
  }
 };
 const ready=expectedRevision=>{
  if(!snapshot)throw new RepositoryError("not_ready");
  if(!Number.isInteger(expectedRevision)||expectedRevision!==snapshot.revision)throw new RepositoryError("conflict");
 };
 async function load(){
  const raw=read(storage("load"),"load");
  let candidate;
  try{candidate=raw===null?initialState():JSON.parse(raw);}catch(cause){throw new RepositoryError("invalid_data",undefined,cause);}
  const loaded=validate(candidate);
  snapshot=loaded;token=raw;
  return core().clone(loaded);
 }
 async function assertCurrent(expectedRevision){
  ready(expectedRevision);
  if(read(storage("save"),"save")!==token)throw new RepositoryError("conflict");
 }
 async function save(next,{expectedRevision}={}){
  ready(expectedRevision);
  const store=storage("save");
  if(read(store,"save")!==token)throw new RepositoryError("conflict");
  let candidate;
  try{
   candidate=core().clone(next);
   candidate.revision=snapshot.revision+1;
   if(!Number.isSafeInteger(candidate.revision))throw new RepositoryError("invalid_data");
  }catch(cause){
   if(cause instanceof RepositoryError)throw cause;
   throw new RepositoryError("invalid_data",undefined,cause);
  }
  const saved=validate(candidate);
  let text;
  try{text=JSON.stringify(saved);}catch(cause){throw new RepositoryError("invalid_data",undefined,cause);}
  try{store.setItem(key,text);}catch(cause){throw unavailable("save",cause);}
  snapshot=saved;token=text;
  return core().clone(saved);
 }
 function subscribe(listener){
  if(typeof listener!=="function")throw new TypeError("A storage listener is required");
  const target=options.target===undefined?global:options.target;
  if(!target||typeof target.addEventListener!=="function"||typeof target.removeEventListener!=="function")return ()=>{};
  const onStorage=event=>{
   if(event.key===key||event.key===null)listener({key:event.key,newValue:event.newValue??null,oldValue:event.oldValue??null});
  };
  target.addEventListener("storage",onStorage);
  let active=true;
  return ()=>{if(active){active=false;target.removeEventListener("storage",onStorage);}};
 }
 return {load,save,assertCurrent,subscribe};
}
global.PaperRepository={CONTRACT_VERSION,RepositoryError,createLocal};
})(window);
