"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGatewayAuthenticator } = require("../src/auth.cjs");
const { createHandler } = require("../src/handler.cjs");
const { ApiError } = require("../src/errors.cjs");
const { profileInput } = require("../scripts/provision.cjs");
const { C } = require("../src/core.cjs");
const TENANT = "11111111-1111-1111-1111-111111111111";
const EMPLOYEE = "22222222-2222-2222-2222-222222222222";
const instant = Date.parse("2026-10-28T03:00:00Z");
const authenticate = createGatewayAuthenticator({ tenantId: TENANT, audience: "attendance-api", requiredScope: "access_as_user", instant: () => instant });
const claims = () => ({ tid: TENANT, oid: EMPLOYEE, aud: "attendance-api", iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, scp: "openid access_as_user", exp: String(instant / 1000 + 3600) });
const event = (method, path, body, extra = {}) => ({ version: "2.0", rawPath: path, headers: { "content-type": "application/json", origin: "https://nekodaisuki1234.github.io" },
  requestContext: { requestId: "test-id", http: { method }, authorizer: { jwt: { claims: claims() } } },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}), ...extra });

test("only verified Gateway claims set the employee, with matching tenant/audience/scope/expiry", () => {
  const e = event("GET", "/v1/days");
  e.headers.authorization = "Bearer untrusted";
  assert.deepEqual(authenticate(e), { tenantId: TENANT, employeeId: EMPLOYEE });
  for (const changed of [ { tid: EMPLOYEE }, { oid: "invalid#key" }, { aud: "another-api" }, { iss: "https://attacker.example" }, { exp: String(instant / 1000) }, { nbf: String(instant / 1000 + 1) }, { exp: null } ]) {
    const request = event("GET", "/v1/days");
    Object.assign(request.requestContext.authorizer.jwt.claims, changed);
    assert.throws(() => authenticate(request), e => e.status === 401);
  }
  const idToken = event("GET", "/v1/days");
  delete idToken.requestContext.authorizer.jwt.claims.scp;
  assert.throws(() => authenticate(idToken), e => e.status === 403);
  assert.throws(() => authenticate({ headers: { authorization: "Bearer token" } }), e => e.status === 401);
});

test("routing preserves server ownership and supports the named API stage", async () => {
  const calls = [];
  const service = Object.fromEntries(["readDays", "putDay", "deleteDay", "updateDayTime", "putConfig", "createExport", "getExport"].map(name => [name, async (...args) => { calls.push({ name, args }); return { ok: true }; }]));
  const handler = createHandler({ service, authenticate, allowedOrigin: "https://nekodaisuki1234.github.io" });
  const routes = [
    ["GET", "/v1/days", undefined, "readDays"],
    ["PUT", "/v1/days/2026-10-28", { expectedRevision: 0, record: {} }, "putDay"],
    ["DELETE", "/v1/days/2026-10-28", { expectedRevision: 0 }, "deleteDay"],
    ["PATCH", "/v1/days/2026-10-28/time", { expectedRevision: 0, changes: { end: "18:00" } }, "updateDayTime"],
    ["PUT", "/v1/config", { expectedRevision: 0 }, "putConfig"],
    ["POST", "/v1/exports", { expectedRevision: 0 }, "createExport"],
    ["GET", "/v1/exports/safe-export-id", undefined, "getExport"]
  ];
  for (const [method, path, body, name] of routes) {
    const request = event(method, "/development" + path, body);
    request.requestContext.stage = "development";
    if (name === "readDays") request.rawQueryString = "start=2026-10-01&end=2026-10-28";
    const response = await handler(request);
    assert.equal(response.statusCode, method === "POST" ? 201 : 200);
    assert.equal(response.headers["access-control-allow-origin"], "https://nekodaisuki1234.github.io");
    assert.equal(calls.at(-1).name, name);
    assert.deepEqual(calls.at(-1).args[0], { tenantId: TENANT, employeeId: EMPLOYEE });
  }
  assert.deepEqual(calls[0].args[1], { start: "2026-10-01", end: "2026-10-28" });
});

test("malformed, oversized, duplicate and unsafe input never reaches the service", async () => {
  let called = 0;
  const handler = createHandler({ service: new Proxy({}, { get: () => async () => { called++; } }), authenticate });
  const requests = [
    [event("PUT", "/v1/config", undefined, { body: "{" }), 400],
    [event("PUT", "/v1/config", undefined, { body: '{"__proto__":{"admin":true}}' }), 400],
    [event("PUT", "/v1/config", []), 400],
    [event("PUT", "/v1/config", { note: "a".repeat(65536) }), 413],
    [event("GET", "/v1/days", undefined, { rawQueryString: "start=2026-10-01&start=2026-10-02&end=2026-10-28" }), 400],
    [event("GET", "/v1/days", undefined, { rawQueryString: "employeeId=other&start=2026-10-01&end=2026-10-28" }), 400],
    [event("POST", "/v1/unknown", {}), 404]
  ];
  const media = event("PUT", "/v1/config", {}); media.headers["content-type"] = "text/plain"; requests.push([media, 415]);
  for (const [request, expected] of requests) assert.equal((await handler(request)).statusCode, expected);
  assert.equal(called, 0);
});

test("validation returns per-day issues while unexpected failures disclose no tokens or notes", async () => {
  const logs = [];
  const service = { createExport: async () => { throw new ApiError(422, "validation_failed", "入力を確認", { errors: [{ day: "2026-10-27", messages: ["工数不一致"] }] }); }, readDays: async () => { throw new Error("private note and token"); } };
  const handler = createHandler({ service, authenticate, logger: { error: data => logs.push(data) }, allowedOrigin: "https://nekodaisuki1234.github.io" });
  const invalid = await handler(event("POST", "/v1/exports", {}));
  assert.equal(invalid.statusCode, 422); assert.equal(JSON.parse(invalid.body).error.details.errors[0].day, "2026-10-27");
  const request = event("GET", "/v1/days", undefined, { rawQueryString: "start=2026-10-01&end=2026-10-28" });
  request.headers.origin = "https://attacker.example";
  const failure = await handler(request);
  assert.equal(failure.statusCode, 500); assert.equal(failure.headers["access-control-allow-origin"], undefined);
  assert.doesNotMatch(failure.body + JSON.stringify(logs), /private note|token|22222222/);
  assert.deepEqual(logs, [{ event: "attendance_api_failure", requestId: "test-id" }]);
});

test("profile provisioning uses Entra IDs and explicit real employee fields, never sample data", () => {
  const now = C.clock(new Date(instant));
  const profile = { tenantId: TENANT, employeeId: EMPLOYEE, attendanceStartDay: "2026-10-01", employee: { name: "山田", department: "開発", id: "E2" } };
  const result = profileInput(profile, now);
  assert.equal(result.settings.employee.name, "山田"); assert.equal(result.settings.attendanceStartDay, "2026-10-01");
  assert.equal(result.defaults.breakMinutes, 60);
  for (const changed of [{ employeeId: "E2" }, { attendanceStartDay: "2026-10-29" }, { records: {} }, { employee: { name: "", department: "", id: "" } }]) {
    assert.throws(() => profileInput({ ...profile, ...changed }, now));
  }
});
