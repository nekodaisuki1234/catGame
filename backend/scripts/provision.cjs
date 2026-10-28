"use strict";

// Explicit administrator operation: creates a profile once; never imports browser/demo history.
const fs = require("node:fs");
const { C } = require("../src/core.cjs");
const { createDynamoStore } = require("../src/dynamo-store.cjs");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function profileInput(value, now) {
  const allowed = ["tenantId", "employeeId", "attendanceStartDay", "employee"];
  if (!value || Array.isArray(value) || typeof value !== "object" || Object.keys(value).some(k => !allowed.includes(k)) || allowed.some(k => !Object.hasOwn(value, k)) ||
      !UUID.test(value.tenantId || "") || !UUID.test(value.employeeId || "") || !C.validDay(value.attendanceStartDay) || value.attendanceStartDay > now.day ||
      !value.employee || Object.keys(value.employee).sort().join(",") !== "department,id,name" ||
      ["name", "id"].some(k => typeof value.employee[k] !== "string" || !value.employee[k].trim())) {
    throw new Error("Profile requires tenantId, employeeId (Entra object ID), attendanceStartDay, and employee {name, department, id}.");
  }
  const state = C.createState(now, { startDay: value.attendanceStartDay, employee: value.employee });
  return { identity: { tenantId: value.tenantId.toLowerCase(), employeeId: value.employeeId.toLowerCase() }, settings: state.settings, defaults: state.defaults };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !process.env.ATTENDANCE_TABLE) throw new Error("Usage: ATTENDANCE_TABLE=... npm run provision -- /path/to/profile.json");
  const input = profileInput(JSON.parse(fs.readFileSync(args[0], "utf8")), C.clock());
  if (input.identity.tenantId !== (process.env.ENTRA_TENANT_ID || "").toLowerCase()) throw new Error("Profile tenant must match ENTRA_TENANT_ID.");
  const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
  const store = createDynamoStore({ client: DynamoDBDocumentClient.from(new DynamoDBClient({})), tableName: process.env.ATTENDANCE_TABLE });
  await store.createProvision(input.identity, { settings: input.settings, defaults: input.defaults });
  console.log("Employee profile created. Existing profiles are never overwritten.");
}

if (require.main === module) main().catch(() => { console.error("Employee provisioning failed. Check the input, configured tenant, AWS permissions, and whether the profile already exists."); process.exitCode = 1; });
module.exports = { profileInput };
