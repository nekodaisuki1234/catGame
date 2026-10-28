"use strict";

const { ApiError } = require("./errors.cjs");
const MAX_BODY_BYTES = 64 * 1024;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function rejectUnsafeKeys(value, depth = 0) {
  if (depth > 12) throw new ApiError(400, "INVALID_BODY", "入力データが複雑すぎます。");
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new ApiError(400, "INVALID_BODY", "入力項目を確認してください。");
    rejectUnsafeKeys(child, depth + 1);
  }
}

function readBody(event) {
  const encoded = event.body;
  if (typeof encoded !== "string" || encoded.length > MAX_BODY_BYTES * 2) {
    throw new ApiError(400, "INVALID_BODY", "JSON形式の入力が必要です。");
  }
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  if (!/^application\/json(?:\s*;|$)/i.test(headers["content-type"] || "")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Typeはapplication/jsonを指定してください。");
  }
  const bytes = Buffer.from(encoded, event.isBase64Encoded ? "base64" : "utf8");
  if (bytes.length > MAX_BODY_BYTES) throw new ApiError(413, "BODY_TOO_LARGE", "入力データが大きすぎます。");
  let body;
  try { body = JSON.parse(bytes.toString("utf8")); }
  catch { throw new ApiError(400, "INVALID_JSON", "JSON形式の入力を確認してください。"); }
  if (!body || Array.isArray(body) || typeof body !== "object") throw new ApiError(400, "INVALID_BODY", "入力はJSONオブジェクトで指定してください。");
  rejectUnsafeKeys(body);
  return body;
}

function readPeriod(event) {
  const entries = event.rawQueryString !== undefined ? [...new URLSearchParams(event.rawQueryString)] : Object.entries(event.queryStringParameters || {});
  const params = {};
  for (const [key, value] of entries) {
    if (!["start", "end"].includes(key) || Object.hasOwn(params, key)) {
      throw new ApiError(400, "INVALID_QUERY", "開始日と終了日を一つずつ指定してください。");
    }
    params[key] = value;
  }
  return params;
}

function createHandler({ service, authenticate, allowedOrigin = "", logger = console }) {
  return async function handler(event) {
    const origin = event.headers?.origin ?? event.headers?.Origin;
    const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
    if (allowedOrigin && origin === allowedOrigin) Object.assign(headers, { "access-control-allow-origin": allowedOrigin, vary: "Origin" });
    try {
      const identity = await authenticate(event);
      const method = event.requestContext?.http?.method;
      const stage = event.requestContext?.stage;
      const rawPath = event.rawPath;
      const prefix = stage && stage !== "$default" ? "/" + stage : "";
      const path = prefix && typeof rawPath === "string" && rawPath.startsWith(prefix + "/") ? rawPath.slice(prefix.length) : rawPath;
      let result;
      const day = typeof path === "string" && /^\/v1\/days\/(\d{4}-\d{2}-\d{2})(\/time)?$/.exec(path);
      const exported = typeof path === "string" && /^\/v1\/exports\/([A-Za-z0-9_-]{1,128})$/.exec(path);
      if (method === "GET" && path === "/v1/days") result = await service.readDays(identity, readPeriod(event));
      else if (method === "PUT" && day && !day[2]) result = await service.putDay(identity, day[1], readBody(event));
      else if (method === "DELETE" && day && !day[2]) result = await service.deleteDay(identity, day[1], readBody(event));
      else if (method === "PATCH" && day?.[2]) result = await service.updateDayTime(identity, day[1], readBody(event));
      else if (method === "PUT" && path === "/v1/config") result = await service.putConfig(identity, readBody(event));
      else if (method === "POST" && path === "/v1/exports") result = await service.createExport(identity, readBody(event));
      else if (method === "GET" && exported) result = await service.getExport(identity, exported[1]);
      else throw new ApiError(404, "NOT_FOUND", "対象のAPIがありません。");
      return { statusCode: method === "POST" ? 201 : 200, headers, body: JSON.stringify(result) };
    } catch (error) {
      if (error instanceof ApiError) {
        return { statusCode: error.status, headers, body: JSON.stringify({ error: { code: error.code, message: error.message, ...(error.details !== undefined ? { details: error.details } : {}) } }) };
      }
      // Do not log request bodies, access tokens, identifiers, or provider error payloads.
      logger.error?.({ event: "attendance_api_failure", requestId: event.requestContext?.requestId || "unknown" });
      return { statusCode: 500, headers, body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "処理できませんでした。時間をおいて再度お試しください。" } }) };
    }
  };
}

module.exports = { createHandler };
