import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function hashConsultationAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyConsultationAccessToken(
  token: string,
  expectedHash: string,
): boolean {
  const actual = Buffer.from(hashConsultationAccessToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function hasValidAgentToolSecret(
  authorizationHeader: string | null,
  configuredSecret: string,
): boolean {
  if (!configuredSecret || !authorizationHeader?.startsWith("Bearer ")) {
    return false;
  }
  const supplied = Buffer.from(authorizationHeader.slice(7));
  const expected = Buffer.from(configuredSecret);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

export function deriveShopifyCustomerKey(
  customerId: string,
  hmacSecret: string,
): string {
  if (!customerId || !hmacSecret) {
    throw new Error("Shopify customer key cannot be derived");
  }
  return createHmac("sha256", hmacSecret)
    .update(`clara-consultation:${customerId}`)
    .digest("hex");
}

export function hasValidCronSecret(
  authorizationHeader: string | null,
  configuredSecret: string,
): boolean {
  return hasValidAgentToolSecret(authorizationHeader, configuredSecret);
}
