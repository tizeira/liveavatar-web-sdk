import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStateFindUnique = vi.fn();
const mockProductFindMany = vi.fn();
const mockProductCreateMany = vi.fn();
const mockProductDeleteMany = vi.fn();
const mockStateUpsert = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/src/lib/db/prisma", () => ({
  prisma: {
    claraCatalogState: {
      findUnique: (...args: unknown[]) => mockStateFindUnique(...args),
      upsert: (...args: unknown[]) => mockStateUpsert(...args),
    },
    claraCatalogProduct: {
      findMany: (...args: unknown[]) => mockProductFindMany(...args),
      createMany: (...args: unknown[]) => mockProductCreateMany(...args),
      deleteMany: (...args: unknown[]) => mockProductDeleteMany(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

const {
  listAvailableSyncedProductsForClara,
  replaceClaraCatalogSnapshot,
  searchSyncedProductsForClara,
} = await import("@/src/shopify/catalog");

const product = {
  id: "gid://shopify/Product/1",
  title: "Beta Hidra",
  handle: "beta-hidra",
  description: "Crema hidratante",
  url: "https://example.test/products/beta-hidra",
  imageUrl: null,
  imageAlt: null,
  availableForSale: true,
  price: { amount: "100", currencyCode: "CLP" },
  compareAtPrice: null,
  companionCondition: null,
  companionProducts: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockStateFindUnique.mockResolvedValue({ source: "shopify" });
  mockProductFindMany.mockResolvedValue([]);
  mockProductCreateMany.mockReturnValue({ operation: "createMany" });
  mockProductDeleteMany.mockReturnValue({ operation: "deleteMany" });
  mockStateUpsert.mockReturnValue({ operation: "stateUpsert" });
  mockTransaction.mockResolvedValue([]);
});

describe("Clara durable catalog", () => {
  it("distinguishes an uninitialized catalog from a valid empty search", async () => {
    mockStateFindUnique.mockResolvedValue(null);

    expect(await searchSyncedProductsForClara("hidratación")).toEqual({
      initialized: false,
      products: [],
    });
  });

  it("ranks normalized persisted catalog content", async () => {
    mockProductFindMany.mockResolvedValue([
      {
        payload: product,
        searchText: "beta hidra crema hidratante hidratacion piel deshidratada",
      },
    ]);

    const result = await searchSyncedProductsForClara("hidratación");

    expect(result.initialized).toBe(true);
    expect(result.products.map((item) => item.handle)).toEqual(["beta-hidra"]);
  });

  it("lists only the current synced catalog for product-link validation", async () => {
    mockProductFindMany.mockResolvedValue([{ payload: product }]);

    expect(await listAvailableSyncedProductsForClara()).toEqual({
      initialized: true,
      products: [product],
    });
    expect(mockProductFindMany).toHaveBeenCalledWith({
      where: { availableForSale: true },
      select: { payload: true },
      orderBy: { title: "asc" },
      take: 1_000,
    });
  });

  it("does not list products when the catalog has not been initialized", async () => {
    mockStateFindUnique.mockResolvedValue(null);

    expect(await listAvailableSyncedProductsForClara()).toEqual({
      initialized: false,
      products: [],
    });
    expect(mockProductFindMany).not.toHaveBeenCalled();
  });

  it("persists a complete, valid empty snapshot", async () => {
    const result = await replaceClaraCatalogSnapshot(
      [],
      new Date("2026-09-22T01:00:00.000Z"),
    );

    expect(result.productCount).toBe(0);
    expect(mockProductCreateMany).not.toHaveBeenCalled();
    expect(mockProductDeleteMany).toHaveBeenCalledWith();
    expect(mockTransaction).toHaveBeenCalledWith([
      { operation: "deleteMany" },
      { operation: "stateUpsert" },
    ]);
  });

  it("replaces the snapshot and records sync state atomically", async () => {
    await replaceClaraCatalogSnapshot(
      [
        {
          product,
          searchText: "Beta Hidra hidratación",
          shopifyUpdatedAt: "2026-09-21T12:00:00.000Z",
        },
      ],
      new Date("2026-09-22T01:00:00.000Z"),
    );

    expect(mockProductDeleteMany).toHaveBeenCalledWith();
    expect(mockProductCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          handle: "beta-hidra",
          shopifyProductId: "gid://shopify/Product/1",
        }),
      ],
    });
    expect(mockStateUpsert).toHaveBeenCalledOnce();
    expect(mockTransaction).toHaveBeenCalledWith([
      { operation: "deleteMany" },
      { operation: "createMany" },
      { operation: "stateUpsert" },
    ]);
  });

  it("accepts handle renames because the transaction replaces the complete set", async () => {
    await replaceClaraCatalogSnapshot([
      {
        product: { ...product, handle: "beta-hidra-nueva" },
        searchText: "Beta Hidra hidratación",
        shopifyUpdatedAt: "2026-09-21T12:00:00.000Z",
      },
    ]);

    expect(mockTransaction).toHaveBeenCalledWith([
      { operation: "deleteMany" },
      { operation: "createMany" },
      { operation: "stateUpsert" },
    ]);
    expect(mockProductCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ handle: "beta-hidra-nueva" })],
    });
  });
});
