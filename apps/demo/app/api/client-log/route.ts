/**
 * Client-side log relay — mobile clients POST logs here so they appear
 * in Vercel Runtime Logs (where we can actually read them).
 *
 * Only enabled in non-production environments.
 */
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  // Only allow in preview/development
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  try {
    const { logs } = await request.json();

    if (!Array.isArray(logs)) {
      return NextResponse.json(
        { error: "logs must be array" },
        { status: 400 },
      );
    }

    // Print each log line so it appears in Vercel Runtime Logs
    for (const entry of logs.slice(0, 50)) {
      const level = entry.level || "info";
      const msg = `[CLIENT:${entry.device || "unknown"}] ${entry.message}`;

      if (level === "error") {
        console.error(msg);
      } else if (level === "warn") {
        console.warn(msg);
      } else {
        console.log(msg);
      }
    }

    return NextResponse.json({ ok: true, received: logs.length });
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
}
