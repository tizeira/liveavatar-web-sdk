/**
 * Shopify Customer Validation Endpoint
 * Validates HMAC token and returns customer data from Liquid template params
 *
 * Flow:
 * 1. Receives customer_id + shopify_token + PII from Shopify iframe URL params
 * 2. Validates HMAC signature (prevents spoofing)
 * 3. Returns customer data directly (no API call needed - Liquid provides all data)
 *
 * Security: Uses timing-safe HMAC comparison
 * Note: Works on all Shopify plans (no Admin API required)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  verifyCustomerToken,
  isValidCustomerId,
  cleanCustomerId,
  isHmacConfigured,
} from "@/src/shopify";
import type {
  ShopifyCustomerRequest,
  ShopifyCustomerResponse,
} from "@/src/shopify";
import { rateLimitByEndpoint } from "@/src/lib/rate-limit";
import { getCachedCustomer, cacheCustomer } from "@/src/lib/db/queries";
import { prisma } from "@/src/lib/db/prisma";
import { logger } from "@/src/lib/logger/secure-logger";

export async function POST(request: NextRequest) {
  // === RATE LIMIT CHECK ===
  const limitResult = await rateLimitByEndpoint(request, "shopify-customer");

  if (!limitResult.success) {
    return NextResponse.json(
      {
        valid: false,
        hasOrders: false,
        customer: null,
        error: "Too many requests",
        message: "Demasiados intentos. Espera un momento antes de reintentar.",
        retryAfter: Math.ceil((limitResult.reset - Date.now()) / 1000),
      },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": limitResult.limit.toString(),
          "X-RateLimit-Remaining": limitResult.remaining.toString(),
          "X-RateLimit-Reset": new Date(limitResult.reset).toISOString(),
          "Retry-After": Math.ceil(
            (limitResult.reset - Date.now()) / 1000,
          ).toString(),
        },
      },
    );
  }

  try {
    // Check if HMAC secret is configured
    if (!isHmacConfigured()) {
      logger.error("SHOPIFY_HMAC_SECRET not configured", null, {
        route: "shopify-customer",
      });
      return NextResponse.json(
        {
          valid: false,
          hasOrders: false,
          customer: null,
          error: "Service not configured",
        },
        { status: 503 },
      );
    }

    // Parse request body
    const body: ShopifyCustomerRequest = await request.json();
    const {
      customer_id,
      shopify_token,
      first_name,
      last_name,
      email,
      orders_count,
      last_order_product,
      last_order_date,
    } = body;

    // 1. Validate required fields
    if (!customer_id || !shopify_token) {
      return NextResponse.json(
        {
          valid: false,
          hasOrders: false,
          customer: null,
          error: "Missing required fields",
        },
        { status: 400 },
      );
    }

    // 2. Validate customer_id format
    const cleanId = cleanCustomerId(customer_id);
    if (!isValidCustomerId(cleanId)) {
      return NextResponse.json(
        {
          valid: false,
          hasOrders: false,
          customer: null,
          error: "Invalid customer_id format",
        },
        { status: 400 },
      );
    }

    // 3. Verify HMAC token (timing-safe)
    if (!verifyCustomerToken(shopify_token, cleanId)) {
      logger.warn(
        "Invalid HMAC token for customer",
        { cleanId },
        {
          route: "shopify-customer",
        },
      );

      // Log invalid token attempt
      try {
        const customerFullName =
          [first_name, last_name].filter(Boolean).join(" ") || null;

        await prisma.session.create({
          data: {
            sessionToken: `shopify_invalid_${cleanId}_${Date.now()}`,
            deviceType: request.headers.get("user-agent")?.includes("Mobile")
              ? "mobile"
              : "desktop",
            status: "error",
            shopifyEmail: email || null,
            shopifyCustomerId: cleanId,
            customerName: customerFullName,
            ordersCount: orders_count ? parseInt(orders_count, 10) : null,
            accessGranted: false,
            verificationStatus: "invalid_token",
          },
        });
        logger.debug(
          "[SESSION TRACKING] Logged invalid token attempt",
          { cleanId },
          { route: "shopify-customer" },
        );
      } catch (trackingError) {
        logger.error("[SESSION TRACKING ERROR]", trackingError, {
          route: "shopify-customer",
        });
      }

      return NextResponse.json(
        {
          valid: false,
          hasOrders: false,
          customer: null,
          error: "Invalid token",
        },
        { status: 401 },
      );
    }

    // === DATABASE CACHE CHECK ===
    // Solo despues de verificar el HMAC. La cache guarda PII, asi que leerla
    // antes de autenticar convertia este endpoint en una fuga de datos: bastaba
    // un POST con {"email": "..."} para recibir nombre, apellido, shopifyId y
    // cantidad de ordenes de cualquier cliente que hubiera usado Clara en las
    // ultimas 24h. Se indexa por cleanId (firmado), nunca por email (no firmado).
    try {
      const cached = await getCachedCustomer(cleanId);
      if (cached) {
        logger.debug("[CACHE HIT] Returning cached customer data", null, {
          route: "shopify-customer",
        });
        return NextResponse.json({
          valid: true,
          hasOrders: (cached.ordersCount || 0) > 0,
          customer: {
            id: cached.shopifyId,
            email: cached.shopifyEmail,
            firstName: cached.firstName,
            lastName: cached.lastName,
            ordersCount: cached.ordersCount || 0,
            skinType: cached.skinType,
            skinConcerns: cached.skinConcerns,
            lastOrderProduct: last_order_product,
            lastOrderDate: last_order_date,
          },
        });
      }
      logger.debug("[CACHE MISS] No cache found", null, {
        route: "shopify-customer",
      });
    } catch (cacheError) {
      // Cache read failed - continue with normal flow
      logger.error("[CACHE ERROR]", cacheError, {
        route: "shopify-customer",
      });
    }

    // 4. HMAC is valid - trust the data from Liquid template
    // No API call needed - Liquid has full access to customer data on all plans
    const ordersCountNum = orders_count ? parseInt(orders_count, 10) : 0;
    const hasOrders = ordersCountNum > 0;

    const response: ShopifyCustomerResponse = {
      valid: true,
      hasOrders,
      customer: {
        id: cleanId,
        email: email || null,
        firstName: first_name || null,
        lastName: last_name || null,
        ordersCount: ordersCountNum,
        lastOrderProduct: last_order_product,
        lastOrderDate: last_order_date,
        // Note: skinType and skinConcerns require metafields in Liquid template
        // Can be added to the iframe URL later if needed
      },
    };

    // === DATABASE CACHE WRITE ===
    // Cache validated customer data (24 hour TTL)
    // Se indexa por cleanId (firmado por HMAC). Antes se indexaba por el email
    // del body, que no esta firmado: un cliente con token propio valido podia
    // escribir nombre y ordersCount arbitrarios bajo el email de otra persona.
    try {
      await cacheCustomer({
        shopifyId: cleanId,
        shopifyEmail: email || undefined,
        firstName: first_name || undefined,
        lastName: last_name || undefined,
        ordersCount: ordersCountNum,
      });
      logger.debug("[CACHE WRITE] Cached customer data", null, {
        route: "shopify-customer",
      });
    } catch (cacheError) {
      // Cache write failed - don't fail the request
      logger.error("[CACHE WRITE ERROR]", cacheError, {
        route: "shopify-customer",
      });
    }

    // === SESSION TRACKING ===
    // Log verification attempt for analytics
    try {
      const customerFullName =
        [first_name, last_name].filter(Boolean).join(" ") || null;

      await prisma.session.create({
        data: {
          sessionToken: `shopify_${cleanId}_${Date.now()}`,
          deviceType: request.headers.get("user-agent")?.includes("Mobile")
            ? "mobile"
            : "desktop",
          status: hasOrders ? "active" : "error",
          shopifyEmail: email || null,
          shopifyCustomerId: cleanId,
          customerName: customerFullName,
          ordersCount: ordersCountNum,
          accessGranted: hasOrders,
          verificationStatus: hasOrders ? "verified" : "no_orders",
        },
      });
      logger.debug(
        "[SESSION TRACKING] Logged verification for customer",
        { cleanId },
        { route: "shopify-customer" },
      );
    } catch (trackingError) {
      // Tracking failed - don't fail the request
      logger.error("[SESSION TRACKING ERROR]", trackingError, {
        route: "shopify-customer",
      });
    }

    return NextResponse.json(response);
  } catch (error) {
    logger.error("Shopify customer validation error", error, {
      route: "shopify-customer",
    });
    return NextResponse.json(
      {
        valid: false,
        hasOrders: false,
        customer: null,
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}

// OPTIONS for CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
