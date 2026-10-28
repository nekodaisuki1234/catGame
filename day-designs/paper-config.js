(function(global){
"use strict";
const C=global.PaperAttendance;
if(!C)return;
// The entry document selects the dataset. Query strings never change its scope.
const mode=global.document.documentElement.dataset.appMode==="local"?"local":"demo";
global.PaperConfig=Object.freeze({
 mode,
 storageKey:mode==="local"?"day-paper-local-v1":C.KEY,
 initialState(now){return mode==="local"?C.createState(now):C.seed(now);}
});
})(typeof window!=="undefined"?window:globalThis);
