import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateBootstrapTarget,
  validateMigrationPlan,
} from "./bootstrap-preview-catalog.mjs";
const env = {
  VERCEL_ENV: "preview",
  POSTGRES_PRISMA_URL:
    "postgresql://fake@ep-dark-moon-a4ec9v5b-pooler.test.neon.tech/neondb",
  POSTGRES_URL_NON_POOLING:
    "postgresql://fake@ep-dark-moon-a4ec9v5b.test.neon.tech/neondb",
  VERCEL_GIT_COMMIT_REF: "codex/clara-lab-design-2026-09-25",
  CLARA_QA_CATALOG_BOOTSTRAP: "authorized-2026-09-26",
  SHOPIFY_STORE_DOMAIN: "289f72-45.myshopify.com",
};
const core = "20260914170000_init_clara_core";
const catalog = "20260922010000_add_clara_catalog";
const finished = (name) => ({
  migration_name: name,
  finished_at: new Date(),
  rolled_back_at: null,
});
test("bootstrap permits only explicit QA scope", () =>
  assert.doesNotThrow(() => validateBootstrapTarget(env)));
test("bootstrap rejects production, absent approval, other branch, database, role, store, or pooled migration URL", () => {
  for (const override of [
    { VERCEL_ENV: "production" },
    { CLARA_QA_CATALOG_BOOTSTRAP: undefined },
    { VERCEL_GIT_COMMIT_REF: "main" },
    { SHOPIFY_STORE_DOMAIN: "other.myshopify.com" },
    { POSTGRES_URL_NON_POOLING: env.POSTGRES_PRISMA_URL },
    {
      POSTGRES_URL_NON_POOLING: env.POSTGRES_URL_NON_POOLING.replace(
        "neondb",
        "other",
      ),
    },
    {
      POSTGRES_URL_NON_POOLING: env.POSTGRES_URL_NON_POOLING.replace(
        "fake@",
        "other@",
      ),
    },
    {
      POSTGRES_PRISMA_URL: env.POSTGRES_PRISMA_URL.replace(
        "ep-dark-moon-a4ec9v5b",
        "ep-icy-sun-a4t1maz1",
      ),
    },
  ])
    assert.throws(
      () => validateBootstrapTarget({ ...env, ...override }),
      /PREVIEW_/,
    );
});
test("only catalog can be pending", () => {
  assert.equal(validateMigrationPlan([finished(core)], [core, catalog]), true);
  assert.equal(
    validateMigrationPlan([finished(core), finished(catalog)], [core, catalog]),
    false,
  );
  assert.throws(
    () => validateMigrationPlan([], [core, catalog]),
    /CORE_MIGRATION_REQUIRED/,
  );
  assert.throws(
    () => validateMigrationPlan([finished(core)], [core, catalog, "new"]),
    /UNSAFE/,
  );
  assert.throws(
    () =>
      validateMigrationPlan(
        [finished(core), { migration_name: catalog }],
        [core, catalog],
      ),
    /UNSAFE/,
  );
});
