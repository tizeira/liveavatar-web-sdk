import { describe, expect, it } from "vitest";
import {
  hashConsultationAccessToken,
  hasValidAgentToolSecret,
  deriveShopifyCustomerKey,
  verifyConsultationAccessToken,
} from "@/src/consultations/security";

describe("consultation access security", () => {
  it("stores and verifies only a token hash", () => {
    const token = "browser-only-secret";
    const hash = hashConsultationAccessToken(token);

    expect(hash).not.toContain(token);
    expect(verifyConsultationAccessToken(token, hash)).toBe(true);
    expect(verifyConsultationAccessToken("wrong", hash)).toBe(false);
  });

  it("derives a stable customer key without storing the Shopify id", () => {
    const customerId = "1234567890";
    const key = deriveShopifyCustomerKey(customerId, "private-hmac-secret");
    expect(key).toHaveLength(64);
    expect(key).not.toContain(customerId);
    expect(key).toBe(
      deriveShopifyCustomerKey(customerId, "private-hmac-secret"),
    );
    expect(key).not.toBe(
      deriveShopifyCustomerKey("0987654321", "private-hmac-secret"),
    );
  });

  it("requires an exact bearer token for agent tools", () => {
    expect(hasValidAgentToolSecret("Bearer tool-secret", "tool-secret")).toBe(
      true,
    );
    expect(hasValidAgentToolSecret("Bearer wrong", "tool-secret")).toBe(false);
    expect(hasValidAgentToolSecret(null, "tool-secret")).toBe(false);
    expect(hasValidAgentToolSecret("Bearer tool-secret", "")).toBe(false);
  });
});
