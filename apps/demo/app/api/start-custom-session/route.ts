import { auth } from "@/auth";
import {
  API_KEY,
  API_URL,
  AVATAR_ID_MOBILE,
  AVATAR_ID_DESKTOP,
  HEYGEN_ELEVENLABS_SECRET_ID,
  ELEVENLABS_AGENT_ID,
  CHROMA_KEY_ENABLED,
  CHROMA_MIN_HUE,
  CHROMA_MAX_HUE,
  CHROMA_MIN_SATURATION,
  CHROMA_EDGE_SHARPNESS,
  CHROMA_BG_URL_DESKTOP,
  CHROMA_BG_URL_MOBILE,
  SHOPIFY_HMAC_SECRET,
} from "../secrets";
import { NextRequest } from "next/server";
import { rateLimitByEndpoint } from "@/src/lib/rate-limit";
import { logger } from "@/src/lib/logger/secure-logger";
import { randomBytes, randomUUID } from "node:crypto";
import {
  createClaraConsultation,
  getRecentClaraConversationMemory,
} from "@/src/consultations/repository";
import type { ClaraConversationMemory } from "@/src/consultations/types";
import { hashConsultationAccessToken } from "@/src/consultations/security";
import {
  CLARA_BUYER_COOKIE_NAME,
  deriveAuthenticatedTesterKey,
  readClaraBuyerTicket,
  releaseClaraBuyerSession,
  reserveClaraBuyerSession,
} from "@/src/lib/clara-buyer-access";

function identifierSuffix(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(-6) : null;
}

export async function POST(request: NextRequest) {
  // === RATE LIMIT CHECK ===
  // Cast to NextRequest for rate limiting (headers are compatible)
  const limitResult = await rateLimitByEndpoint(
    request,
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

  try {
    const body = await request.json();
    if (body.deviceType === "mobile") {
      deviceType = "mobile";
    }
  } catch {
    // No body or invalid JSON, use default (desktop)
  }

  // === AUTH GUARD ===
  // Paid browser sessions use an opaque HttpOnly ticket issued only after a
  // purchase-aware Shopify verification. NextAuth remains a QA tester path.
  const session = await auth();
  let buyerTicket = null;
  try {
    buyerTicket = await readClaraBuyerTicket(
      request.cookies.get(CLARA_BUYER_COOKIE_NAME)?.value,
    );
  } catch {
    return new Response(
      JSON.stringify({
        error: "Access service unavailable",
        code: "CLARA_LIMITER_UNAVAILABLE",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!session?.user && !buyerTicket) {
    return new Response(
      JSON.stringify({
        error: "Unauthorized",
        message: "Valid buyer access or tester session required",
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  let session_token = "";
  let session_id = "";
  let conversationMemory: ClaraConversationMemory = [];
  const consultationId = randomUUID();
  const consultationAccessToken = randomBytes(32).toString("base64url");
  let shopifyCustomerKey = buyerTicket?.buyerKey;
  let rateLimitBuyerKey = shopifyCustomerKey;
  if (!rateLimitBuyerKey && session?.user?.email && SHOPIFY_HMAC_SECRET) {
    rateLimitBuyerKey = deriveAuthenticatedTesterKey(
      session.user.email,
      SHOPIFY_HMAC_SECRET,
    );
    shopifyCustomerKey = rateLimitBuyerKey;
  }

  if (!rateLimitBuyerKey) {
    return new Response(
      JSON.stringify({
        error: "Unauthorized",
        message: "A buyer identity is required",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

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

  const reservation = await reserveClaraBuyerSession(
    rateLimitBuyerKey,
    consultationId,
  );
  if (!reservation.ok) {
    const status =
      reservation.reason === "active_session"
        ? 409
        : reservation.reason === "start_limit"
          ? 429
          : 503;
    const message =
      reservation.reason === "active_session"
        ? "Ya hay una conversación de Clara activa para este comprador."
        : reservation.reason === "start_limit"
          ? "Alcanzaste el máximo de tres conversaciones por hora."
          : "El control de acceso está temporalmente fuera de servicio.";
    return new Response(
      JSON.stringify({
        error: message,
        code: `CLARA_${reservation.reason.toUpperCase()}`,
        retryAfter: reservation.retryAfter,
      }),
      {
        status,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(reservation.retryAfter),
        },
      },
    );
  }

  const releaseReservation = () =>
    releaseClaraBuyerSession(rateLimitBuyerKey, consultationId);

  logger.info(
    "[HEYGEN] Starting LITE+ElevenLabs Plugin session",
    {
      avatarIdSuffix: identifierSuffix(avatarId),
      deviceType,
      apiUrl: API_URL,
      hasApiKey: !!API_KEY,
      hasSecretId: !!HEYGEN_ELEVENLABS_SECRET_ID,
      agentIdSuffix: identifierSuffix(ELEVENLABS_AGENT_ID),
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
        dynamic_variables: {
          // Correlates the provider's post-call webhook with this browser
          // session. The separate recap access token is never sent upstream.
          consultation_id: consultationId,
        },
      },
    };

    logger.debug(
      "[HEYGEN] Request payload prepared",
      {
        mode: heygenPayload.mode,
        avatarIdSuffix: identifierSuffix(avatarId),
        agentIdSuffix: identifierSuffix(ELEVENLABS_AGENT_ID),
        dynamicVariableNames: ["consultation_id"],
      },
      { route: "/api/start-custom-session" },
    );

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
          errorCode,
          avatarIdSuffix: identifierSuffix(avatarId),
          errorDetailKeys: Object.keys(errorDetails),
        },
        { route: "/api/start-custom-session" },
      );

      await releaseReservation();
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
        sessionIdSuffix: identifierSuffix(data.data?.session_id),
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

    await releaseReservation();
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
    await releaseReservation();
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

  if (shopifyCustomerKey) {
    try {
      conversationMemory = await getRecentClaraConversationMemory(
        shopifyCustomerKey,
        3,
      );
    } catch (memoryError) {
      logger.warn(
        "[DB] Previous consultation memory unavailable (non-critical)",
        { name: (memoryError as Error).name },
        { route: "/api/start-custom-session" },
      );
    }
  }

  // === PRIVACY-MINIMIZED CONSULTATION STORAGE ===
  // Voice remains available if storage is temporarily unavailable.
  let consultationPersistenceAvailable = true;
  try {
    await createClaraConsultation({
      id: consultationId,
      accessTokenHash: hashConsultationAccessToken(consultationAccessToken),
      liveAvatarSessionId: session_id,
      shopifyCustomerKey,
    });
    logger.debug(
      "[DB] Session tracked",
      { sessionIdSuffix: identifierSuffix(session_id) },
      {
        route: "/api/start-custom-session",
      },
    );
  } catch (dbError) {
    // Don't fail the request if DB tracking fails - just log it
    const err = dbError as Error;
    consultationPersistenceAvailable = false;
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
      consultation_id: consultationId,
      consultation_access_token: consultationAccessToken,
      consultation_persistence_available: consultationPersistenceAvailable,
      conversation_memory: conversationMemory,
      chroma_key_enabled: CHROMA_KEY_ENABLED,
      ...(CHROMA_KEY_ENABLED && {
        chroma_config: {
          minHue: CHROMA_MIN_HUE,
          maxHue: CHROMA_MAX_HUE,
          minSaturation: CHROMA_MIN_SATURATION,
          edgeSharpness: CHROMA_EDGE_SHARPNESS,
          bgUrlDesktop: CHROMA_BG_URL_DESKTOP || null,
          bgUrlMobile: CHROMA_BG_URL_MOBILE || null,
        },
      }),
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-RateLimit-Limit": "3",
        "X-RateLimit-Remaining": String(reservation.remaining),
        "X-RateLimit-Reset": new Date(reservation.resetAt).toISOString(),
      },
    },
  );
}
