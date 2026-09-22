import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

process.env.CRON_SECRET = "test-cron-secret";

const mockFetchSnapshot = vi.fn();
const mockReplaceSnapshot = vi.fn();
const snapshotFixture = [{ product: { handle: "beta-hidra" } }];

vi.mock("@/src/shopify/client", () => ({
  fetchClaraCatalogSnapshot: (...args: unknown[]) => mockFetchSnapshot(...args),
}));

vi.mock("@/src/shopify/catalog", () => ({
  replaceClaraCatalogSnapshot: (...args: unknown[]) =>
    mockReplaceSnapshot(...args),
}));

const { GET } = await import("@/app/api/internal/shopify-catalog-sync/route");

function request(secret?: string) {
  return new NextRequest("http://localhost/api/internal/shopify-catalog-sync", {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchSnapshot.mockResolvedValue(snapshotFixture);
  mockReplaceSnapshot.mockResolvedValue({
    productCount: 1,
    lastSuccessfulSyncAt: new Date("2026-09-22T01:00:00.000Z"),
  });
});

describe("GET /api/internal/shopify-catalog-sync", () => {
  it("requires the configured cron secret", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("wrong"))).status).toBe(401);
    expect(mockFetchSnapshot).not.toHaveBeenCalled();
  });

  it("persists one complete Shopify snapshot for an authorized scheduler", async () => {
    const response = await GET(request("test-cron-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      synced: true,
      product_count: 1,
      last_successful_sync_at: "2026-09-22T01:00:00.000Z",
    });
    expect(mockReplaceSnapshot).toHaveBeenCalledWith(snapshotFixture);
  });

  it("persists a valid empty snapshot when no products remain available", async () => {
    mockFetchSnapshot.mockResolvedValue([]);
    mockReplaceSnapshot.mockResolvedValue({
      productCount: 0,
      lastSuccessfulSyncAt: new Date("2026-09-22T02:00:00.000Z"),
    });

    const response = await GET(request("test-cron-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      synced: true,
      product_count: 0,
      last_successful_sync_at: "2026-09-22T02:00:00.000Z",
    });
    expect(mockReplaceSnapshot).toHaveBeenCalledWith([]);
  });

  it("fails closed without replacing the last good snapshot", async () => {
    mockFetchSnapshot.mockRejectedValue(new Error("Shopify unavailable"));

    const response = await GET(request("test-cron-secret"));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Catalog sync failed" });
    expect(mockReplaceSnapshot).not.toHaveBeenCalled();
  });
});
