import { NextRequest, NextResponse } from "next/server";
import { CLARA_AGENT_TOOL_SECRET } from "@/app/api/secrets";
import { hasValidAgentToolSecret } from "@/src/consultations/security";
import { saveClaraRoutine } from "@/src/consultations/repository";
import { ClaraRoutineConflictError } from "@/src/consultations/write-conflict";
import type { ClaraRoutine, ClaraRoutineStep } from "@/src/consultations/types";
import {
  fetchClaraCatalogSnapshot,
  fetchProductsForClaraByHandles,
} from "@/src/shopify/client";
import { listAvailableSyncedProductsForClara } from "@/src/shopify/catalog";
import { sanitizeUserFacingSummary } from "@/src/consultations/privacy";
import {
  consolidateRoutineSteps,
  findUnlinkedRoutineProducts,
} from "@/src/consultations/routine";
import { logger } from "@/src/lib/logger/secure-logger";
import type { ClaraCatalogProduct } from "@/src/shopify/types";

const validMoments = new Set([
  "morning",
  "evening",
  "morning_evening",
  "weekly",
]);

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanStringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item, 180))
    .filter(Boolean)
    .slice(0, maxItems);
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

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const consultationId = cleanText(body.consultation_id, 64);
  const expectedRevision = body.expected_revision;
  if (
    expectedRevision !== undefined &&
    (typeof expectedRevision !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expectedRevision) ||
      Number.isNaN(Date.parse(expectedRevision)))
  ) {
    return NextResponse.json(
      {
        saved: false,
        error:
          "expected_revision must be a valid revision returned by this service",
      },
      { status: 400 },
    );
  }
  const summary = sanitizeUserFacingSummary(cleanText(body.summary, 1200));
  const customerHasMoisturizer =
    typeof body.customer_has_moisturizer === "boolean"
      ? body.customer_has_moisturizer
      : null;
  const rawSteps = Array.isArray(body.steps) ? body.steps.slice(0, 12) : [];
  if (
    !/^[0-9a-f-]{36}$/i.test(consultationId) ||
    !summary ||
    !rawSteps.length
  ) {
    return NextResponse.json(
      { error: "consultation_id, summary and at least one step are required" },
      { status: 400 },
    );
  }

  const steps: ClaraRoutineStep[] = [];
  const requestedHandles = rawSteps.flatMap((rawStep) => {
    if (!rawStep || typeof rawStep !== "object") return [];
    const handle = cleanText(
      (rawStep as Record<string, unknown>).product_handle,
      255,
    ).toLowerCase();
    return handle ? [handle] : [];
  });
  const shopifyStartedAt = performance.now();
  let verifiedProducts: Map<string, ClaraCatalogProduct>;
  try {
    verifiedProducts = await fetchProductsForClaraByHandles(requestedHandles);
  } catch {
    return NextResponse.json(
      { error: "Shopify catalog is temporarily unavailable" },
      { status: 502 },
    );
  }
  const shopifyMs = Math.round(performance.now() - shopifyStartedAt);

  const rejectedProductHandles = [
    ...new Set(
      requestedHandles.filter((handle) => !verifiedProducts.has(handle)),
    ),
  ];
  if (rejectedProductHandles.length) {
    return NextResponse.json({
      saved: false,
      retryable: true,
      error:
        "Some products are unavailable. Search the current catalog and retry before telling the customer the routine was saved.",
      code: "product_unavailable",
      rejected_product_handles: rejectedProductHandles,
    });
  }

  const missingHandleSteps = rawSteps.map((rawStep) => {
    const input =
      rawStep && typeof rawStep === "object"
        ? (rawStep as Record<string, unknown>)
        : {};
    const moment = cleanText(input.moment, 20);
    return {
      instruction: validMoments.has(moment)
        ? cleanText(input.instruction, 300)
        : "",
      productHandle: cleanText(input.product_handle, 255),
    };
  });
  if (
    missingHandleSteps.some((step) => step.instruction && !step.productHandle)
  ) {
    let catalogProducts: ClaraCatalogProduct[];
    try {
      const synced = await listAvailableSyncedProductsForClara();
      catalogProducts = synced.initialized
        ? synced.products
        : (await fetchClaraCatalogSnapshot()).map(({ product }) => product);
    } catch {
      try {
        catalogProducts = (await fetchClaraCatalogSnapshot()).map(
          ({ product }) => product,
        );
      } catch {
        return NextResponse.json(
          { error: "Shopify catalog is temporarily unavailable" },
          { status: 502 },
        );
      }
    }
    const unlinkedProducts = findUnlinkedRoutineProducts(
      missingHandleSteps,
      catalogProducts,
    );
    if (unlinkedProducts.length) {
      return NextResponse.json({
        saved: false,
        retryable: true,
        error:
          "A routine step mentions a current product without its handle. Search the catalog, add the exact product_handle and retry before confirming the save.",
        code: "product_handle_required",
        unlinked_products: unlinkedProducts,
      });
    }
  }

  for (const [index, rawStep] of rawSteps.entries()) {
    if (!rawStep || typeof rawStep !== "object") continue;
    const input = rawStep as Record<string, unknown>;
    const moment = cleanText(input.moment, 20);
    const instruction = cleanText(input.instruction, 300);
    const frequency = cleanText(input.frequency, 120);
    const productHandle = cleanText(input.product_handle, 255).toLowerCase();
    if (!validMoments.has(moment) || !instruction) continue;

    let product = null;
    if (productHandle) {
      product = verifiedProducts.get(productHandle) || null;
    }

    steps.push({
      moment: moment as ClaraRoutineStep["moment"],
      order:
        typeof input.order === "number" && Number.isFinite(input.order)
          ? Math.max(1, Math.floor(input.order))
          : index + 1,
      instruction,
      ...(frequency ? { frequency } : {}),
      product,
    });
  }

  if (!steps.length) {
    return NextResponse.json(
      { error: "No valid routine steps were supplied" },
      { status: 400 },
    );
  }

  const consolidatedSteps = consolidateRoutineSteps(
    steps.sort((a, b) => a.order - b.order),
  );
  const productsRequiringMoisturizer = consolidatedSteps
    .map((step) => step.product)
    .filter(
      (product) =>
        product?.companionCondition === "if_no_moisturizer" &&
        product.companionProducts.length > 0,
    );

  if (productsRequiringMoisturizer.length && customerHasMoisturizer === null) {
    return NextResponse.json(
      {
        error:
          "Ask whether the customer already uses a moisturizer before saving this routine.",
        code: "moisturizer_status_required",
      },
      { status: 422 },
    );
  }

  if (productsRequiringMoisturizer.length && customerHasMoisturizer === false) {
    const savedHandles = new Set(
      consolidatedSteps
        .map((step) => step.product?.handle)
        .filter((handle): handle is string => Boolean(handle)),
    );
    const missingCompanions = productsRequiringMoisturizer.flatMap((product) =>
      product!.companionProducts.some((companion) =>
        savedHandles.has(companion.handle),
      )
        ? []
        : product!.companionProducts,
    );
    if (missingCompanions.length) {
      return NextResponse.json(
        {
          error:
            "The validated companion moisturizer must be included before saving.",
          code: "required_companion_missing",
          required_companion_products: missingCompanions,
        },
        { status: 422 },
      );
    }
  }

  const routine: ClaraRoutine = {
    concerns: cleanStringList(body.concerns, 8),
    cautions: cleanStringList(body.cautions, 8),
    steps: consolidatedSteps,
  };

  try {
    const neonStartedAt = performance.now();
    const saved =
      expectedRevision === undefined
        ? await saveClaraRoutine(consultationId, summary, routine)
        : await saveClaraRoutine(
            consultationId,
            summary,
            routine,
            expectedRevision,
          );
    const neonMs = Math.round(performance.now() - neonStartedAt);
    logger.info(
      "Clara routine tool completed",
      {
        tool_total_ms: Math.round(performance.now() - startedAt),
        shopify_ms: shopifyMs,
        neon_ms: neonMs,
        result_count: routine.steps.length,
        requested_product_count: new Set(requestedHandles).size,
      },
      { route: "/api/agent-tools/save-routine" },
    );
    return NextResponse.json({
      saved: true,
      ...(saved.updatedAt
        ? { routine_revision: saved.updatedAt.toISOString() }
        : {}),
      routine,
      rejected_product_handles: [],
      instruction: "Routine saved with Shopify-validated product data.",
    });
  } catch (error) {
    if (error instanceof ClaraRoutineConflictError) {
      return NextResponse.json(
        {
          saved: false,
          retryable: false,
          code: "routine_revision_conflict",
          instruction:
            "The routine changed. Read the current routine and ask for confirmation again; do not blindly replay an older proposal.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Consultation not found or routine could not be saved" },
      { status: 404 },
    );
  }
}
