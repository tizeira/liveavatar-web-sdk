import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/src/lib/db/prisma", () => ({ default: { $queryRaw: mocks.query } }));
vi.mock("@/app/api/secrets", () => ({
  API_KEY: "test-only",
  API_URL: "https://provider.invalid",
  AVATAR_ID_DESKTOP: "test",
  AVATAR_ID_MOBILE: "test",
  ELEVENLABS_API_KEY: "test-only",
  ELEVENLABS_AGENT_ID: "test",
}));
const { GET } = await import("@/app/api/diagnostics/route");
describe("production diagnostics guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it("blocks before auth, database or provider requests", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await GET()).status).toBe(404);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
