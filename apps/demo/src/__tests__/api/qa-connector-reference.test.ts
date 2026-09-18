import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/src/lib/beta-access", () => ({
  BETA_ACCESS_COOKIE_NAME: "beta_access",
  verifyBetaCookie: vi.fn(),
}));
import { verifyBetaCookie } from "@/src/lib/beta-access";
import { GET } from "@/app/api/qa-connector-reference/route";

describe("temporary QA reference check", () => {
  const request = () =>
    new NextRequest(
      "https://testers.betaskintech.com/api/qa-connector-reference",
    );
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T20:00:00Z"));
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("HEYGEN_API_KEY", "private-key");
    vi.stubEnv("HEYGEN_ELEVENLABS_SECRET_ID", "expected-id");
    vi.mocked(verifyBetaCookie).mockResolvedValue(true);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({
            data: [
              {
                id: "expected-id",
                secret_type: "ELEVENLABS_API_KEY",
                created_at: "2026-09-18T17:59:16",
              },
            ],
          }),
        }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it("returns only a boolean for a match", async () => {
    const r = await GET(request());
    expect(await r.json()).toEqual({ matchesRenewedSecret: true });
    expect(r.headers.get("cache-control")).toContain("no-store");
  });
  it("reports mismatch without values", async () => {
    vi.stubEnv("HEYGEN_ELEVENLABS_SECRET_ID", "old-id");
    expect(await (await GET(request())).json()).toEqual({
      matchesRenewedSecret: false,
    });
  });
  it("blocks production before fetching", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await GET(request())).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("expires before fetching", async () => {
    vi.setSystemTime(new Date("2026-09-19T00:00:00Z"));
    expect((await GET(request())).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires an authenticated beta cookie", async () => {
    vi.mocked(verifyBetaCookie).mockResolvedValue(false);
    expect((await GET(request())).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not treat missing target as mismatch", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    } as Response);
    expect((await GET(request())).status).toBe(503);
  });
  it("hides provider errors", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("private-provider-data"));
    const r = await GET(request());
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "Unavailable" });
  });
});
