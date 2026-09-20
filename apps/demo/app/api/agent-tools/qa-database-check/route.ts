import { hasValidAgentToolSecret } from "@/src/consultations/security";
import prisma from "@/src/lib/db/prisma";
import { auth } from "@/auth";
import { createHash } from "node:crypto";

// Temporary release check. Remove before promoting the production candidate.
const previewBranch = "codex/clara-isolated-preview-2026-09-20";
const endpoint = "ep-little-dream-a462w2ww";
const expiresAt = Date.parse("2026-09-22T00:00:00Z");
const operatorEmailHash =
  "a839584d03ec72ec7754a676a2b9c276acdac419e6b48abe586c8bccb4883136";

function reply(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function matchesExpectedConnection(value: string | undefined, pooled: boolean) {
  try {
    const url = new URL(value || "");
    return (
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      url.hostname ===
        `${endpoint}${pooled ? "-pooler" : ""}.us-east-1.aws.neon.tech` &&
      url.pathname === "/neondb"
    );
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (
    process.env.VERCEL_ENV !== "preview" ||
    process.env.VERCEL_GIT_COMMIT_REF !== previewBranch ||
    Date.now() >= expiresAt
  ) {
    return reply({ error: "Not available" }, 404);
  }
  const validBearer = hasValidAgentToolSecret(
    request.headers.get("authorization"),
    process.env.CLARA_AGENT_TOOL_SECRET || "",
  );
  if (!validBearer) {
    const email = (await auth())?.user?.email?.trim().toLowerCase();
    if (
      !email ||
      createHash("sha256").update(email).digest("hex") !== operatorEmailHash
    ) {
      return reply({ error: "Unauthorized" }, 401);
    }
  }

  const matchesExpectedBranch =
    matchesExpectedConnection(process.env.POSTGRES_PRISMA_URL, true) &&
    matchesExpectedConnection(process.env.POSTGRES_URL_NON_POOLING, false);
  // Never query an unexpected database, including main.
  if (!matchesExpectedBranch) {
    return reply(
      { matchesExpectedBranch: false, database: "not_checked" },
      409,
    );
  }
  try {
    const rows = await prisma.$queryRaw<Array<{ schema_ready: boolean }>>`
      SELECT to_regclass('public.clara_consultations') IS NOT NULL
        AND to_regclass('public.clara_daily_metrics') IS NOT NULL
        AND to_regclass('public._prisma_migrations') IS NOT NULL AS schema_ready
    `;
    const schemaReady = rows[0]?.schema_ready === true;
    return reply(
      { matchesExpectedBranch: true, database: "ok", schemaReady },
      schemaReady ? 200 : 503,
    );
  } catch {
    return reply({ matchesExpectedBranch: true, database: "error" }, 503);
  }
}

// Browser access reuses the application's existing signed-in session.
export const GET = POST;
