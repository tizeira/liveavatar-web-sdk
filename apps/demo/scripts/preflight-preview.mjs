import { pathToFileURL } from "node:url";

const EXPECTED_QA_ENDPOINT = "ep-dark-moon-a4ec9v5b";
const REQUIRED_TABLES = [
  "clara_consultations",
  "clara_daily_metrics",
  "clara_catalog_products",
  "clara_catalog_state",
  "_prisma_migrations",
];

// Fail closed before querying anything. Never log connection strings or raw errors.
export function validatePreviewTarget(env) {
  if (env.VERCEL_ENV !== "preview") throw new Error("PREVIEW_TARGET_REQUIRED");
  for (const key of ["POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING"]) {
    let url;
    try {
      url = new URL(env[key]);
    } catch {
      throw new Error("PREVIEW_DATABASE_CONFIG_MISSING");
    }
    const endpoint = url.hostname.split(".")[0].replace(/-pooler$/, "");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname.endsWith(".neon.tech") ||
      endpoint !== EXPECTED_QA_ENDPOINT
    ) {
      throw new Error("PREVIEW_DATABASE_TARGET_MISMATCH");
    }
  }
}

export async function inspectPreviewDatabase(db) {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const rows = await tx.$queryRawUnsafe(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      );
      const names = new Set(rows.map((row) => row.table_name));
      const missing = REQUIRED_TABLES.filter((name) => !names.has(name));
      if (missing.length)
        return { ready: false, reason: "SCHEMA_NOT_READY", missing };
      const migrations = await tx.$queryRawUnsafe(
        "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
      );
      const migrationReady = migrations.some(
        (row) => row.migration_name === "20260922010000_add_clara_catalog",
      );
      const [catalog] = await tx.$queryRawUnsafe(
        "SELECT count(*)::int AS count FROM clara_catalog_products",
      );
      const [state] = await tx.$queryRawUnsafe(
        "SELECT count(*)::int AS count FROM clara_catalog_state WHERE source = 'shopify'",
      );
      return {
        ready: migrationReady && catalog.count > 0 && state.count === 1,
        migrationReady,
        catalogCount: catalog.count,
        catalogInitialized: state.count === 1,
      };
    },
    { timeout: 15000 },
  );
}

async function main() {
  let db;
  try {
    validatePreviewTarget(process.env);
    const { PrismaClient } = await import("@prisma/client");
    db = new PrismaClient({ log: [] });
    const result = await inspectPreviewDatabase(db);
    console.log(
      "CLARA_PREVIEW_PREFLIGHT",
      JSON.stringify({ matchesQaBranch: true, ...result }),
    );
    if (!result.ready) process.exitCode = 1;
  } catch (error) {
    const code =
      error instanceof Error && error.message.startsWith("PREVIEW_")
        ? error.message
        : "PREVIEW_DATABASE_CHECK_FAILED";
    console.error(
      "CLARA_PREVIEW_PREFLIGHT",
      JSON.stringify({ ready: false, code }),
    );
    process.exitCode = 1;
  } finally {
    await db?.$disconnect();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
