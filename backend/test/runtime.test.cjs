"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime } = require("../src/lambda.cjs");

const configured = () => ({
  ATTENDANCE_TABLE: "attendance-unit-test",
  EXPORT_BUCKET: "attendance-unit-test",
  ENTRA_TENANT_ID: "11111111-1111-1111-1111-111111111111",
  ENTRA_API_AUDIENCE: "attendance-api",
  ENTRA_REQUIRED_SCOPE: "access_as_user",
  ALLOWED_ORIGIN: "https://nekodaisuki1234.github.io"
});

test("the production runtime composes real SDK adapters and rejects unauthenticated requests before AWS access", async () => {
  const handler = createRuntime(configured());
  const result = await handler({ version: "2.0", rawPath: "/v1/days", requestContext: { http: { method: "GET" } } });
  assert.equal(result.statusCode, 401);
  assert.equal(JSON.parse(result.body).error.code, "UNAUTHENTICATED");
});

test("incomplete deployment configuration fails instead of falling back to a mock backend", () => {
  assert.throws(() => createRuntime({}), /incomplete/);
  assert.throws(() => createRuntime({ ...configured(), ALLOWED_ORIGIN: "https://example.com/path" }), /HTTPS origin/);
});
