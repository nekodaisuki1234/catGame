"use strict";

// Load the trusted, checked-in rules unchanged. Request data is never executable.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const window = {};
const context = vm.createContext({ window, Intl, Date });
for (const filename of ["paper-holidays.js", "paper-core.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../../day-designs", filename), "utf8"), context, { filename });
}
const C = window.PaperAttendance;
module.exports = { C, RULES_VERSION: "paper-2026-10-30-local-leave-request-v5" };
