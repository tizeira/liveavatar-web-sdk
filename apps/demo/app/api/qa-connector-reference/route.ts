import { NextRequest, NextResponse } from "next/server";
import {
  BETA_ACCESS_COOKIE_NAME,
  verifyBetaCookie,
} from "@/src/lib/beta-access";

export const dynamic = "force-dynamic";
const EXPIRES_AT = Date.parse("2026-09-19T00:00:00Z");
// Exact creation time of the renewed secret observed in LiveAvatar, not its ID.
const EXPECTED_CREATED_AT = Date.parse("2026-09-18T17:59:16Z");

function reply(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview" || Date.now() >= EXPIRES_AT) {
    return reply({ error: "Unavailable" }, 404);
  }
  if (
    !(await verifyBetaCookie(
      request.cookies.get(BETA_ACCESS_COOKIE_NAME)?.value,
    ))
  ) {
    return reply({ error: "Unauthorized" }, 401);
  }
  const key = process.env.HEYGEN_API_KEY;
  const reference = process.env.HEYGEN_ELEVENLABS_SECRET_ID;
  if (!key || !reference) return reply({ error: "Unavailable" }, 503);
  try {
    const response = await fetch("https://api.liveavatar.com/v1/secrets", {
      headers: { "X-API-KEY": key },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return reply({ error: "Unavailable" }, 503);
    const body = await response.json();
    if (!Array.isArray(body.data)) return reply({ error: "Unavailable" }, 503);
    const candidates = body.data.filter(
      (item: { id?: unknown; secret_type?: unknown; created_at?: unknown }) => {
        if (
          typeof item.id !== "string" ||
          item.secret_type !== "ELEVENLABS_API_KEY" ||
          typeof item.created_at !== "string"
        )
          return false;
        const date = /(?:Z|[+-]\d{2}:\d{2})$/.test(item.created_at)
          ? item.created_at
          : `${item.created_at}Z`;
        return Date.parse(date) === EXPECTED_CREATED_AT;
      },
    );
    if (candidates.length !== 1) return reply({ error: "Unavailable" }, 503);
    return reply({ matchesRenewedSecret: reference === candidates[0].id });
  } catch {
    return reply({ error: "Unavailable" }, 503);
  }
}
