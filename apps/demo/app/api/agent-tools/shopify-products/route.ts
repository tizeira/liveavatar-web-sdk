import { NextRequest, NextResponse } from "next/server";
import { CLARA_AGENT_TOOL_SECRET } from "@/app/api/secrets";
import { hasValidAgentToolSecret } from "@/src/consultations/security";
import { searchProductsForClara } from "@/src/shopify/client";
import { createHash } from "node:crypto";
import type { ClaraCatalogProduct } from "@/src/shopify/types";
import { logger } from "@/src/lib/logger/secure-logger";

const CATALOG_CACHE_SECONDS = 4 * 60;
const CATALOG_CACHE_MAX_ENTRIES = 100;
const catalogCache = new Map<
  string,
  { expiresAt: number; products: ClaraCatalogProduct[] }
>();

function readCatalogCache(key: string): ClaraCatalogProduct[] | null {
  const cached = catalogCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    catalogCache.delete(key);
    return null;
  }
  return cached.products;
}

function writeCatalogCache(key: string, products: ClaraCatalogProduct[]) {
  if (catalogCache.size >= CATALOG_CACHE_MAX_ENTRIES) {
    const oldestKey = catalogCache.keys().next().value;
    if (oldestKey) catalogCache.delete(oldestKey);
  }
  catalogCache.set(key, {
    expiresAt: Date.now() + CATALOG_CACHE_SECONDS * 1000,
    products,
  });
}

function compactProduct(product: ClaraCatalogProduct) {
  return {
    ...product,
    description:
      typeof product.description === "string"
        ? product.description.slice(0, 480)
        : "",
  };
}

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  if (
    !hasValidAgentToolSecret(
      request.headers.get("authorization"),
      CLARA_AGENT_TOOL_SECRET,
    )
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const query =
    body && typeof body === "object" && "query" in body
      ? String(body.query || "").trim()
      : "";
  if (query.length < 2 || query.length > 120) {
    return NextResponse.json(
      { error: "query must contain between 2 and 120 characters" },
      { status: 400 },
    );
  }

  try {
    const normalizedQuery = query
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ");
    const cacheKey = `clara:catalog-search:${createHash("sha256")
      .update(normalizedQuery)
      .digest("hex")}`;
    let products = readCatalogCache(cacheKey);
    const cacheHit = Array.isArray(products);

    const shopifyStartedAt = performance.now();
    if (!products) {
      products = await searchProductsForClara(query);
      writeCatalogCache(cacheKey, products);
    }
    const shopifyMs = cacheHit
      ? 0
      : Math.round(performance.now() - shopifyStartedAt);
    const compactProducts = products.map(compactProduct);
    logger.info(
      "Clara Shopify search tool completed",
      {
        tool_total_ms: Math.round(performance.now() - startedAt),
        shopify_ms: shopifyMs,
        cache_hit: cacheHit,
        result_count: compactProducts.length,
      },
      { route: "/api/agent-tools/shopify-products" },
    );
    return NextResponse.json({
      products: compactProducts,
      instruction:
        compactProducts.length > 0
          ? "Recommend only products returned here and preserve each exact handle and URL."
          : "No matching published product was found. Do not invent a product or URL.",
    });
  } catch {
    return NextResponse.json(
      { error: "Shopify catalog is temporarily unavailable" },
      { status: 502 },
    );
  }
}
