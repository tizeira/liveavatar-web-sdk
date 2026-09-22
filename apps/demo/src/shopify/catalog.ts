import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db/prisma";
import type { ClaraCatalogProduct, ClaraCatalogSnapshotEntry } from "./types";

const CATALOG_SOURCE = "shopify";
const MAX_CATALOG_PRODUCTS = 1_000;

function normalizeCatalogText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseShopifyUpdatedAt(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Shopify catalog contains an invalid updatedAt value");
  }
  return date;
}

function readProductPayload(
  value: Prisma.JsonValue,
): ClaraCatalogProduct | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.handle !== "string" ||
    typeof candidate.availableForSale !== "boolean"
  ) {
    return null;
  }
  return value as unknown as ClaraCatalogProduct;
}

export async function replaceClaraCatalogSnapshot(
  entries: ClaraCatalogSnapshotEntry[],
  syncedAt = new Date(),
) {
  if (entries.length > MAX_CATALOG_PRODUCTS) {
    throw new Error("Clara catalog exceeds the configured safety limit");
  }

  const handles = new Set<string>();
  const productIds = new Set<string>();
  const prepared = entries.map((entry) => {
    const handle = entry.product.handle.trim().toLowerCase();
    if (!handle || handles.has(handle)) {
      throw new Error("Shopify catalog contains an empty or duplicate handle");
    }
    if (!entry.product.id || productIds.has(entry.product.id)) {
      throw new Error(
        "Shopify catalog contains an empty or duplicate product ID",
      );
    }
    handles.add(handle);
    productIds.add(entry.product.id);
    return {
      ...entry,
      product: { ...entry.product, handle },
      shopifyUpdatedAt: parseShopifyUpdatedAt(entry.shopifyUpdatedAt),
    };
  });

  const fingerprint = createHash("sha256")
    .update(
      prepared
        .map(
          ({ product, shopifyUpdatedAt }) =>
            `${product.handle}|${product.id}|${shopifyUpdatedAt.toISOString()}|${product.availableForSale}`,
        )
        .sort()
        .join("\n"),
    )
    .digest("hex");
  const lastShopifyUpdatedAt = prepared.reduce<Date | null>(
    (latest, entry) =>
      !latest || entry.shopifyUpdatedAt > latest
        ? entry.shopifyUpdatedAt
        : latest,
    null,
  );

  // A complete replacement inside one transaction safely handles Shopify
  // handle renames, swaps and reuse without exposing a partially updated set.
  const operations: Prisma.PrismaPromise<unknown>[] = [
    prisma.claraCatalogProduct.deleteMany(),
  ];
  if (prepared.length) {
    operations.push(
      prisma.claraCatalogProduct.createMany({
        data: prepared.map((entry) => ({
          handle: entry.product.handle,
          shopifyProductId: entry.product.id,
          title: entry.product.title,
          payload: entry.product as unknown as Prisma.InputJsonValue,
          searchText: normalizeCatalogText(entry.searchText),
          availableForSale: entry.product.availableForSale,
          shopifyUpdatedAt: entry.shopifyUpdatedAt,
          syncedAt,
        })),
      }),
    );
  }

  operations.push(
    prisma.claraCatalogState.upsert({
      where: { source: CATALOG_SOURCE },
      create: {
        source: CATALOG_SOURCE,
        productCount: prepared.length,
        catalogFingerprint: fingerprint,
        lastShopifyUpdatedAt,
        lastSuccessfulSyncAt: syncedAt,
      },
      update: {
        productCount: prepared.length,
        catalogFingerprint: fingerprint,
        lastShopifyUpdatedAt,
        lastSuccessfulSyncAt: syncedAt,
      },
    }),
  );
  await prisma.$transaction(operations);

  return {
    productCount: prepared.length,
    catalogFingerprint: fingerprint,
    lastShopifyUpdatedAt,
    lastSuccessfulSyncAt: syncedAt,
  };
}

export async function searchSyncedProductsForClara(
  searchTerm: string,
  limit = 5,
): Promise<{ initialized: boolean; products: ClaraCatalogProduct[] }> {
  const [state, rows] = await Promise.all([
    prisma.claraCatalogState.findUnique({
      where: { source: CATALOG_SOURCE },
      select: { source: true },
    }),
    prisma.claraCatalogProduct.findMany({
      where: { availableForSale: true },
      select: { payload: true, searchText: true },
      orderBy: { title: "asc" },
      take: MAX_CATALOG_PRODUCTS,
    }),
  ]);
  if (!state) return { initialized: false, products: [] };

  const normalizedTerm = normalizeCatalogText(searchTerm);
  const tokens = normalizedTerm
    .split(/\s+/)
    .filter((token) => token.length >= 3);
  const products = rows
    .map((row) => {
      const product = readProductPayload(row.payload);
      if (!product) return null;
      const title = normalizeCatalogText(product.title);
      const score =
        (title.includes(normalizedTerm) ? 20 : 0) +
        tokens.reduce(
          (total, token) => total + (row.searchText.includes(token) ? 1 : 0),
          0,
        );
      return { product, score };
    })
    .filter((entry): entry is { product: ClaraCatalogProduct; score: number } =>
      Boolean(entry && entry.score > 0),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(Math.max(limit, 1), 8))
    .map(({ product }) => product);

  return { initialized: true, products };
}
