import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

function post(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3001/api/client-log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("client telemetry relay", () => {
  it("accepts only a fixed, non-sensitive event name", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const route = await import("@/app/api/client-log/route");

    const response = await route.POST(
      post({ event: "greeting_completed", level: "info", device: "mobile" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("rejects the legacy free-form log payload", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const route = await import("@/app/api/client-log/route");

    const response = await route.POST(
      post({ logs: [{ message: "conversation text must not be relayed" }] }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects an event outside the fixed allowlist", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const route = await import("@/app/api/client-log/route");

    const response = await route.POST(
      post({ event: "conversation_transcript", level: "info" }),
    );

    expect(response.status).toBe(400);
  });

  it("accepts a bounded media diagnostic event", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const route = await import("@/app/api/client-log/route");

    const response = await route.POST(
      post({ event: "connection_quality_bad", level: "warn" }),
    );

    expect(response.status).toBe(200);
  });

  it("rejects an unknown device value", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const route = await import("@/app/api/client-log/route");

    const response = await route.POST(
      post({ event: "greeting_completed", device: "customer-email" }),
    );

    expect(response.status).toBe(400);
  });

  it("remains unavailable in production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const route = await import("@/app/api/client-log/route");

    const response = await route.POST(post({ event: "greeting_completed" }));

    expect(response.status).toBe(403);
  });
});
