import { NextRequest, NextResponse } from "next/server";
import { SHOPIFY_HMAC_SECRET } from "@/app/api/secrets";
import {
  cleanCustomerId,
  isValidCustomerId,
  verifyClaraShopifyAccessToken,
  verifyCustomerToken,
} from "@/src/shopify";
import { fetchCustomerById } from "@/src/shopify/client";
import { deriveShopifyCustomerKey } from "@/src/consultations/security";
import {
  CLARA_BUYER_COOKIE_NAME,
  CLARA_BUYER_TICKET_TTL_SECONDS,
  issueClaraBuyerTicket,
  readClaraBuyerTicket,
} from "@/src/lib/clara-buyer-access";
import { rateLimitByEndpoint } from "@/src/lib/rate-limit";
import { logger } from "@/src/lib/logger/secure-logger";

function cleanText(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function customerResponse(ticket: {
  firstName: string | null;
  ordersCount: number;
  lastOrderProduct: string | null;
  lastOrderDate: string | null;
}) {
  return {
    valid: true,
    hasOrders: ticket.ordersCount > 0,
    customer: {
      firstName: ticket.firstName,
      ordersCount: ticket.ordersCount,
      lastOrderProduct: ticket.lastOrderProduct,
      lastOrderDate: ticket.lastOrderDate,
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const ticket = await readClaraBuyerTicket(
      request.cookies.get(CLARA_BUYER_COOKIE_NAME)?.value,
    );
    if (!ticket) {
      return NextResponse.json({ valid: false }, { status: 401 });
    }
    return NextResponse.json(customerResponse(ticket), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(
      { valid: false, error: "Access service unavailable" },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  const broadLimit = await rateLimitByEndpoint(request, "shopify-access");
  if (!broadLimit.success) {
    const retryAfter = Math.max(
      1,
      Math.ceil((broadLimit.reset - Date.now()) / 1000),
    );
    return NextResponse.json(
      { valid: false, error: "Too many requests", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { valid: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const customerId = cleanCustomerId(cleanText(body.customer_id, 64) || "");
  const token = cleanText(body.shopify_token, 256) || "";
  if (!SHOPIFY_HMAC_SECRET || !isValidCustomerId(customerId) || !token) {
    return NextResponse.json(
      { valid: false, error: "Invalid access" },
      { status: 401 },
    );
  }

  const version = cleanText(body.clara_v, 8);
  const suppliedOrders = Number(body.orders_count);
  const suppliedIssuedAt = Number(body.issued_at);
  let verifiedOrdersCount = 0;
  let mode: "signed_v2" | "legacy_verified";

  if (
    version === "2" &&
    verifyClaraShopifyAccessToken(token, {
      customerId,
      ordersCount: suppliedOrders,
      issuedAt: suppliedIssuedAt,
      version,
    })
  ) {
    verifiedOrdersCount = suppliedOrders;
    mode = "signed_v2";
  } else if (!version && verifyCustomerToken(token, customerId)) {
    // Transitional QA compatibility. The old signature authenticates only the
    // customer ID, so purchase eligibility is re-read from Shopify and the
    // unsigned orders_count parameter is never trusted.
    try {
      const customer = await fetchCustomerById(customerId);
      if (!customer) {
        return NextResponse.json(
          { valid: false, error: "Customer not found" },
          { status: 401 },
        );
      }
      verifiedOrdersCount = customer.numberOfOrders;
      mode = "legacy_verified";
    } catch {
      return NextResponse.json(
        { valid: false, error: "Purchase verification unavailable" },
        { status: 503 },
      );
    }
  } else {
    logger.warn("Invalid Clara Shopify access signature", null, {
      route: "/api/shopify-access",
    });
    return NextResponse.json(
      { valid: false, error: "Invalid access" },
      { status: 401 },
    );
  }

  if (verifiedOrdersCount < 1) {
    return NextResponse.json(
      { valid: true, hasOrders: false, error: "Purchase required" },
      { status: 403 },
    );
  }

  const ticketData = {
    buyerKey: deriveShopifyCustomerKey(customerId, SHOPIFY_HMAC_SECRET),
    firstName: cleanText(body.first_name, 80),
    ordersCount: verifiedOrdersCount,
    lastOrderProduct: cleanText(body.last_order_product, 240),
    lastOrderDate: cleanText(body.last_order_date, 80),
    issuedAt: Math.floor(Date.now() / 1000),
  };

  try {
    const opaqueToken = await issueClaraBuyerTicket(ticketData);
    const response = NextResponse.json(
      { ...customerResponse(ticketData), accessMode: mode },
      { headers: { "Cache-Control": "private, no-store" } },
    );
    response.cookies.set(CLARA_BUYER_COOKIE_NAME, opaqueToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: CLARA_BUYER_TICKET_TTL_SECONDS,
    });
    return response;
  } catch {
    return NextResponse.json(
      { valid: false, error: "Access service unavailable" },
      { status: 503 },
    );
  }
}
