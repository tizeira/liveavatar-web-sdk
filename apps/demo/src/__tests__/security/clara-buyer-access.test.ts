import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.SHOPIFY_HMAC_SECRET = "shopify-test-secret";

const tx = {
  $executeRaw: vi.fn(),
  claraConsultation: {
    findFirst: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
  },
};
const mockTransaction = vi.fn();
const mockUpdate = vi.fn();
const mockUpdateMany = vi.fn();
const mockDeleteMany = vi.fn();

vi.mock("@/src/lib/db/prisma", () => ({
  prisma: {
    $transaction: mockTransaction,
    claraConsultation: {
      update: (...args: unknown[]) => mockUpdate(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
      deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
    },
  },
}));

const access = await import("@/src/lib/clara-buyer-access");

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation(
    async (callback: (client: typeof tx) => unknown) => callback(tx),
  );
  tx.$executeRaw.mockResolvedValue(1);
  tx.claraConsultation.findFirst.mockResolvedValue(null);
  tx.claraConsultation.count.mockResolvedValue(0);
  tx.claraConsultation.create.mockResolvedValue({});
});

function ticket(issuedAt = Math.floor(Date.now() / 1000)) {
  return {
    buyerKey: "d".repeat(64),
    firstName: "Ana",
    ordersCount: 1,
    lastOrderProduct: null,
    lastOrderDate: null,
    issuedAt,
  };
}

describe("Clara buyer access", () => {
  it("encrypts and authenticates a short-lived browser ticket", async () => {
    const token = await access.issueClaraBuyerTicket(ticket());
    expect(token).toMatch(
      /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
    expect(token).not.toContain("Ana");
    await expect(access.readClaraBuyerTicket(token)).resolves.toEqual(ticket());
  });

  it("rejects modified and expired tickets", async () => {
    const freshToken = await access.issueClaraBuyerTicket(ticket());
    const modified = `${freshToken.slice(0, -1)}${freshToken.endsWith("a") ? "b" : "a"}`;
    await expect(access.readClaraBuyerTicket(modified)).resolves.toBeNull();

    const oldIssuedAt = Math.floor(Date.now() / 1000) - 7201;
    const expired = await access.issueClaraBuyerTicket(ticket(oldIssuedAt));
    await expect(access.readClaraBuyerTicket(expired)).resolves.toBeNull();
  });

  it("atomically reserves a consultation and reports remaining starts", async () => {
    const now = new Date("2026-09-15T12:00:00.000Z");
    const result = await access.reserveClaraBuyerSession({
      buyerKey: "a".repeat(64),
      consultationId: "51bcaeed-9e1b-4c75-ad05-7b23fbd9d46f",
      accessTokenHash: "b".repeat(64),
      now,
    });
    expect(result).toEqual({
      ok: true,
      remaining: 2,
      resetAt: now.getTime() + 3_600_000,
    });
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.claraConsultation.create).toHaveBeenCalledOnce();
  });

  it("distinguishes an active conversation from the hourly quota", async () => {
    const now = new Date("2026-09-15T12:00:00.000Z");
    tx.claraConsultation.findFirst.mockResolvedValueOnce({
      createdAt: new Date(now.getTime() - 220_000),
    });
    await expect(
      access.reserveClaraBuyerSession({
        buyerKey: "b".repeat(64),
        consultationId: "consultation-a",
        accessTokenHash: "c".repeat(64),
        now,
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "active_session",
      retryAfter: 500,
    });

    tx.claraConsultation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ createdAt: new Date(now.getTime() - 600_000) });
    tx.claraConsultation.count.mockResolvedValueOnce(3);
    await expect(
      access.reserveClaraBuyerSession({
        buyerKey: "b".repeat(64),
        consultationId: "consultation-b",
        accessTokenHash: "c".repeat(64),
        now,
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "start_limit",
      retryAfter: 3000,
    });
  });

  it("fails closed when Neon is unavailable", async () => {
    mockTransaction.mockRejectedValueOnce(new Error("offline"));
    await expect(
      access.reserveClaraBuyerSession({
        buyerKey: "c".repeat(64),
        consultationId: "consultation-c",
        accessTokenHash: "d".repeat(64),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "unavailable",
      retryAfter: 30,
    });
  });
});
