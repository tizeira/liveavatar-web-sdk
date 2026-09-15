import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.KV_REST_API_URL = "https://kv.example.test";
process.env.KV_REST_API_TOKEN = "test-token";

const mockEval = vi.fn();
const mockSet = vi.fn();
const mockGet = vi.fn();

vi.mock("@vercel/kv", () => ({
  kv: {
    eval: (...args: unknown[]) => mockEval(...args),
    set: (...args: unknown[]) => mockSet(...args),
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

const access = await import("@/src/lib/clara-buyer-access");

beforeEach(() => {
  vi.clearAllMocks();
  mockSet.mockResolvedValue("OK");
});

describe("Clara buyer session limiter", () => {
  it("reserves one active session and reports remaining starts", async () => {
    mockEval.mockResolvedValue([1, 2, 1_700_003_600_000]);
    const result = await access.reserveClaraBuyerSession(
      "a".repeat(64),
      "51bcaeed-9e1b-4c75-ad05-7b23fbd9d46f",
      1_700_000_000_000,
    );
    expect(result).toEqual({
      ok: true,
      remaining: 2,
      resetAt: 1_700_003_600_000,
    });
    expect(mockEval).toHaveBeenCalledOnce();
  });

  it("distinguishes an active conversation from the hourly quota", async () => {
    mockEval.mockResolvedValueOnce([2, 500]).mockResolvedValueOnce([3, 1200]);
    await expect(
      access.reserveClaraBuyerSession("b".repeat(64), "consultation-a"),
    ).resolves.toEqual({
      ok: false,
      reason: "active_session",
      retryAfter: 500,
    });
    await expect(
      access.reserveClaraBuyerSession("b".repeat(64), "consultation-b"),
    ).resolves.toEqual({
      ok: false,
      reason: "start_limit",
      retryAfter: 1200,
    });
  });

  it("fails closed when KV is unavailable", async () => {
    mockEval.mockRejectedValue(new Error("offline"));
    await expect(
      access.reserveClaraBuyerSession("c".repeat(64), "consultation-c"),
    ).resolves.toEqual({
      ok: false,
      reason: "unavailable",
      retryAfter: 30,
    });
  });

  it("stores only an opaque ticket lookup key", async () => {
    await access.issueClaraBuyerTicket({
      buyerKey: "d".repeat(64),
      firstName: "Ana",
      ordersCount: 1,
      lastOrderProduct: null,
      lastOrderDate: null,
      issuedAt: 1_700_000_000,
    });
    const [key] = mockSet.mock.calls[0]!;
    expect(key).toMatch(/^clara:buyer-ticket:[0-9a-f]{64}$/);
  });
});
