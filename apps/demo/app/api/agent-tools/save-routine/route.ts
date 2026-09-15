import { NextRequest, NextResponse } from "next/server";
import { CLARA_AGENT_TOOL_SECRET } from "@/app/api/secrets";
import { hasValidAgentToolSecret } from "@/src/consultations/security";
import { saveClaraRoutine } from "@/src/consultations/repository";
import type { ClaraRoutine, ClaraRoutineStep } from "@/src/consultations/types";
import { fetchProductForClaraByHandle } from "@/src/shopify/client";

const validMoments = new Set(["morning", "evening", "weekly"]);

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
  const summary = cleanText(body.summary, 1200);
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
      product = await fetchProductForClaraByHandle(productHandle);
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

  if (!steps.length) {
    return NextResponse.json(
      { error: "No valid routine steps were supplied" },
      { status: 400 },
    );
  }

  const routine: ClaraRoutine = {
    concerns: cleanStringList(body.concerns, 8),
    cautions: cleanStringList(body.cautions, 8),
    steps: steps.sort((a, b) => a.order - b.order),
  };

  try {
    await saveClaraRoutine(consultationId, summary, routine);
    return NextResponse.json({
      saved: true,
      routine,
      rejected_product_handles: rejectedProductHandles,
      instruction: rejectedProductHandles.length
        ? "Some product handles were not valid Shopify products and were omitted. Do not mention or link them."
        : "Routine saved with Shopify-validated product data.",
    });
  } catch {
    return NextResponse.json(
      { error: "Consultation not found or routine could not be saved" },
      { status: 404 },
    );
  }
}
