"use strict";

const { C } = require("./core.cjs");
const { ApiError } = require("./errors.cjs");
const copy = value => JSON.parse(JSON.stringify(value));

function ownerKey(identity) {
  if (!identity || typeof identity.tenantId !== "string" || !identity.tenantId ||
      typeof identity.employeeId !== "string" || !identity.employeeId) {
    throw new ApiError(401, "unauthorized", "認証情報を確認してください。");
  }
  return JSON.stringify([identity.tenantId, identity.employeeId]);
}

/** Test/development port. It implements the same atomic contract as DynamoDB. */
function createMemoryStore() {
  const employees = new Map();
  const conflict = () => new ApiError(409, "conflict", "別の操作で記録が更新されています。再取得してください。");
  const existing = identity => {
    const entry = employees.get(ownerKey(identity));
    if (!entry) throw new ApiError(404, "profile_not_provisioned", "社員の利用設定が登録されていません。");
    return entry;
  };

  function seed(identity, state, { now = C.clock() } = {}) {
    if (!state || state.mode !== "local") throw new TypeError("A local employee state is required");
    const hydrated = C.hydrate(state, now);
    if (!hydrated) throw new TypeError("Invalid employee state");
    const links = {};
    for (const [day, record] of Object.entries(hydrated.records)) {
      if (record.leave !== "comp" || !C.validDay(record.sourceDay)) continue;
      if (links[record.sourceDay] && links[record.sourceDay] !== day) throw conflict();
      links[record.sourceDay] = day;
    }
    employees.set(ownerKey(identity), { state: copy(hydrated), links, exports: new Map() });
  }

  async function readContext(identity, { start, end, referenceDays = [] }) {
    const entry = employees.get(ownerKey(identity));
    if (!entry) return null;
    const days = new Set(C.dates(start, end));
    for (const day of referenceDays) if (C.validDay(day)) days.add(day);
    // Include source/claimant/dependent days even when they are outside the requested period.
    let expanded;
    do {
      expanded = false;
      const include = day => {
        if (C.validDay(day) && !days.has(day)) { days.add(day); expanded = true; }
      };
      for (const day of days) {
        const record = entry.state.records[day];
        if (record?.leave === "comp") include(record.sourceDay);
      }
      for (const [source, claimant] of Object.entries(entry.links)) {
        if (days.has(source) || days.has(claimant)) { include(source); include(claimant); }
      }
    } while (expanded);
    const records = Object.fromEntries([...days].filter(day => entry.state.records[day]).map(day => [day, entry.state.records[day]]));
    return copy({ revision: entry.state.revision, settings: entry.state.settings,
      defaults: entry.state.defaults, records, links: entry.links });
  }

  async function commit(identity, mutation) {
    const entry = existing(identity);
    if (entry.state.revision !== mutation.expectedRevision) throw conflict();
    const state = copy(entry.state), links = { ...entry.links };
    const changes = mutation.linkChanges || [];
    if (new Set(changes.map(change => change.sourceDay)).size !== changes.length) throw new TypeError("A source link may be changed only once");
    for (const change of changes) {
      if ((links[change.sourceDay] || null) !== change.previousDay) throw conflict();
      if (change.nextDay === null) delete links[change.sourceDay];
      else links[change.sourceDay] = change.nextDay;
    }
    for (const change of mutation.recordChanges || []) {
      if (change.record === null) delete state.records[change.day];
      else state.records[change.day] = copy(change.record);
    }
    if (mutation.settings !== undefined) state.settings = copy(mutation.settings);
    if (mutation.defaults !== undefined) state.defaults = copy(mutation.defaults);
    state.revision++;
    if (!Number.isSafeInteger(state.revision)) throw new ApiError(409, "conflict", "更新番号を確認してください。");
    employees.set(ownerKey(identity), { state, links, exports: entry.exports });
    return state.revision;
  }

  async function commitExport(identity, { expectedRevision, entry: output }) {
    const employee = existing(identity);
    if (employee.state.revision !== expectedRevision || employee.exports.has(output.id)) throw conflict();
    employee.exports.set(output.id, copy(output));
  }

  async function getExport(identity, id) {
    const output = employees.get(ownerKey(identity))?.exports.get(id);
    return output ? copy(output) : null;
  }

  function inspect(identity) {
    const entry = existing(identity);
    return { ...copy(entry.state), links: { ...entry.links }, exports: [...entry.exports.values()].map(copy) };
  }

  return { seed, readContext, commit, commitExport, getExport, inspect };
}

module.exports = { createMemoryStore };
