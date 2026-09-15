import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

process.env.SHOPIFY_HMAC_SECRET = "test-shopify-secret-hmac-key-here";

const mockGetLatest = vi.fn();
vi.mock("@/src/consultations/repository", () => ({
  getLatestClaraConsultation: (...args: unknown[]) => mockGetLatest(...args),
}));

const { POST } = await import("@/app/api/consultations/latest/route");
const { generateCustomerToken } = await import("@/src/shopify");
const { deriveShopifyCustomerKey } = await import(
  "@/src/consultations/security"
);

function request(customerId: string, token: string) {
  return new NextRequest("http://localhost/api/consultations/latest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ customer_id: customerId, shopify_token: token }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetLatest.mockResolvedValue({
    consultationId: "51bcaeed-9e1b-4c75-ad05-7b23fbd9d46f",
    status: "completed",
    summary: "Rutina lista",
    routine: { concerns: [], cautions: [], steps: [] },
    transcript: [],
  });
});

describe("POST /api/consultations/latest", () => {
  it("returns the latest routine only for a valid Shopify identity", async () => {
    const customerId = "1234567890";
    const response = await POST(
      request(customerId, generateCustomerToken(customerId)),
    );
    expect(response.status).toBe(200);
    expect(mockGetLatest).toHaveBeenCalledWith(
      deriveShopifyCustomerKey(customerId, "test-shopify-secret-hmac-key-here"),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects an identity with a forged token without querying the database", async () => {
    const response = await POST(request("1234567890", "forged"));
    expect(response.status).toBe(404);
    expect(mockGetLatest).not.toHaveBeenCalled();
  });

  it("cannot reuse one customer's token for another customer", async () => {
    const response = await POST(
      request("2222222222", generateCustomerToken("1111111111")),
    );
    expect(response.status).toBe(404);
    expect(mockGetLatest).not.toHaveBeenCalled();
  });
});
