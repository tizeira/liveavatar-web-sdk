/**
 * Client-side telemetry relay for non-production diagnostics.
 *
 * It accepts only a fixed event name. Conversation text, provider events,
 * identifiers, and error bodies must never leave the browser through this
 * endpoint.
 */
import { NextRequest, NextResponse } from "next/server";

const SAFE_CLIENT_EVENTS = new Set([
  "voicechat_state_observed",
  "voicechat_ready",
  "voicechat_prepare_failed",
  "greeting_triggered",
  "greeting_trigger_failed",
  "greeting_completed",
  "microphone_ready",
  "microphone_unmute_failed",
  "agent_event_observed",
]);

const SAFE_DEVICES = new Set(["desktop", "mobile", "unknown"]);

export async function POST(request: NextRequest) {
  // Only allow in preview/development (VERCEL_ENV distinguishes preview from production on Vercel)
  const vercelEnv = process.env.VERCEL_ENV || process.env.NODE_ENV;
  if (vercelEnv === "production") {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  try {
    const { event, level, device } = await request.json();

    if (
      typeof event !== "string" ||
      !SAFE_CLIENT_EVENTS.has(event) ||
      (device !== undefined &&
        (typeof device !== "string" || !SAFE_DEVICES.has(device)))
    ) {
      return NextResponse.json(
        { error: "invalid telemetry event" },
        { status: 400 },
      );
    }

    const message = `[CLIENT:${device || "unknown"}] ${event}`;
    if (level === "error") {
      console.error(message);
    } else if (level === "warn") {
      console.warn(message);
    } else {
      console.info(message);
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
}
