import { NextRequest, NextResponse } from "next/server";
import { CLARA_AGENT_TOOL_SECRET } from "@/app/api/secrets";
import { hasValidAgentToolSecret } from "@/src/consultations/security";
import { proposeClaraRoutine } from "@/src/consultations/repository";
import type { ClaraRoutine, ClaraRoutineStep } from "@/src/consultations/types";
import { fetchProductsForClaraByHandles } from "@/src/shopify/client";
import { sanitizeUserFacingSummary } from "@/src/consultations/privacy";
import { consolidateRoutineSteps } from "@/src/consultations/routine";
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
  const rejectedProductHandles: string[] = [];
  const missingProductHandleSteps: number[] = [];
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

  for (const [index, rawStep] of rawSteps.entries()) {
    if (!rawStep || typeof rawStep !== "object") continue;
    const input = rawStep as Record<string, unknown>;
    const moment = cleanText(input.moment, 20);
    const instruction = cleanText(input.instruction, 300);
    const frequency = cleanText(input.frequency, 120);
    const productHandle = cleanText(input.product_handle, 255).toLowerCase();
    if (!validMoments.has(moment) || !instruction) continue;

    // Product names from Clara's own brand must always be tied to a catalog
    // handle. Generic care steps (cleanser, sunscreen, etc.) may remain
    // product-less, but a named Beta recommendation may not be persisted as
    // unverified prose.
    if (!productHandle && /\bbeta(?:\s|[-–—])/i.test(instruction)) {
      missingProductHandleSteps.push(index + 1);
      continue;
    }

    let product = null;
    if (productHandle) {
      product = verifiedProducts.get(productHandle) || null;
      if (!product || !product.availableForSale || !product.url) {
        rejectedProductHandles.push(productHandle);
        product = null;
      }
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

  if (missingProductHandleSteps.length) {
    return NextResponse.json(
      {
        error:
          "Every named Beta Skintech product must include the exact product_handle returned by the catalog search.",
        code: "product_handle_required",
        invalid_steps: missingProductHandleSteps,
      },
      { status: 422 },
    );
  }

  if (rejectedProductHandles.length) {
    return NextResponse.json(
      {
        error:
          "One or more product handles are not available in the validated Shopify catalog. Search again before saving.",
        code: "invalid_product_handle",
        rejected_product_handles: [...new Set(rejectedProductHandles)],
      },
      { status: 422 },
    );
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
    const saved = await proposeClaraRoutine(consultationId, summary, routine);
    const neonMs = Math.round(performance.now() - neonStartedAt);
    const proposedRoutine = saved.consultation.routineProposal as ClaraRoutine;
    logger.info(
      "Clara routine tool completed",
      {
        tool_total_ms: Math.round(performance.now() - startedAt),
        shopify_ms: shopifyMs,
        neon_ms: neonMs,
        result_count: proposedRoutine.steps.length,
        requested_product_count: new Set(requestedHandles).size,
        already_proposed: !saved.created,
      },
      { route: "/api/agent-tools/save-routine" },
    );
    return NextResponse.json({
      saved: false,
      pending_confirmation: true,
      already_proposed: !saved.created,
      routine: proposedRoutine,
      rejected_product_handles: [],
      instruction: saved.created
        ? "Routine proposal created with Shopify-validated product data. Tell the customer to review and confirm it in Mi rutina; do not say it is saved yet."
        : "This consultation already has a pending routine proposal. Do not create or announce another save.",
    });
  } catch {
    return NextResponse.json(
      { error: "Consultation not found or routine could not be saved" },
      { status: 404 },
    );
  }
}
