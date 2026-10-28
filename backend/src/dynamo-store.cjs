"use strict";

const { ApiError } = require("./errors.cjs");

const copy = value => JSON.parse(JSON.stringify(value));
const DAY_MS = 86400000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const invalid = message => new ApiError(400, "invalid_request", message);
const unavailable = () => new ApiError(503, "storage_unavailable", "保存データを確認できません。時間をおいて再度お試しください。");
const conflict = () => new ApiError(409, "conflict", "別の操作で記録が更新されています。再取得してください。");

function validDay(day) {
  return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(day + "T00:00:00Z")) && new Date(day + "T00:00:00Z").toISOString().slice(0, 10) === day;
}
function owner(identity) {
  if (!identity || !SAFE_ID.test(identity.tenantId || "") || !SAFE_ID.test(identity.employeeId || "")) {
    throw new ApiError(401, "unauthorized", "認証情報を確認してください。");
  }
  return "T#" + identity.tenantId + "#E#" + identity.employeeId;
}
function validRevision(value) { return Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER; }
function conditionFailure(error) {
  if (error?.name === "ConditionalCheckFailedException") return true;
  return error?.name === "TransactionCanceledException" &&
    (error.CancellationReasons || []).some(reason => reason.Code === "ConditionalCheckFailed" || reason.Code === "TransactionConflict");
}

/** A partition per verified tenant/employee; never scans the table. */
function createDynamoStore({ client, tableName, commands, readRetries = 3, unprocessedRetries = 4,
  delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!client || typeof client.send !== "function" || typeof tableName !== "string" || !tableName) throw new TypeError("DynamoDB client and tableName are required");
  const constructors = () => commands || require("@aws-sdk/lib-dynamodb");
  const send = (operation, input) => client.send(new (constructors()[operation + "Command"])(input));
  const key = (PK, SK) => ({ PK, SK });

  async function get(PK, SK) {
    return (await send("Get", { TableName: tableName, Key: key(PK, SK), ConsistentRead: true })).Item;
  }
  async function query(PK, condition, values) {
    const items = [];
    let ExclusiveStartKey;
    const cursors = new Set();
    do {
      const response = await send("Query", { TableName: tableName, ConsistentRead: true,
        KeyConditionExpression: "PK = :pk AND " + condition,
        ExpressionAttributeValues: { ":pk": PK, ...values }, ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}) });
      if (response.Items) items.push(...response.Items);
      if (items.length > 10000) throw unavailable();
      ExclusiveStartKey = response.LastEvaluatedKey;
      if (ExclusiveStartKey) {
        const cursor = JSON.stringify(ExclusiveStartKey);
        if (cursors.has(cursor) || cursors.size >= 100) throw unavailable();
        cursors.add(cursor);
      }
    } while (ExclusiveStartKey);
    return items;
  }
  async function batch(PK, days) {
    const items = [];
    for (let offset = 0; offset < days.length; offset += 100) {
      let request = { [tableName]: { Keys: days.slice(offset, offset + 100).map(day => key(PK, "DAY#" + day)), ConsistentRead: true } };
      for (let attempt = 0; ; attempt++) {
        const response = await send("BatchGet", { RequestItems: request });
        items.push(...(response.Responses?.[tableName] || []));
        const pending = response.UnprocessedKeys?.[tableName];
        if (!pending?.Keys?.length) break;
        if (attempt >= unprocessedRetries) throw unavailable();
        request = { [tableName]: { ...pending, ConsistentRead: true } };
        await delay(Math.min(25 * 2 ** attempt, 400));
      }
    }
    return items;
  }
  function recordItem(item, PK) {
    const day = item?.SK?.slice(4);
    if (item?.PK !== PK || !item.SK.startsWith("DAY#") || !validDay(day) ||
        !item.record || typeof item.record !== "object" || Array.isArray(item.record)) throw unavailable();
    return [day, item.record];
  }

  async function readContext(identity, { start, end, referenceDays = [] }) {
    const PK = owner(identity);
    if (!validDay(start) || !validDay(end) || start > end || (Date.parse(end) - Date.parse(start)) / DAY_MS >= 366 ||
        !Array.isArray(referenceDays) || referenceDays.length > 366 || referenceDays.some(day => !validDay(day))) throw invalid("対象期間は366日以内で指定してください。");
    for (let attempt = 0; attempt < readRetries; attempt++) {
      const before = await get(PK, "REVISION");
      const config = await get(PK, "CONFIG");
      if (!before && !config) return null;
      if (!before || !config || !validRevision(before.revision) || !config.settings || !config.defaults) throw unavailable();
      const [dayItems, linkItems] = await Promise.all([
        query(PK, "SK BETWEEN :start AND :end", { ":start": "DAY#" + start, ":end": "DAY#" + end }),
        query(PK, "begins_with(SK, :prefix)", { ":prefix": "COMP#" })
      ]);
      const records = {};
      for (const item of dayItems) {
        const [day, record] = recordItem(item, PK);
        if (day < start || day > end) throw unavailable();
        records[day] = record;
      }
      const links = {};
      for (const item of linkItems) {
        const sourceDay = item?.SK?.slice(5), claimantDay = item?.day;
        if (item?.PK !== PK || !item.SK.startsWith("COMP#") || !validDay(sourceDay) || !validDay(claimantDay)) throw unavailable();
        links[sourceDay] = claimantDay;
      }
      const selected = new Set(referenceDays), fetched = new Set();
      for (let instant = Date.parse(start); instant <= Date.parse(end); instant += DAY_MS) {
        const day = new Date(instant).toISOString().slice(0, 10); selected.add(day); fetched.add(day);
      }
      // Include a linked source and its claimant even if either lies outside the requested month.
      for (;;) {
        for (const day of selected) {
          const record = records[day];
          if (record?.leave === "comp" && validDay(record.sourceDay)) selected.add(record.sourceDay);
        }
        for (const [sourceDay, claimantDay] of Object.entries(links)) {
          if (selected.has(sourceDay) || selected.has(claimantDay)) { selected.add(sourceDay); selected.add(claimantDay); }
        }
        if (selected.size > 10000) throw unavailable();
        const missing = [...selected].filter(day => !fetched.has(day));
        if (!missing.length) break;
        for (const day of missing) fetched.add(day);
        for (const item of await batch(PK, missing)) {
          const [day, record] = recordItem(item, PK);
          if (!selected.has(day)) throw unavailable();
          records[day] = record;
        }
      }
      const after = await get(PK, "REVISION");
      if (after?.revision === before.revision) return copy({ revision: before.revision,
        settings: config.settings, defaults: config.defaults, records, links });
    }
    throw conflict();
  }

  async function transaction(items) {
    if (items.length > 100) throw invalid("一度に更新する件数が多すぎます。");
    const keys = items.map(item => {
      const action = item.Put || item.Update || item.Delete || item.ConditionCheck;
      return JSON.stringify(action.Key || { PK: action.Item.PK, SK: action.Item.SK });
    });
    if (new Set(keys).size !== keys.length) throw invalid("同じ記録を一度に複数回変更できません。");
    try { await send("TransactWrite", { TransactItems: items }); }
    catch (error) { if (conditionFailure(error)) throw conflict(); throw error; }
  }

  async function commit(identity, mutation) {
    const PK = owner(identity), expected = mutation?.expectedRevision;
    if (!validRevision(expected) || !Array.isArray(mutation.recordChanges || []) || !Array.isArray(mutation.linkChanges || [])) throw invalid("更新番号と変更内容を確認してください。");
    const items = [{ Update: { TableName: tableName, Key: key(PK, "REVISION"),
      UpdateExpression: "SET #revision = :next", ConditionExpression: "#revision = :expected",
      ExpressionAttributeNames: { "#revision": "revision" }, ExpressionAttributeValues: { ":next": expected + 1, ":expected": expected } } }];
    for (const change of mutation.recordChanges || []) {
      if (!validDay(change.day) || change.record !== null && (!change.record || typeof change.record !== "object" || Array.isArray(change.record))) throw invalid("変更する記録を確認してください。");
      items.push(change.record === null ? { Delete: { TableName: tableName, Key: key(PK, "DAY#" + change.day) } } :
        { Put: { TableName: tableName, Item: { ...key(PK, "DAY#" + change.day), record: copy(change.record) } } });
    }
    if (mutation.settings !== undefined || mutation.defaults !== undefined) {
      const fields = ["settings", "defaults"].filter(field => mutation[field] !== undefined);
      items.push({ Update: { TableName: tableName, Key: key(PK, "CONFIG"),
        UpdateExpression: "SET " + fields.map(field => "#" + field + " = :" + field).join(", "),
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeNames: Object.fromEntries(fields.map(field => ["#" + field, field])),
        ExpressionAttributeValues: Object.fromEntries(fields.map(field => [":" + field, copy(mutation[field])])) } });
    }
    for (const change of mutation.linkChanges || []) {
      if (!validDay(change.sourceDay) || change.previousDay !== null && !validDay(change.previousDay) || change.nextDay !== null && !validDay(change.nextDay) || change.previousDay === change.nextDay) throw invalid("代休の紐付けを確認してください。");
      const linkKey = key(PK, "COMP#" + change.sourceDay), condition = change.previousDay === null ? "attribute_not_exists(PK)" : "#day = :previous";
      const attributes = change.previousDay === null ? {} : { ExpressionAttributeNames: { "#day": "day" }, ExpressionAttributeValues: { ":previous": change.previousDay } };
      items.push(change.nextDay === null ? { Delete: { TableName: tableName, Key: linkKey,
        ConditionExpression: condition, ...attributes } } : { Put: { TableName: tableName,
        Item: { ...linkKey, day: change.nextDay }, ConditionExpression: condition, ...attributes } });
    }
    await transaction(items);
    return expected + 1;
  }

  async function getExport(identity, id) {
    const PK = owner(identity);
    if (!SAFE_ID.test(id || "")) throw invalid("出力番号を確認してください。");
    const item = await get(PK, "EXPORT#" + id);
    if (!item) return null;
    if (!item.entry || item.entry.id !== id || !item.entry.identity ||
        item.entry.identity.tenantId !== identity.tenantId || item.entry.identity.employeeId !== identity.employeeId) throw unavailable();
    return copy(item.entry);
  }
  async function commitExport(identity, { expectedRevision, entry }) {
    const PK = owner(identity);
    if (!validRevision(expectedRevision) || !SAFE_ID.test(entry?.id || "") || owner(entry.identity) !== PK) throw invalid("出力履歴を確認してください。");
    await transaction([
      { ConditionCheck: { TableName: tableName, Key: key(PK, "REVISION"), ConditionExpression: "#revision = :expected",
        ExpressionAttributeNames: { "#revision": "revision" }, ExpressionAttributeValues: { ":expected": expectedRevision } } },
      { Put: { TableName: tableName, Item: { ...key(PK, "EXPORT#" + entry.id), entry: copy(entry) }, ConditionExpression: "attribute_not_exists(PK)" } }
    ]);
  }

  /** Called by the administrative provisioning script, never by the employee HTTP API. */
  async function createProvision(identity, { settings, defaults }) {
    const PK = owner(identity);
    if (!settings || !defaults) throw invalid("社員の初期設定を指定してください。");
    await transaction([
      { Put: { TableName: tableName, Item: { ...key(PK, "REVISION"), revision: 0 }, ConditionExpression: "attribute_not_exists(PK)" } },
      { Put: { TableName: tableName, Item: { ...key(PK, "CONFIG"), settings: copy(settings), defaults: copy(defaults) }, ConditionExpression: "attribute_not_exists(PK)" } }
    ]);
    return 0;
  }

  return { readContext, commit, getExport, commitExport, createProvision };
}

module.exports = { createDynamoStore };
