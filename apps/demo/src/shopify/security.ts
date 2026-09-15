/**
 * Shopify HMAC Security
 * Functions for generating and validating HMAC tokens for secure customer verification
 */

import crypto from "crypto";
import { SHOPIFY_HMAC_SECRET } from "@/app/api/secrets";

export const CLARA_SHOPIFY_SIGNATURE_VERSION = "2";
export const CLARA_SHOPIFY_LINK_MAX_AGE_SECONDS = 5 * 60;

export interface ClaraShopifySignedAccess {
  customerId: string;
  ordersCount: number;
  issuedAt: number;
  version: string;
}

export function buildClaraShopifyAccessPayload(
  input: ClaraShopifySignedAccess,
): string {
  return [
    `v=${input.version}`,
    `customer_id=${input.customerId}`,
    `orders_count=${input.ordersCount}`,
    `issued_at=${input.issuedAt}`,
  ].join("&");
}

export function verifyClaraShopifyAccessToken(
  token: string,
  input: ClaraShopifySignedAccess,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (
    !SHOPIFY_HMAC_SECRET ||
    input.version !== CLARA_SHOPIFY_SIGNATURE_VERSION ||
    !isValidCustomerId(input.customerId) ||
    !Number.isSafeInteger(input.ordersCount) ||
    input.ordersCount < 0 ||
    !Number.isSafeInteger(input.issuedAt) ||
    input.issuedAt > nowSeconds + 60 ||
    nowSeconds - input.issuedAt > CLARA_SHOPIFY_LINK_MAX_AGE_SECONDS
  ) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", SHOPIFY_HMAC_SECRET)
    .update(buildClaraShopifyAccessPayload(input))
    .digest("hex");
  try {
    const suppliedBuffer = Buffer.from(token, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    return (
      suppliedBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
    );
  } catch {
    return false;
  }
}

/**
 * Generate HMAC-SHA256 token for a customer ID
 * This should match the Liquid template generation:
 * {{ customer_id | hmac_sha256: hmac_secret }}
 *
 * @param customerId - The Shopify customer ID (numeric string, without gid:// prefix)
 * @returns Hex-encoded HMAC-SHA256 signature
 */
export function generateCustomerToken(customerId: string): string {
  if (!SHOPIFY_HMAC_SECRET) {
    throw new Error("SHOPIFY_HMAC_SECRET is not configured");
  }

  return crypto
    .createHmac("sha256", SHOPIFY_HMAC_SECRET)
    .update(customerId)
    .digest("hex");
}

/**
 * Verify a customer token using timing-safe comparison
 * Prevents timing attacks by using constant-time comparison
 *
 * @param token - The token received from the client (hex string)
 * @param customerId - The customer ID to verify against
 * @returns true if the token is valid, false otherwise
 */
export function verifyCustomerToken(
  token: string,
  customerId: string,
): boolean {
  if (!SHOPIFY_HMAC_SECRET) {
    console.error("SHOPIFY_HMAC_SECRET is not configured");
    return false;
  }

  if (!token || !customerId) {
    return false;
  }

  try {
    const expectedToken = generateCustomerToken(customerId);

    // Ensure both buffers are the same length for timingSafeEqual
    const tokenBuffer = Buffer.from(token, "hex");
    const expectedBuffer = Buffer.from(expectedToken, "hex");

    // If lengths don't match, tokens are definitely different
    if (tokenBuffer.length !== expectedBuffer.length) {
      return false;
    }

    // Timing-safe comparison to prevent timing attacks
    return crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
  } catch (error) {
    // Log error but don't expose details
    console.error("Token verification error:", error);
    return false;
  }
}

/**
 * Validate customer ID format
 * Shopify customer IDs are numeric strings
 *
 * @param customerId - The customer ID to validate
 * @returns true if valid format, false otherwise
 */
export function isValidCustomerId(customerId: string): boolean {
  if (!customerId || typeof customerId !== "string") {
    return false;
  }

  // Remove any gid:// prefix if present
  const cleanId = customerId.replace(/^gid:\/\/shopify\/Customer\//, "");

  // Should be numeric
  return /^\d+$/.test(cleanId);
}

/**
 * Clean customer ID by removing gid:// prefix
 *
 * @param customerId - Raw customer ID (may include gid:// prefix)
 * @returns Clean numeric customer ID
 */
export function cleanCustomerId(customerId: string): string {
  return customerId.replace(/^gid:\/\/shopify\/Customer\//, "");
}

/**
 * Check if HMAC secret is configured
 * Used to validate that Shopify integration is properly set up
 */
export function isHmacConfigured(): boolean {
  return Boolean(SHOPIFY_HMAC_SECRET);
}
