import { auth } from "@/auth";
import {
  API_KEY,
  API_URL,
  AVATAR_ID_MOBILE,
  AVATAR_ID_DESKTOP,
  HEYGEN_ELEVENLABS_SECRET_ID,
  ELEVENLABS_AGENT_ID,
  CHROMA_KEY_ENABLED,
} from "../secrets";
import { NextRequest } from "next/server";
import { rateLimitByEndpoint } from "@/src/lib/rate-limit";
import { createSession } from "@/src/lib/db/queries";
import {
  verifyCustomerToken,
  isValidCustomerId,
  cleanCustomerId,
} from "@/src/shopify";
import { logger } from "@/src/lib/logger/secure-logger";

export async function POST(request: Request) {
  // === RATE LIMIT CHECK ===
  // Cast to NextRequest for rate limiting (headers are compatible)
  const limitResult = await rateLimitByEndpoint(
    request as NextRequest,
    "start-custom-session",
  );

  if (!limitResult.success) {
    return new Response(
      JSON.stringify({
        error: "Too many requests",
        message: "Por favor espera unos minutos antes de intentar nuevamente",
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
  let deviceType: "mobile" | "desktop" = "desktop";
  let shopifyCustomerId: string | undefined;
  let shopifyToken: string | undefined;

  try {
    const body = await request.json();
    if (body.deviceType === "mobile") {
      deviceType = "mobile";
    }
    // Optional Shopify credentials for iframe users
    shopifyCustomerId = body.customer_id;
    shopifyToken = body.shopify_token;
  } catch {
    // No body or invalid JSON, use default (desktop)
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
        { route: "/api/start-custom-session" },
      );
    } else {
      logger.warn(
        "Invalid Shopify HMAC attempt",
        { customerId: cleanId },
        { route: "/api/start-custom-session" },
      );
    }
  }

  if (!session?.user && !isShopifyUser) {
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

  let session_token = "";
  let session_id = "";

  // Select avatar based on device type
  const avatarId =
    deviceType === "desktop" ? AVATAR_ID_DESKTOP : AVATAR_ID_MOBILE;

  // === DIAGNOSTIC: Check API configuration ===
  if (!API_KEY) {
    logger.error("[HEYGEN] API_KEY not configured", null, {
      route: "/api/start-custom-session",
    });
    return new Response(
      JSON.stringify({
        error: "HeyGen API not configured",
        code: "HEYGEN_API_KEY_MISSING",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!HEYGEN_ELEVENLABS_SECRET_ID) {
    logger.error("[HEYGEN] HEYGEN_ELEVENLABS_SECRET_ID not configured", null, {
      route: "/api/start-custom-session",
    });
    return new Response(
      JSON.stringify({
        error: "ElevenLabs plugin not configured",
        code: "HEYGEN_ELEVENLABS_SECRET_MISSING",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  logger.info(
    "[HEYGEN] Starting LITE+ElevenLabs Plugin session",
    {
      avatarId,
      deviceType,
      apiUrl: API_URL,
      hasApiKey: !!API_KEY,
      hasSecretId: !!HEYGEN_ELEVENLABS_SECRET_ID,
      agentId: ELEVENLABS_AGENT_ID,
    },
    { route: "/api/start-custom-session" },
  );

  try {
    const heygenPayload = {
      mode: "LITE",
      avatar_id: avatarId,
      elevenlabs_agent_config: {
        secret_id: HEYGEN_ELEVENLABS_SECRET_ID,
        agent_id: ELEVENLABS_AGENT_ID,
      },
    };

    logger.debug("[HEYGEN] Request payload", heygenPayload, {
      route: "/api/start-custom-session",
    });

    const res = await fetch(`${API_URL}/v1/sessions/token`, {
      method: "POST",
      headers: {
        "X-API-KEY": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(heygenPayload),
    });

    if (!res.ok) {
      let errorMessage = "Failed to retrieve session token";
      let errorCode = "HEYGEN_UNKNOWN_ERROR";
      let errorDetails: Record<string, unknown> = {};

      try {
        const errorData = await res.json();
        errorDetails = errorData;

        // Extract error message from various HeyGen response formats
        if (errorData.data?.[0]?.message) {
          errorMessage = errorData.data[0].message;
        } else if (errorData.error) {
          errorMessage =
            typeof errorData.error === "string"
              ? errorData.error
              : JSON.stringify(errorData.error);
        } else if (errorData.message) {
          errorMessage = errorData.message;
        }

        // Detect specific error types for better diagnostics
        const lowerMsg = errorMessage.toLowerCase();
        if (lowerMsg.includes("subscription") || lowerMsg.includes("expired")) {
          errorCode = "HEYGEN_SUBSCRIPTION_EXPIRED";
        } else if (lowerMsg.includes("credit") || lowerMsg.includes("quota")) {
          errorCode = "HEYGEN_QUOTA_EXCEEDED";
        } else if (lowerMsg.includes("rate") || lowerMsg.includes("limit")) {
          errorCode = "HEYGEN_RATE_LIMITED";
        } else if (
          lowerMsg.includes("avatar") ||
          lowerMsg.includes("not found")
        ) {
          errorCode = "HEYGEN_AVATAR_NOT_FOUND";
        } else if (
          lowerMsg.includes("unauthorized") ||
          lowerMsg.includes("invalid")
        ) {
          errorCode = "HEYGEN_UNAUTHORIZED";
        } else if (res.status === 401 || res.status === 403) {
          errorCode = "HEYGEN_AUTH_FAILED";
        } else if (res.status === 402) {
          errorCode = "HEYGEN_PAYMENT_REQUIRED";
        }
      } catch {
        logger.warn("[HEYGEN] Could not parse error response body", null, {
          route: "/api/start-custom-session",
        });
      }

      logger.error(
        `[HEYGEN] API Error: ${errorCode}`,
        {
          status: res.status,
          statusText: res.statusText,
          errorMessage,
          errorCode,
          avatarId,
          errorDetails,
        },
        { route: "/api/start-custom-session" },
      );

      return new Response(
        JSON.stringify({
          error: errorMessage,
          code: errorCode,
          service: "heygen",
        }),
        {
          status: res.status,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const data = await res.json();
    logger.info(
      "[HEYGEN] Session created successfully",
      {
        sessionId: data.data?.session_id,
        hasToken: !!data.data?.session_token,
      },
      {
        route: "/api/start-custom-session",
      },
    );

    session_token = data.data.session_token;
    session_id = data.data.session_id;
  } catch (error: unknown) {
    const err = error as Error;
    const isNetworkError =
      err.message.includes("fetch") ||
      err.message.includes("network") ||
      err.message.includes("ECONNREFUSED") ||
      err.message.includes("ETIMEDOUT");

    logger.error(
      `[HEYGEN] ${isNetworkError ? "Network error" : "Unexpected error"}`,
      {
        message: err.message,
        name: err.name,
        stack: err.stack?.split("\n").slice(0, 3).join(" | "),
      },
      { route: "/api/start-custom-session" },
    );

    return new Response(
      JSON.stringify({
        error: err.message,
        code: isNetworkError
          ? "HEYGEN_NETWORK_ERROR"
          : "HEYGEN_UNEXPECTED_ERROR",
        service: "heygen",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (!session_token) {
    logger.error("[HEYGEN] Empty session token received", null, {
      route: "/api/start-custom-session",
    });
    return new Response(
      JSON.stringify({
        error: "Failed to retrieve session token",
        code: "HEYGEN_EMPTY_TOKEN",
        service: "heygen",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // === DATABASE TRACKING ===
  // Track session in database for analytics (non-blocking)
  try {
    await createSession({
      sessionToken: session_token,
      deviceType,
      userId: session?.user?.id,
      shopifyEmail: session?.user?.email || undefined,
    });
    logger.debug(
      "[DB] Session tracked",
      { sessionId: session_id },
      {
        route: "/api/start-custom-session",
      },
    );
  } catch (dbError) {
    // Don't fail the request if DB tracking fails - just log it
    const err = dbError as Error;
    logger.warn(
      "[DB] Failed to track session (non-critical)",
      {
        message: err.message,
        name: err.name,
        // Detect common Prisma/DB issues
        isPrismaError: err.name?.includes("Prisma"),
        isConnectionError: err.message?.includes("connect"),
      },
      { route: "/api/start-custom-session" },
    );
  }

  return new Response(
    JSON.stringify({
      session_token,
      session_id,
      chroma_key_enabled: CHROMA_KEY_ENABLED,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}
