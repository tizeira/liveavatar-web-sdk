import { NextRequest, NextResponse } from "next/server";
import { CLARA_AGENT_TOOL_SECRET } from "@/app/api/secrets";
import { hasValidAgentToolSecret } from "@/src/consultations/security";
import { searchProductsForClara } from "@/src/shopify/client";

export async function POST(request: NextRequest) {
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
    const products = await searchProductsForClara(query);
    return NextResponse.json({
      products,
      instruction:
        products.length > 0
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
