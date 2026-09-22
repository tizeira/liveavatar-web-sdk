import { NextRequest, NextResponse } from "next/server";
import { CRON_SECRET } from "@/app/api/secrets";
import { hasValidCronSecret } from "@/src/consultations/security";
import { replaceClaraCatalogSnapshot } from "@/src/shopify/catalog";
import { fetchClaraCatalogSnapshot } from "@/src/shopify/client";
import { logger } from "@/src/lib/logger/secure-logger";

export async function GET(request: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 503 },
    );
  }
  if (!hasValidCronSecret(request.headers.get("authorization"), CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = performance.now();
  try {
    const snapshot = await fetchClaraCatalogSnapshot();
    const result = await replaceClaraCatalogSnapshot(snapshot);
    logger.info(
      "Clara Shopify catalog sync completed",
      {
        product_count: result.productCount,
        sync_total_ms: Math.round(performance.now() - startedAt),
      },
      { route: "/api/internal/shopify-catalog-sync" },
    );
    return NextResponse.json(
      {
        synced: true,
        product_count: result.productCount,
        last_successful_sync_at: result.lastSuccessfulSyncAt.toISOString(),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    logger.error("Clara Shopify catalog sync failed", error, {
      route: "/api/internal/shopify-catalog-sync",
    });
    return NextResponse.json(
      { error: "Catalog sync failed" },
      { status: 502, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
