/**
 * Beta access gate — security helpers.
 *
 * Edge-runtime-safe: uses Web Crypto API (globalThis.crypto.subtle) for HMAC
 * so it works in both Next.js middleware (Edge) and API routes (Node).
 *
 * - Password verification via bcryptjs (pure JS, works in both runtimes)
 * - HMAC-SHA256-signed cookie (tamper-proof, server-only secret)
 * - Cookie TTL: 7 days
 *
 * Env vars (set in Vercel):
 *   BETA_ACCESS_PASSWORD_HASH — bcrypt hash of the shared password
 *   BETA_ACCESS_SECRET        — 32+ byte random secret for HMAC cookie signing
 */
import bcrypt from "bcryptjs";

export const BETA_ACCESS_COOKIE_NAME = "beta_access";
export const BETA_ACCESS_TTL_SEC = 7 * 24 * 60 * 60; // 7 days

const PASSWORD_HASH = process.env.BETA_ACCESS_PASSWORD_HASH || "";
const COOKIE_SECRET = process.env.BETA_ACCESS_SECRET || "";

const encoder = new TextEncoder();

/**
 * Constant-time comparison via bcrypt.
 * Returns true if the provided plaintext password matches the configured hash.
 * Returns false if either is missing or doesn't match.
 */
export async function verifyBetaPassword(plaintext: string): Promise<boolean> {
  if (!PASSWORD_HASH || !plaintext) {
    return false;
  }
  try {
    return await bcrypt.compare(plaintext, PASSWORD_HASH);
  } catch {
    return false;
  }
}

/**
 * Compute HMAC-SHA256 of `data` using `secret` via Web Crypto API.
 * Returns the digest as base64url (URL-safe, no padding).
 */
async function hmacSha256Base64Url(
  secret: string,
  data: string,
): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(data),
  );
  // ArrayBuffer → base64url
  const bytes = new Uint8Array(signature);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Build a signed cookie value: `<expires_unix>.<hmac>`
 *
 * The HMAC covers the expiration timestamp so we can:
 *  - Detect tampering (changing the expiry breaks the signature)
 *  - Self-expire without storing state server-side
 */
export async function signBetaCookie(): Promise<string> {
  if (!COOKIE_SECRET) {
    throw new Error("BETA_ACCESS_SECRET not configured");
  }
  const expiresAt = Math.floor(Date.now() / 1000) + BETA_ACCESS_TTL_SEC;
  const payload = String(expiresAt);
  const hmac = await hmacSha256Base64Url(COOKIE_SECRET, payload);
  return `${payload}.${hmac}`;
}

/**
 * Constant-time string compare (manual; avoids leaking length-based timing info).
 * Both strings must be same length; if not, returns false immediately.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Verify a beta-access cookie value.
 *
 * Returns true only if:
 *  - The format is correct
 *  - The HMAC matches (constant-time compare)
 *  - The cookie hasn't expired
 */
export async function verifyBetaCookie(
  value: string | undefined,
): Promise<boolean> {
  if (!value || !COOKIE_SECRET) {
    return false;
  }
  const parts = value.split(".");
  if (parts.length !== 2) {
    return false;
  }
  const payload = parts[0];
  const providedHmac = parts[1];
  if (!payload || !providedHmac) {
    return false;
  }

  const expiresAt = parseInt(payload, 10);
  if (!Number.isFinite(expiresAt)) {
    return false;
  }

  // Check expiration first (cheap)
  if (expiresAt < Math.floor(Date.now() / 1000)) {
    return false;
  }

  // Constant-time HMAC compare
  const expectedHmac = await hmacSha256Base64Url(COOKIE_SECRET, payload);
  return timingSafeStringEqual(providedHmac, expectedHmac);
}

/**
 * Whether the gate is enabled.
 *
 * Gate is OFF if:
 *  - BETA_ACCESS_DISABLED=true (explicit dev opt-out), OR
 *  - PASSWORD_HASH or COOKIE_SECRET are not configured (fail-safe so a
 *    misconfigured deploy doesn't lock everyone out, including admins).
 *
 * In production, both env vars MUST be set for the gate to activate.
 */
export function isBetaGateEnabled(): boolean {
  if (process.env.BETA_ACCESS_DISABLED === "true") return false;
  if (!PASSWORD_HASH || !COOKIE_SECRET) {
    console.warn(
      "[BETA-ACCESS] Gate disabled: BETA_ACCESS_PASSWORD_HASH or BETA_ACCESS_SECRET not set",
    );
    return false;
  }
  return true;
}
