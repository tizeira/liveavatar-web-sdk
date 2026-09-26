// One-shot operator command. Not part of the normal application build.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  validatePreviewTarget,
  inspectPreviewDatabase,
} from "./preflight-preview.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = "20260922010000_add_clara_catalog";
const CORE = "20260914170000_init_clara_core";
const MIGRATION_HASH =
  "fc8e3f289041ae12f1c9104d031d7ba0ffc379401d80108ce21dd68d198e12c1";

export function validateBootstrapTarget(env) {
  validatePreviewTarget(env);
  const pooled = new URL(env.POSTGRES_PRISMA_URL);
  const direct = new URL(env.POSTGRES_URL_NON_POOLING);
  if (
    direct.hostname.split(".")[0].endsWith("-pooler") ||
    direct.pathname !== "/neondb" ||
    pooled.pathname !== direct.pathname ||
    direct.username !== pooled.username ||
    env.VERCEL_GIT_COMMIT_REF !== "codex/clara-lab-design-2026-09-25" ||
    env.CLARA_QA_CATALOG_BOOTSTRAP !== "authorized-2026-09-26" ||
    env.SHOPIFY_STORE_DOMAIN !== "289f72-45.myshopify.com"
  ) {
    throw new Error("PREVIEW_BOOTSTRAP_SCOPE_MISMATCH");
  }
}

export function validateMigrationPlan(rows, directories) {
  if (
    directories.sort().join(",") !== [CORE, CATALOG].sort().join(",") ||
    rows.some((r) => !r.finished_at && !r.rolled_back_at)
  ) {
    throw new Error("PREVIEW_MIGRATION_PLAN_UNSAFE");
  }
  const applied = new Set(
    rows
      .filter((r) => r.finished_at && !r.rolled_back_at)
      .map((r) => r.migration_name),
  );
  if (!applied.has(CORE)) throw new Error("PREVIEW_CORE_MIGRATION_REQUIRED");
  return !applied.has(CATALOG);
}

async function main() {
  let db;
  let generated;
  const report = console.log.bind(console);
  const reportError = console.error.bind(console);
  try {
    validateBootstrapTarget(process.env);
    const migrations = resolve(ROOT, "prisma/migrations");
    const sql = readFileSync(resolve(migrations, CATALOG, "migration.sql"));
    if (createHash("sha256").update(sql).digest("hex") !== MIGRATION_HASH)
      throw new Error("PREVIEW_MIGRATION_HASH_MISMATCH");
    const { PrismaClient } = await import("@prisma/client");
    db = new PrismaClient({ log: [] });
    const rows = await db.$queryRawUnsafe(
      "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations",
    );
    const directories = readdirSync(migrations, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    const needsMigration = validateMigrationPlan(rows, directories);
    const before = await inspectPreviewDatabase(db);
    if (before.ready) {
      report(
        "CLARA_QA_BOOTSTRAP",
        JSON.stringify({
          alreadyReady: true,
          catalogCount: before.catalogCount,
        }),
      );
      return;
    }
    if (needsMigration) {
      if (
        before.reason !== "SCHEMA_NOT_READY" ||
        before.missing.length !== 2 ||
        !before.missing.includes("clara_catalog_products") ||
        !before.missing.includes("clara_catalog_state")
      )
        throw new Error("PREVIEW_SCHEMA_NOT_EXPECTED");
      const require = createRequire(import.meta.url);
      // No Prisma stdout: it can contain connection metadata. Static errors only.
      execFileSync(
        process.execPath,
        [
          require.resolve("prisma/build/index.js"),
          "migrate",
          "deploy",
          "--schema",
          resolve(ROOT, "prisma/schema.prisma"),
        ],
        { cwd: ROOT, env: process.env, stdio: "pipe", timeout: 120000 },
      );
      report(
        "CLARA_QA_BOOTSTRAP",
        JSON.stringify({ migrationApplied: CATALOG }),
      );
    }
    const after = await inspectPreviewDatabase(db);
    if (
      !after.migrationReady ||
      after.catalogCount !== 0 ||
      after.catalogInitialized
    )
      throw new Error("PREVIEW_CATALOG_NOT_EMPTY");
    // Compile the existing Shopify reader + transactional snapshot writer. No new
    // driver, copied catalog logic, customer reads, or public bootstrap endpoint.
    const require = createRequire(import.meta.url);
    const viteRequire = createRequire(
      createRequire(require.resolve("vitest/package.json")).resolve(
        "vite/package.json",
      ),
    );
    const { build } = viteRequire("esbuild");
    generated = resolve(ROOT, "scripts/.qa-catalog-bootstrap.cjs");
    const compiled = await build({
      entryPoints: [resolve(ROOT, "scripts/bootstrap-preview-catalog-sync.ts")],
      bundle: true,
      platform: "node",
      format: "cjs",
      packages: "external",
      alias: { "@": ROOT },
      write: false,
      logLevel: "silent",
    });
    writeFileSync(generated, compiled.outputFiles[0].contents);
    globalThis.prisma = db;
    // Upstream error objects can include GraphQL details; sanitize at this boundary.
    console.error = () => {};
    const result = await require(generated).syncPreviewCatalog();
    console.error = reportError;
    const checked = await inspectPreviewDatabase(db);
    if (!checked.ready || checked.catalogCount !== result.productCount)
      throw new Error("PREVIEW_SYNC_VERIFICATION_FAILED");
    report(
      "CLARA_QA_BOOTSTRAP",
      JSON.stringify({
        synced: true,
        productCount: result.productCount,
        searchVerified: result.searchVerified,
      }),
    );
  } catch (error) {
    reportError(
      "CLARA_QA_BOOTSTRAP",
      JSON.stringify({
        ready: false,
        code:
          error instanceof Error && /^PREVIEW_[A-Z_]+$/.test(error.message)
            ? error.message
            : "PREVIEW_BOOTSTRAP_FAILED",
      }),
    );
    process.exitCode = 1;
  } finally {
    console.error = reportError;
    if (generated) {
      try {
        unlinkSync(generated);
      } catch {}
    }
    await db?.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
