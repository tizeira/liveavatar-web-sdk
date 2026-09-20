import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/src/lib/db/prisma", () => ({ default: { $queryRaw: mocks.query } }));
const { GET, POST } = await import(
  "@/app/api/agent-tools/qa-database-check/route"
);
const request = (token = "test-only") =>
  new Request("https://preview.invalid/api/agent-tools/qa-database-check", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });

describe("temporary QA database check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(null);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T23:00:00Z"));
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv(
      "VERCEL_GIT_COMMIT_REF",
      "codex/clara-isolated-preview-2026-09-20",
    );
    vi.stubEnv("CLARA_AGENT_TOOL_SECRET", "test-only");
    vi.stubEnv(
      "POSTGRES_PRISMA_URL",
      "postgresql://user:secret@ep-little-dream-a462w2ww-pooler.us-east-1.aws.neon.tech/neondb",
    );
    vi.stubEnv(
      "POSTGRES_URL_NON_POOLING",
      "postgresql://user:secret@ep-little-dream-a462w2ww.us-east-1.aws.neon.tech/neondb",
    );
    vi.stubGlobal("fetch", vi.fn());
    mocks.query.mockResolvedValue([{ schema_ready: true }]);
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it.each(["production", "development", ""])("is closed in %s", async (env) => {
    vi.stubEnv("VERCEL_ENV", env);
    expect((await POST(request())).status).toBe(404);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("is closed for other branches and after expiry", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "master");
    expect((await POST(request())).status).toBe(404);
    vi.stubEnv(
      "VERCEL_GIT_COMMIT_REF",
      "codex/clara-isolated-preview-2026-09-20",
    );
    vi.setSystemTime(new Date("2026-09-22T00:00:00Z"));
    expect((await POST(request())).status).toBe(404);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("rejects incorrect and unconfigured authentication", async () => {
    expect((await POST(request("wrong"))).status).toBe(401);
    vi.stubEnv("CLARA_AGENT_TOOL_SECRET", "");
    expect((await POST(request())).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it.each(["POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING"])(
    "does not query if %s is unexpected",
    async (key) => {
      vi.stubEnv(key, "postgresql://user:secret@main.invalid/neondb");
      expect((await POST(request())).status).toBe(409);
      expect(mocks.query).not.toHaveBeenCalled();
    },
  );
  it("returns only booleans and status after the catalog query", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      matchesExpectedBranch: true,
      database: "ok",
      schemaReady: true,
    });
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
  it("accepts only the approved operator's browser session", async () => {
    const browserRequest = new Request("https://preview.invalid/check");
    expect((await GET(browserRequest)).status).toBe(401);
    mocks.auth.mockResolvedValue({ user: { email: "other@example.test" } });
    expect((await GET(browserRequest)).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
    mocks.auth.mockResolvedValue({ user: { email: "tizeiraivan@gmail.com" } });
    expect((await GET(browserRequest)).status).toBe(200);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
  it("fails closed for missing tables and sanitizes errors", async () => {
    mocks.query.mockResolvedValueOnce([{ schema_ready: false }]);
    expect((await POST(request())).status).toBe(503);
    mocks.query.mockRejectedValueOnce(
      new Error("private database credentials"),
    );
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      matchesExpectedBranch: true,
      database: "error",
    });
  });
});
