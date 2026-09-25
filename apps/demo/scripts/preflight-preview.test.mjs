import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validatePreviewTarget,
  inspectPreviewDatabase,
} from "./preflight-preview.mjs";
const qa = {
  VERCEL_ENV: "preview",
  POSTGRES_PRISMA_URL:
    "postgresql://fake@ep-dark-moon-a4ec9v5b-pooler.test.neon.tech/neondb",
  POSTGRES_URL_NON_POOLING:
    "postgresql://fake@ep-dark-moon-a4ec9v5b.test.neon.tech/neondb",
};
test("permits only the documented isolated QA endpoint", () =>
  assert.doesNotThrow(() => validatePreviewTarget(qa)));
test("rejects Production before accessing a database", () =>
  assert.throws(
    () => validatePreviewTarget({ ...qa, VERCEL_ENV: "production" }),
    /PREVIEW_TARGET_REQUIRED/,
  ));
test("rejects a different database endpoint", () =>
  assert.throws(
    () =>
      validatePreviewTarget({
        ...qa,
        POSTGRES_PRISMA_URL: "postgresql://fake@ep-other.test.neon.tech/neondb",
      }),
    /TARGET_MISMATCH/,
  ));
test("rejects missing configuration without revealing it", () =>
  assert.throws(
    () => validatePreviewTarget({ VERCEL_ENV: "preview" }),
    /CONFIG_MISSING/,
  ));
test("uses a read-only transaction and stops at missing schema", async () => {
  const statements = [];
  const tx = {
    $executeRawUnsafe: async (sql) => statements.push(sql),
    $queryRawUnsafe: async (sql) => {
      statements.push(sql);
      return [{ table_name: "clara_consultations" }];
    },
  };
  const result = await inspectPreviewDatabase({ $transaction: (fn) => fn(tx) });
  assert.equal(statements[0], "SET TRANSACTION READ ONLY");
  assert.equal(statements.length, 2);
  assert.equal(result.ready, false);
  assert.ok(result.missing.includes("clara_catalog_products"));
});
