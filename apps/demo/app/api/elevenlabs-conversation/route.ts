import { auth } from "@/auth";
import { ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID } from "../secrets";
import { NextRequest } from "next/server";
import { rateLimitByEndpoint } from "@/src/lib/rate-limit";
import {
  verifyCustomerToken,
  isValidCustomerId,
  cleanCustomerId,
} from "@/src/shopify";
import { logger } from "@/src/lib/logger/secure-logger";

export async function POST(request: Request) {
  // === RATE LIMIT CHECK ===
  const limitResult = await rateLimitByEndpoint(
    request as NextRequest,
    "elevenlabs-conversation",
  );

  if (!limitResult.success) {
    return new Response(
      JSON.stringify({
        error: "Too many requests",
        message: "Por favor espera antes de solicitar una nueva conversación",
        retryAfter: Math.ceil((limitResult.reset - Date.now()) / 1000),
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
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

  // === PARSE REQUEST BODY ===
  let agentId = ELEVENLABS_AGENT_ID;
  let shopifyCustomerId: string | undefined;
  let shopifyToken: string | undefined;

  try {
    const body = await request.json();
    if (body.agentId) {
      agentId = body.agentId;
    }
    // Optional Shopify credentials for iframe users
    shopifyCustomerId = body.customer_id;
    shopifyToken = body.shopify_token;
  } catch {
    // No body or invalid JSON, use defaults
  }

  // === AUTH GUARD ===
  // Allow either:
  // 1. NextAuth session (Google/Credentials login)
  // 2. Valid Shopify HMAC token (iframe users)
  const session = await auth();
  let isShopifyUser = false;

  // Validate Shopify credentials if provided
  if (shopifyCustomerId && shopifyToken) {
    const cleanId = cleanCustomerId(shopifyCustomerId);
    if (
      isValidCustomerId(cleanId) &&
      verifyCustomerToken(shopifyToken, cleanId)
    ) {
      isShopifyUser = true;
      logger.info(
        "Valid Shopify HMAC",
        { customerId: cleanId },
        { route: "/api/elevenlabs-conversation" },
      );
    } else {
      logger.warn(
        "Invalid Shopify HMAC attempt",
        { customerId: cleanId },
        { route: "/api/elevenlabs-conversation" },
      );
    }
  }

  logger.debug(
    "ElevenLabs auth check",
    {
      hasSession: !!session?.user,
      isShopifyUser,
    },
    { route: "/api/elevenlabs-conversation" },
  );

  if (!session?.user && !isShopifyUser) {
    logger.warn("Unauthorized request - no valid session or HMAC", null, {
      route: "/api/elevenlabs-conversation",
    });
    return new Response(
      JSON.stringify({
        error: "Unauthorized",
        message: "Valid session or Shopify credentials required",
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // === DIAGNOSTIC: Check API configuration ===
  if (!ELEVENLABS_API_KEY) {
    logger.error("[ELEVENLABS] API_KEY not configured", null, {
      route: "/api/elevenlabs-conversation",
    });
    return new Response(
      JSON.stringify({
        error: "ElevenLabs API key not configured",
        code: "ELEVENLABS_API_KEY_MISSING",
        service: "elevenlabs",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (!agentId) {
    logger.error("[ELEVENLABS] Agent ID not configured", null, {
      route: "/api/elevenlabs-conversation",
    });
    return new Response(
      JSON.stringify({
        error: "ElevenLabs Agent ID not configured",
        code: "ELEVENLABS_AGENT_ID_MISSING",
        service: "elevenlabs",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  logger.info(
    "[ELEVENLABS] Requesting signed URL",
    {
      agentId,
      hasApiKey: !!ELEVENLABS_API_KEY,
    },
    { route: "/api/elevenlabs-conversation" },
  );

  try {
    // Get signed URL from ElevenLabs Conversational AI API
    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
      {
        method: "GET",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
        },
      },
    );

    if (!res.ok) {
      let errorMessage = "Failed to get signed URL";
      let errorCode = "ELEVENLABS_UNKNOWN_ERROR";
      let errorDetails: string | Record<string, unknown> = {};

      try {
        const errorText = await res.text();
        errorDetails = errorText;

        // Try to parse as JSON for structured errors
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.detail?.message) {
            errorMessage = errorJson.detail.message;
          } else if (errorJson.message) {
            errorMessage = errorJson.message;
          } else if (errorJson.error) {
            errorMessage = errorJson.error;
          }
          errorDetails = errorJson;
        } catch {
          // Keep as text
          errorMessage = errorText || errorMessage;
        }

        // Detect specific error types
        const lowerMsg = errorMessage.toLowerCase();
        if (lowerMsg.includes("subscription") || lowerMsg.includes("expired")) {
          errorCode = "ELEVENLABS_SUBSCRIPTION_EXPIRED";
        } else if (
          lowerMsg.includes("credit") ||
          lowerMsg.includes("quota") ||
          lowerMsg.includes("limit")
        ) {
          errorCode = "ELEVENLABS_QUOTA_EXCEEDED";
        } else if (
          lowerMsg.includes("agent") &&
          (lowerMsg.includes("not found") || lowerMsg.includes("invalid"))
        ) {
          errorCode = "ELEVENLABS_AGENT_NOT_FOUND";
        } else if (
          lowerMsg.includes("unauthorized") ||
          lowerMsg.includes("invalid api")
        ) {
          errorCode = "ELEVENLABS_UNAUTHORIZED";
        } else if (res.status === 401 || res.status === 403) {
          errorCode = "ELEVENLABS_AUTH_FAILED";
        } else if (res.status === 402) {
          errorCode = "ELEVENLABS_PAYMENT_REQUIRED";
        } else if (res.status === 404) {
          errorCode = "ELEVENLABS_AGENT_NOT_FOUND";
        }
      } catch {
        logger.warn("[ELEVENLABS] Could not parse error response", null, {
          route: "/api/elevenlabs-conversation",
        });
      }

      logger.error(
        `[ELEVENLABS] API Error: ${errorCode}`,
        {
          status: res.status,
          statusText: res.statusText,
          errorMessage,
          errorCode,
          agentId,
          errorDetails,
        },
        { route: "/api/elevenlabs-conversation" },
      );

      return new Response(
        JSON.stringify({
          error: errorMessage,
          code: errorCode,
          service: "elevenlabs",
        }),
        {
          status: res.status,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const data = await res.json();
    logger.info(
      "[ELEVENLABS] Signed URL obtained successfully",
      { agentId, hasSignedUrl: !!data.signed_url },
      { route: "/api/elevenlabs-conversation" },
    );

    return new Response(
      JSON.stringify({
        signedUrl: data.signed_url,
        agentId: agentId,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    const err = error as Error;
    const isNetworkError =
      err.message.includes("fetch") ||
      err.message.includes("network") ||
      err.message.includes("ECONNREFUSED") ||
      err.message.includes("ETIMEDOUT");

    logger.error(
      `[ELEVENLABS] ${isNetworkError ? "Network error" : "Unexpected error"}`,
      {
        message: err.message,
        name: err.name,
        stack: err.stack?.split("\n").slice(0, 3).join(" | "),
      },
      { route: "/api/elevenlabs-conversation" },
    );

    return new Response(
      JSON.stringify({
        error: err.message,
        code: isNetworkError
          ? "ELEVENLABS_NETWORK_ERROR"
          : "ELEVENLABS_UNEXPECTED_ERROR",
        service: "elevenlabs",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
