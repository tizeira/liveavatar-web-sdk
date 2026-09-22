/**
 * Beta access gate — password verification endpoint.
 *
 * Security:
 *  - Rate limited: 5 attempts per 15 min per IP (KV Redis)
 *  - bcrypt constant-time compare (anti timing-attack)
 *  - Generic error response (doesn't leak whether password was right vs locked out)
 *  - Cookie: HttpOnly + Secure + SameSite=Lax + HMAC-signed
 *  - No logging of the submitted password
 */
import { NextRequest, NextResponse } from "next/server";
import { rateLimitByEndpoint } from "@/src/lib/rate-limit";
import {
  BETA_ACCESS_COOKIE_NAME,
  BETA_ACCESS_TTL_SEC,
  isBetaGateEnabled,
  signBetaCookie,
  verifyBetaPassword,
} from "@/src/lib/beta-access";

// Generic error so an attacker can't distinguish "wrong password" from "rate limited"
const GENERIC_ERROR = {
  error: "Acceso denegado",
  message:
    "Las credenciales no son válidas o has superado el límite de intentos.",
};

export async function POST(request: NextRequest) {
  // If the gate is explicitly disabled (dev only), short-circuit
  if (!isBetaGateEnabled()) {
    return NextResponse.json({ ok: true, bypassed: true });
  }

  // === RATE LIMIT (anti brute-force) ===
  const limit = await rateLimitByEndpoint(request, "beta-access");
  if (!limit.success) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((limit.reset - Date.now()) / 1000),
    );
    console.warn(
      `[BETA-ACCESS] Rate-limited IP: ${request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown"}`,
    );
    return NextResponse.json(GENERIC_ERROR, {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSec),
        "X-RateLimit-Limit": String(limit.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": new Date(limit.reset).toISOString(),
      },
    });
  }

  // === PARSE BODY ===
  let password: string;
  try {
    const body = await request.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json(GENERIC_ERROR, { status: 400 });
  }

  if (!password || password.length > 256) {
    // Reject empty or absurdly long inputs without hitting bcrypt
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  // === VERIFY PASSWORD (constant-time via bcrypt) ===
  const ok = await verifyBetaPassword(password);
  if (!ok) {
    console.warn(
      `[BETA-ACCESS] Failed attempt from IP: ${request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown"}`,
    );
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  // === SUCCESS: SET SIGNED COOKIE ===
  let cookieValue: string;
  try {
    cookieValue = await signBetaCookie();
  } catch (err) {
    console.error("[BETA-ACCESS] Cookie sign failed:", err);
    return NextResponse.json(
      { error: "Server misconfigured", message: "Contacta al administrador." },
      { status: 500 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(BETA_ACCESS_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: BETA_ACCESS_TTL_SEC,
  });

  console.log(
    `[BETA-ACCESS] Granted access from IP: ${request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown"}`,
  );
  return response;
}
