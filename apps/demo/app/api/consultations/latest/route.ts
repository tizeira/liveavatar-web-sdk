import { NextRequest, NextResponse } from "next/server";
import { SHOPIFY_HMAC_SECRET } from "@/app/api/secrets";
import { getLatestClaraConsultation } from "@/src/consultations/repository";
import { deriveShopifyCustomerKey } from "@/src/consultations/security";
import {
  cleanCustomerId,
  isHmacConfigured,
  isValidCustomerId,
  verifyCustomerToken,
} from "@/src/shopify";

export async function POST(request: NextRequest) {
  if (!isHmacConfigured()) {
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 503 },
    );
  }

  let body: { customer_id?: string; shopify_token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const customerId = cleanCustomerId(body.customer_id || "");
  if (
    !isValidCustomerId(customerId) ||
    !body.shopify_token ||
    !verifyCustomerToken(body.shopify_token, customerId)
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const customerKey = deriveShopifyCustomerKey(customerId, SHOPIFY_HMAC_SECRET);
  const consultation = await getLatestClaraConsultation(customerKey);
  if (!consultation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(consultation, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
