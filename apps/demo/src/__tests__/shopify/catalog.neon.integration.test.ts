import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/db/prisma";
import {
  replaceClaraCatalogSnapshot,
  searchSyncedProductsForClara,
} from "@/src/shopify/catalog";
import type { ClaraCatalogProduct } from "@/src/shopify/types";

const enabled = process.env.RUN_NEON_INTEGRATION === "1";
const liveSyncEnabled =
  enabled &&
  Boolean(
    process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
  );

function product(
  id: string,
  handle: string,
  title: string,
): ClaraCatalogProduct {
  return {
    id: `gid://shopify/Product/${id}`,
    title,
    handle,
    description: "Producto ficticio para prueba aislada",
    url: `https://example.test/products/${handle}`,
    imageUrl: null,
    imageAlt: null,
    availableForSale: true,
    price: { amount: "100", currencyCode: "CLP" },
    compareAtPrice: null,
    companionCondition: null,
    companionProducts: [],
  };
}

describe.skipIf(!enabled)("Clara catalog against isolated Neon", () => {
  afterAll(async () => {
    await prisma.claraCatalogProduct.deleteMany();
    await prisma.claraCatalogState.deleteMany({ where: { source: "shopify" } });
    await prisma.$disconnect();
  });

  it("atomically replaces, searches, swaps handles and accepts an empty catalog", async () => {
    await prisma.claraCatalogProduct.deleteMany();
    await prisma.claraCatalogState.deleteMany({ where: { source: "shopify" } });

    const first = product("integration-a", "catalog-a", "Hidratante A");
    const second = product("integration-b", "catalog-b", "Limpiador B");
    const updatedAt = "2026-09-21T20:00:00.000Z";

    await replaceClaraCatalogSnapshot([
      {
        product: first,
        searchText: "hidratacion piel seca",
        shopifyUpdatedAt: updatedAt,
      },
      {
        product: second,
        searchText: "limpieza piel",
        shopifyUpdatedAt: updatedAt,
      },
    ]);

    const search = await searchSyncedProductsForClara("hidratacion");
    expect(search.initialized).toBe(true);
    expect(search.products.map((item) => item.id)).toEqual([first.id]);

    await replaceClaraCatalogSnapshot([
      {
        product: { ...first, handle: second.handle },
        searchText: "hidratacion piel seca",
        shopifyUpdatedAt: updatedAt,
      },
      {
        product: { ...second, handle: first.handle },
        searchText: "limpieza piel",
        shopifyUpdatedAt: updatedAt,
      },
    ]);

    expect(
      await prisma.claraCatalogProduct.findMany({
        orderBy: { shopifyProductId: "asc" },
        select: { shopifyProductId: true, handle: true },
      }),
    ).toEqual([
      { shopifyProductId: first.id, handle: second.handle },
      { shopifyProductId: second.id, handle: first.handle },
    ]);

    await replaceClaraCatalogSnapshot([]);

    expect(await prisma.claraCatalogProduct.count()).toBe(0);
    expect(
      await prisma.claraCatalogState.findUnique({
        where: { source: "shopify" },
      }),
    ).toEqual(expect.objectContaining({ productCount: 0 }));
    expect(await searchSyncedProductsForClara("hidratacion")).toEqual({
      initialized: true,
      products: [],
    });
  }, 30_000);
});

describe.skipIf(!liveSyncEnabled)(
  "Clara catalog sync from Shopify into isolated Neon",
  () => {
    it("fetches and persists the real catalog", async () => {
      const { fetchClaraCatalogSnapshot } = await import(
        "@/src/shopify/client"
      );
      const snapshot = await fetchClaraCatalogSnapshot();
      const result = await replaceClaraCatalogSnapshot(snapshot);

      expect(snapshot.length).toBeGreaterThan(0);
      expect(result.productCount).toBe(snapshot.length);
      expect(await prisma.claraCatalogProduct.count()).toBe(snapshot.length);
      expect(
        await prisma.claraCatalogState.findUnique({
          where: { source: "shopify" },
          select: { productCount: true },
        }),
      ).toEqual({ productCount: snapshot.length });
      expect(
        await prisma.claraCatalogProduct.findUnique({
          where: { shopifyProductId: snapshot[0]!.product.id },
          select: { handle: true },
        }),
      ).toEqual({ handle: snapshot[0]!.product.handle });

      const searchTerm =
        snapshot[0]!.product.title
          .split(/\s+/)
          .find((token) => token.length >= 3) ?? snapshot[0]!.product.title;
      expect(
        (await searchSyncedProductsForClara(searchTerm)).products.map(
          (item) => item.id,
        ),
      ).toContain(snapshot[0]!.product.id);
    }, 60_000);
  },
);
