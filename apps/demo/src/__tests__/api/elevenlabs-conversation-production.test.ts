import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/app/api/secrets", () => ({
  ELEVENLABS_API_KEY: "test-only",
  ELEVENLABS_AGENT_ID: "test-agent",
}));
vi.mock("@/src/lib/rate-limit", () => ({
  rateLimitByEndpoint: mocks.rateLimit,
}));
vi.mock("@/src/lib/logger/secure-logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { POST } = await import("@/app/api/elevenlabs-conversation/route");

describe("legacy ElevenLabs conversation route in production", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is unavailable before auth, rate limiting, or provider work", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    mocks.auth.mockResolvedValue({ user: { email: "anyone@example.com" } });

    const response = await POST(
      new Request("https://clara.example/api/elevenlabs-conversation", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(response.status).toBe(404);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });
});
