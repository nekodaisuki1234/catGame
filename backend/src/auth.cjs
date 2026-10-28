"use strict";

const { ApiError } = require("./errors.cjs");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createGatewayAuthenticator({ tenantId, audience, requiredScope, instant = () => Date.now() }) {
  if (typeof tenantId !== "string" || !UUID.test(tenantId) || typeof audience !== "string" || !audience.trim() ||
      typeof requiredScope !== "string" || !requiredScope.trim() || /\s/.test(requiredScope)) {
    throw new Error("Microsoft 365 API authentication configuration is incomplete.");
  }
  const tenant = tenantId.toLowerCase();
  const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
  return function authenticate(event) {
    // These claims must come from the HTTP API JWT authorizer, never client headers/body.
    const jwt = event?.requestContext?.authorizer?.jwt;
    const claims = jwt?.claims;
    const denied = () => { throw new ApiError(401, "UNAUTHENTICATED", "Microsoft 365でログインしてください。"); };
    if (!claims || typeof claims !== "object" || typeof claims.tid !== "string" || !UUID.test(claims.tid) ||
        typeof claims.oid !== "string" || !UUID.test(claims.oid) || claims.tid.toLowerCase() !== tenant || claims.iss !== issuer) denied();
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const seconds = instant() / 1000;
    if (!audiences.includes(audience) || !Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= seconds ||
        claims.nbf !== undefined && (!Number.isFinite(Number(claims.nbf)) || Number(claims.nbf) > seconds)) denied();
    const scopes = typeof claims.scp === "string" ? claims.scp.split(/\s+/) : [];
    if (!scopes.includes(requiredScope)) {
      throw new ApiError(403, "INSUFFICIENT_SCOPE", "勤怠APIの利用権限がありません。");
    }
    return { tenantId: tenant, employeeId: claims.oid.toLowerCase() };
  };
}

module.exports = { createGatewayAuthenticator };
