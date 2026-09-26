import { fetchClaraCatalogSnapshot } from "../src/shopify/client";
import {
  replaceClaraCatalogSnapshot,
  searchSyncedProductsForClara,
} from "../src/shopify/catalog";

export async function syncPreviewCatalog() {
  const snapshot = await fetchClaraCatalogSnapshot();
  if (!snapshot.length) throw new Error("PREVIEW_SHOPIFY_CATALOG_EMPTY");
  const result = await replaceClaraCatalogSnapshot(snapshot);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error("PREVIEW_UNEXPECTED_NETWORK_SEARCH");
    };
    const found = await searchSyncedProductsForClara(
      snapshot[0]!.product.title,
      8,
    );
    if (
      !found.initialized ||
      !found.products.some((product) => product.id === snapshot[0]!.product.id)
    )
      throw new Error("PREVIEW_CATALOG_SEARCH_FAILED");
    return { productCount: result.productCount, searchVerified: true };
  } finally {
    globalThis.fetch = originalFetch;
  }
}
