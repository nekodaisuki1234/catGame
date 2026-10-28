"use strict";

const { createGatewayAuthenticator } = require("./auth.cjs");
const { createHandler } = require("./handler.cjs");
const { createAttendanceService } = require("./service.cjs");
const { createDynamoStore } = require("./dynamo-store.cjs");
const { createS3ExportStorage, createS3TemplateProvider } = require("./s3-storage.cjs");
const { createExcelRenderer } = require("./excel-renderer.cjs");

function createRuntime(env = process.env) {
  for (const key of ["ATTENDANCE_TABLE", "EXPORT_BUCKET", "ENTRA_TENANT_ID", "ENTRA_API_AUDIENCE", "ENTRA_REQUIRED_SCOPE", "ALLOWED_ORIGIN"]) {
    if (!env[key]) throw new Error("Attendance backend configuration is incomplete.");
  }
  if (!/^https:\/\/[^/]+$/.test(env.ALLOWED_ORIGIN)) throw new Error("ALLOWED_ORIGIN must be an HTTPS origin.");
  const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
  const { S3Client } = require("@aws-sdk/client-s3");
  const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: false } });
  const s3 = new S3Client({});
  const store = createDynamoStore({ client: dynamo, tableName: env.ATTENDANCE_TABLE });
  const service = createAttendanceService({ store,
    templateProvider: createS3TemplateProvider({ client: s3, bucket: env.EXPORT_BUCKET, key: env.TEMPLATE_KEY || "", mappingKey: env.TEMPLATE_MAPPING_KEY || "" }),
    renderer: createExcelRenderer(),
    exportStorage: createS3ExportStorage({ client: s3, bucket: env.EXPORT_BUCKET })
  });
  const authenticate = createGatewayAuthenticator({ tenantId: env.ENTRA_TENANT_ID, audience: env.ENTRA_API_AUDIENCE, requiredScope: env.ENTRA_REQUIRED_SCOPE });
  return createHandler({ service, authenticate, allowedOrigin: env.ALLOWED_ORIGIN });
}

let runtime;
async function handler(event) {
  runtime ||= createRuntime();
  return runtime(event);
}

module.exports = { handler, createRuntime };
