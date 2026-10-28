"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createDynamoStore } = require("../src/dynamo-store.cjs");
const { createAttendanceService } = require("../src/service.cjs");
const { C } = require("../src/core.cjs");

const OWNER = { tenantId: "tenant-a", employeeId: "employee-a" };
const OTHER = { tenantId: "tenant-b", employeeId: "employee-a" };
const TABLE = "Attendance";
const PK = "T#tenant-a#E#employee-a";
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const commands = Object.fromEntries(["Get", "Query", "BatchGet", "TransactWrite"].map(operation => [operation + "Command", class {
  constructor(input) { this.input = input; this.operation = operation; }
}]));
const errorCode = (status, code) => error => error.status === status && error.code === code;
const dbKey = item => item.PK + "|" + item.SK;

function fixture({ pageSize = 2 } = {}) {
  const items = new Map(), calls = [];
  const control = { batchRetries: 0, mutateRead: false };
  function item(PK, SK, data) { items.set(dbKey({ PK, SK }), { PK, SK, ...copy(data) }); }
  const client = { async send(command) {
    const { operation, input } = command; calls.push({ operation, input: copy(input) });
    if (operation === "Get") return { Item: copy(items.get(dbKey(input.Key))) };
    if (operation === "Query") {
      const values = input.ExpressionAttributeValues;
      const matches = [...items.values()].filter(value => value.PK === values[":pk"] &&
        (values[":prefix"] ? value.SK.startsWith(values[":prefix"]) : value.SK >= values[":start"] && value.SK <= values[":end"]))
        .filter(value => !input.ExclusiveStartKey || value.SK > input.ExclusiveStartKey.SK).sort((a, b) => a.SK.localeCompare(b.SK));
      if (control.mutateRead) { items.get(dbKey({ PK, SK: "REVISION" })).revision++; control.mutateRead = false; }
      return { Items: copy(matches.slice(0, pageSize)), ...(matches.length > pageSize ? { LastEvaluatedKey: { PK: values[":pk"], SK: matches[pageSize - 1].SK } } : {}) };
    }
    if (operation === "BatchGet") {
      const request = input.RequestItems[TABLE];
      if (control.batchRetries > 0) { control.batchRetries--; return { UnprocessedKeys: { [TABLE]: copy(request) } }; }
      return { Responses: { [TABLE]: request.Keys.map(key => items.get(dbKey(key))).filter(Boolean).map(copy) } };
    }
    if (operation === "TransactWrite") {
      const pending = new Map(items);
      for (const request of input.TransactItems) {
        const action = request.Put || request.Update || request.Delete || request.ConditionCheck;
        const key = dbKey(action.Key || action.Item), previous = pending.get(key), condition = action.ConditionExpression;
        const values = action.ExpressionAttributeValues || {};
        if (condition === "attribute_not_exists(PK)" && previous || condition === "attribute_exists(PK)" && !previous ||
            condition === "#revision = :expected" && previous?.revision !== values[":expected"] ||
            condition === "#day = :previous" && previous?.day !== values[":previous"]) {
          throw Object.assign(new Error("Condition failed"), { name: "TransactionCanceledException", CancellationReasons: [{ Code: "ConditionalCheckFailed" }] });
        }
        if (request.Put) pending.set(key, copy(action.Item));
        if (request.Delete) pending.delete(key);
        if (request.Update) {
          const next = copy(previous);
          if (values[":next"] !== undefined) next.revision = values[":next"];
          for (const field of ["settings", "defaults"]) if (values[":" + field] !== undefined) next[field] = copy(values[":" + field]);
          pending.set(key, next);
        }
      }
      items.clear(); for (const [key, value] of pending) items.set(key, value);
      return {};
    }
    throw new Error("Unexpected command " + operation);
  } };
  const store = createDynamoStore({ client, tableName: TABLE, commands, delay: async () => {}, unprocessedRetries: 2 });
  function provision(owner = PK, revision = 0) {
    item(owner, "REVISION", { revision }); item(owner, "CONFIG", { settings: { name: "設定" }, defaults: { breakMinutes: 60 } });
  }
  return { store, items, calls, control, item, provision };
}

test("Dynamo context uses strongly consistent paginated employee queries and loads linked dates beyond the month", async () => {
  const f = fixture(); f.provision();
  for (const day of ["2026-10-01", "2026-10-02", "2026-10-03"]) f.item(PK, "DAY#" + day, { record: { leave: "", note: day } });
  f.item(PK, "DAY#2026-09-26", { record: { leave: "", note: "代休元" } });
  f.item(PK, "DAY#2026-11-02", { record: { leave: "comp", sourceDay: "2026-10-03" } });
  f.item(PK, "COMP#2026-10-03", { day: "2026-11-02" });
  f.item("T#tenant-b#E#employee-a", "DAY#2026-10-01", { record: { note: "秘密" } });
  f.control.batchRetries = 1;
  const value = await f.store.readContext(OWNER, { start: "2026-10-01", end: "2026-10-31", referenceDays: ["2026-09-26"] });
  assert.deepEqual(Object.keys(value.records).sort(), ["2026-09-26", "2026-10-01", "2026-10-02", "2026-10-03", "2026-11-02"]);
  assert.equal(value.records["2026-10-01"].note, "2026-10-01");
  assert.equal(value.links["2026-10-03"], "2026-11-02");
  assert.ok(f.calls.filter(call => call.operation === "Query").length >= 3);
  for (const call of f.calls.filter(call => ["Get", "Query"].includes(call.operation))) assert.equal(call.input.ConsistentRead, true);
  for (const call of f.calls.filter(call => call.operation === "BatchGet")) assert.equal(call.input.RequestItems[TABLE].ConsistentRead, true);
  assert.equal(f.calls.some(call => call.operation === "Scan"), false);
});

test("a revision change during a multi-item read retries the complete consistent context", async () => {
  const f = fixture(); f.provision(); f.control.mutateRead = true;
  const value = await f.store.readContext(OWNER, { start: "2026-10-01", end: "2026-10-02" });
  assert.equal(value.revision, 1);
  assert.equal(f.calls.filter(call => call.operation === "Get" && call.input.Key.SK === "CONFIG").length, 2);
});

test("unprocessed records never silently disappear and date/identity inputs remain bounded", async () => {
  const f = fixture(); f.provision(); f.control.batchRetries = 10;
  await assert.rejects(() => f.store.readContext(OWNER, { start: "2026-10-01", end: "2026-10-01", referenceDays: ["2026-09-26"] }), errorCode(503, "storage_unavailable"));
  await assert.rejects(() => f.store.readContext(OWNER, { start: "2026-01-01", end: "2027-01-02" }), errorCode(400, "invalid_request"));
  await assert.rejects(() => f.store.readContext({ tenantId: "a#E#b", employeeId: "c" }, { start: "2026-10-01", end: "2026-10-01" }), errorCode(401, "unauthorized"));
  assert.equal(await f.store.readContext(OTHER, { start: "2026-10-01", end: "2026-10-01" }), null);
});

test("concurrent day saves use employee revision CAS and do not rewrite CONFIG", async () => {
  const f = fixture(); f.provision();
  const mutate = day => f.store.commit(OWNER, { expectedRevision: 0, recordChanges: [{ day, record: { note: day } }], linkChanges: [] });
  const results = await Promise.allSettled([mutate("2026-10-01"), mutate("2026-10-02")]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.code, "conflict");
  assert.equal(f.items.get(PK + "|REVISION").revision, 1);
  for (const call of f.calls.filter(call => call.operation === "TransactWrite")) {
    assert.equal(call.input.TransactItems.some(item => item.Update?.Key.SK === "CONFIG"), false);
  }
});

test("the source-day lock prevents another comp claim and releases only the expected claimant", async () => {
  const f = fixture(); f.provision();
  await f.store.commit(OWNER, { expectedRevision: 0, recordChanges: [{ day: "2026-10-26", record: { leave: "comp", sourceDay: "2026-10-24" } }],
    linkChanges: [{ sourceDay: "2026-10-24", previousDay: null, nextDay: "2026-10-26" }] });
  await assert.rejects(() => f.store.commit(OWNER, { expectedRevision: 1, recordChanges: [],
    linkChanges: [{ sourceDay: "2026-10-24", previousDay: null, nextDay: "2026-10-27" }] }), errorCode(409, "conflict"));
  await assert.rejects(() => f.store.commit(OWNER, { expectedRevision: 1, recordChanges: [],
    linkChanges: [{ sourceDay: "2026-10-24", previousDay: "2026-10-27", nextDay: null }] }), errorCode(409, "conflict"));
  assert.equal(f.items.get(PK + "|REVISION").revision, 1);
  await f.store.commit(OWNER, { expectedRevision: 1, recordChanges: [{ day: "2026-10-26", record: null }],
    linkChanges: [{ sourceDay: "2026-10-24", previousDay: "2026-10-26", nextDay: null }] });
  assert.equal(f.items.has(PK + "|COMP#2026-10-24"), false);
});

test("config updates retain the revision transaction and duplicate item actions are rejected", async () => {
  const f = fixture(); f.provision();
  await f.store.commit(OWNER, { expectedRevision: 0, settings: { changed: true }, defaults: { breakMinutes: 30 } });
  assert.deepEqual(f.items.get(PK + "|CONFIG").settings, { changed: true });
  assert.equal(f.items.get(PK + "|REVISION").revision, 1);
  await assert.rejects(() => f.store.commit(OWNER, { expectedRevision: 1, recordChanges: [{ day: "2026-10-01", record: {} }, { day: "2026-10-01", record: null }] }), errorCode(400, "invalid_request"));
  assert.equal(f.items.get(PK + "|REVISION").revision, 1);
});

test("export history is immutable, CAS checked and partition scoped without incrementing attendance revision", async () => {
  const f = fixture(); f.provision();
  const entry = { id: "export-1", identity: OWNER, key: "outputs/a.xlsx" };
  await f.store.commitExport(OWNER, { expectedRevision: 0, entry });
  assert.deepEqual(await f.store.getExport(OWNER, "export-1"), entry);
  assert.equal(await f.store.getExport(OTHER, "export-1"), null);
  assert.equal(f.items.get(PK + "|REVISION").revision, 0);
  await assert.rejects(() => f.store.commitExport(OWNER, { expectedRevision: 0, entry }), errorCode(409, "conflict"));
  await assert.rejects(() => f.store.commitExport(OWNER, { expectedRevision: 1, entry: { ...entry, id: "export-2" } }), errorCode(409, "conflict"));
  assert.equal(await f.store.getExport(OWNER, "export-2"), null);
  f.item(PK, "EXPORT#corrupt", { entry: { id: "corrupt", identity: OTHER, key: "outputs/another-employee.xlsx" } });
  await assert.rejects(() => f.store.getExport(OWNER, "corrupt"), errorCode(503, "storage_unavailable"));
});

test("only explicit provisioning creates profile records and never overwrites an existing employee", async () => {
  const f = fixture();
  const config = { settings: { employee: { id: "E1" } }, defaults: { breakMinutes: 60 } };
  assert.equal(await f.store.createProvision(OWNER, config), 0);
  await assert.rejects(() => f.store.createProvision(OWNER, config), errorCode(409, "conflict"));
  assert.equal(f.items.get(PK + "|REVISION").revision, 0);
});

test("the real service and Dynamo adapter save daily records, enforce revision CAS and protect linked holiday work", async () => {
  const f = fixture(), now = { day: "2026-10-28", minutes: 1200, full: "20:00:00" };
  const state = C.createState(now, { startDay: "2026-09-01", employee: { name: "社員", department: "開発", id: "E1" } });
  await f.store.createProvision(OWNER, { settings: state.settings, defaults: state.defaults });
  const service = createAttendanceService({ store: f.store, clock: () => now });
  const source = { ...copy(C.empty(state)), start: "09:00", end: "18:00", note: "休日の保守作業",
    allocation: { P1: 8, P2: 0, P3: 0, P4: 0, SET: 0 } };
  const saved = await service.putDay(OWNER, "2026-10-24", { expectedRevision: 0, record: source });
  assert.equal(saved.revision, 1);
  assert.deepEqual(saved.warnings, []);
  assert.equal((await service.readDays(OWNER, { start: "2026-10-24", end: "2026-10-24" })).records["2026-10-24"].note, source.note);
  await assert.rejects(() => service.putDay(OWNER, "2026-10-24", { expectedRevision: 0, record: source }), errorCode(409, "conflict"));
  const comp = { ...copy(C.empty(state)), leave: "comp", sourceDay: "2026-10-24" };
  const leave = await service.putDay(OWNER, "2026-10-26", { expectedRevision: 1, record: comp });
  assert.equal(leave.revision, 2);
  assert.equal(f.items.get(PK + "|COMP#2026-10-24").day, "2026-10-26");
  await assert.rejects(() => service.deleteDay(OWNER, "2026-10-24", { expectedRevision: 2 }), errorCode(422, "invalid_comp_link"));
  await assert.rejects(() => service.putDay(OWNER, "2026-10-27", { expectedRevision: 2, record: comp }), errorCode(422, "invalid_comp_link"));
  assert.equal(f.items.get(PK + "|REVISION").revision, 2);
  const response = await service.readDays(OWNER, { start: "2026-10-24", end: "2026-10-24" });
  assert.deepEqual(Object.keys(response.records), ["2026-10-24"], "related context must not leak into the requested response range");
});
