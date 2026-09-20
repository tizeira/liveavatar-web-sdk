import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  cancel: vi.fn(),
  attach: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/app/api/secrets", () => ({
  API_KEY: "test-only",
  API_URL: "https://provider.invalid",
  AVATAR_ID_MOBILE: "test-mobile",
  AVATAR_ID_DESKTOP: "test-desktop",
  HEYGEN_ELEVENLABS_SECRET_ID: "test-reference",
  ELEVENLABS_AGENT_ID: "test-agent",
  CHROMA_KEY_ENABLED: false,
  CHROMA_MIN_HUE: 0,
  CHROMA_MAX_HUE: 0,
  CHROMA_MIN_SATURATION: 0,
  CHROMA_EDGE_SHARPNESS: 0,
  CHROMA_BG_URL_DESKTOP: "",
  CHROMA_BG_URL_MOBILE: "",
  SHOPIFY_HMAC_SECRET: "test-only",
}));
vi.mock("@/src/lib/rate-limit", () => ({
  rateLimitByEndpoint: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("@/src/lib/logger/secure-logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/src/consultations/repository", () => ({
  getRecentClaraConversationMemory: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/src/consultations/security", () => ({
  hashConsultationAccessToken: vi.fn().mockReturnValue("test-hash"),
}));
vi.mock("@/src/lib/clara-buyer-access", () => ({
  CLARA_BUYER_COOKIE_NAME: "clara_buyer_access",
  readClaraBuyerTicket: vi.fn().mockResolvedValue({ buyerKey: "test-buyer" }),
  deriveAuthenticatedTesterKey: vi.fn(),
  reserveClaraBuyerSession: mocks.reserve,
  cancelClaraBuyerSession: mocks.cancel,
  attachClaraLiveAvatarSession: mocks.attach,
}));
const { POST } = await import("@/app/api/start-custom-session/route");
const request = () =>
  new NextRequest("http://localhost/api/start-custom-session", {
    method: "POST",
    body: "{}",
  });

describe("provider failure recovery (offline, mocked persistence)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.reserve.mockResolvedValue({
      ok: true,
      remaining: 2,
      resetAt: Date.now() + 3600000,
    });
    mocks.cancel.mockResolvedValue(true);
    mocks.attach.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([402, 429, 503])(
    "cancels the exact reservation after HTTP %i and permits a fresh attempt",
    async (status) => {
      mocks.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "provider unavailable" }), {
          status,
        }),
      );
      const failed = await POST(request());
      expect(failed.status).toBe(status);
      const first = mocks.reserve.mock.calls[0]![0];
      expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(
        first.buyerKey,
        first.consultationId,
      );
      expect(mocks.attach).not.toHaveBeenCalled();
      mocks.fetch.mockResolvedValueOnce(
        Response.json({
          data: { session_token: "test-token", session_id: "test-session" },
        }),
      );
      const retry = await POST(request());
      expect(retry.status).toBe(200);
      expect(mocks.reserve.mock.calls[1]![0].consultationId).not.toBe(
        first.consultationId,
      );
      expect(mocks.attach).toHaveBeenCalledOnce();
    },
  );
  it("cancels after a network exception", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("fetch failed"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe("HEYGEN_NETWORK_ERROR");
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });
  it("cancels after an empty provider token", async () => {
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ data: { session_id: "test-session" } }),
    );
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe("HEYGEN_EMPTY_TOKEN");
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });
  it("does not contact the provider when the buyer already has an active session", async () => {
    mocks.reserve.mockResolvedValueOnce({
      ok: false,
      reason: "active_session",
      retryAfter: 60,
    });
    expect((await POST(request())).status).toBe(409);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("times out and cancels a hung provider fetch without retrying it", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    mocks.fetch.mockImplementationOnce((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    });

    const pending = POST(request());
    await vi.advanceTimersByTimeAsync(20_000);
    const response = await pending;

    expect(response.status).toBe(504);
    expect((await response.json()).code).toBe("HEYGEN_TIMEOUT");
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(true);
  });

  it("keeps the timeout classification when an error response body rejects on abort", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    mocks.fetch.mockImplementationOnce((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return Promise.resolve({
        ok: false,
        status: 503,
        statusText: "Unavailable",
        json: () =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      });
    });

    const pending = POST(request());
    await vi.advanceTimersByTimeAsync(20_000);
    const response = await pending;

    expect(response.status).toBe(504);
    expect((await response.json()).code).toBe("HEYGEN_TIMEOUT");
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(true);
  });

  it("times out and cancels when the provider response body never resolves", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    mocks.fetch.mockImplementationOnce((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return Promise.resolve({
        ok: true,
        json: () => new Promise(() => {}),
      });
    });

    const pending = POST(request());
    await vi.advanceTimersByTimeAsync(20_000);
    const response = await pending;

    expect(response.status).toBe(504);
    expect((await response.json()).code).toBe("HEYGEN_TIMEOUT");
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(true);
  });
});
