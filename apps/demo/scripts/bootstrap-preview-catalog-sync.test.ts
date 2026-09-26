import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  replace: vi.fn(),
  search: vi.fn(),
}));
vi.mock("../src/shopify/client", () => ({
  fetchClaraCatalogSnapshot: mocks.fetch,
}));
vi.mock("../src/shopify/catalog", () => ({
  replaceClaraCatalogSnapshot: mocks.replace,
  searchSyncedProductsForClara: mocks.search,
}));
import { syncPreviewCatalog } from "./bootstrap-preview-catalog-sync";
const originalFetch = globalThis.fetch;
beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  globalThis.fetch = originalFetch;
});
it("rejects an empty Shopify result without replacing the catalog", async () => {
  mocks.fetch.mockResolvedValue([]);
  await expect(syncPreviewCatalog()).rejects.toThrow(
    "PREVIEW_SHOPIFY_CATALOG_EMPTY",
  );
  expect(mocks.replace).not.toHaveBeenCalled();
});
it("leaves the catalog untouched when Shopify fails", async () => {
  mocks.fetch.mockRejectedValue(new Error("upstream failure"));
  await expect(syncPreviewCatalog()).rejects.toThrow();
  expect(mocks.replace).not.toHaveBeenCalled();
});
it("reuses the writer and verifies search without further network access", async () => {
  const product = { id: "123", title: "Beta Hidra" };
  mocks.fetch.mockResolvedValue([{ product }]);
  mocks.replace.mockResolvedValue({ productCount: 1 });
  mocks.search.mockImplementation(async () => {
    await expect(globalThis.fetch("https://example.invalid")).rejects.toThrow(
      "PREVIEW_UNEXPECTED_NETWORK_SEARCH",
    );
    return { initialized: true, products: [product] };
  });
  await expect(syncPreviewCatalog()).resolves.toEqual({
    productCount: 1,
    searchVerified: true,
  });
  expect(globalThis.fetch).toBe(originalFetch);
});
it("restores fetch after a search verification failure", async () => {
  mocks.fetch.mockResolvedValue([
    { product: { id: "123", title: "Beta Hidra" } },
  ]);
  mocks.replace.mockResolvedValue({ productCount: 1 });
  mocks.search.mockResolvedValue({ initialized: false, products: [] });
  await expect(syncPreviewCatalog()).rejects.toThrow(
    "PREVIEW_CATALOG_SEARCH_FAILED",
  );
  expect(globalThis.fetch).toBe(originalFetch);
});
