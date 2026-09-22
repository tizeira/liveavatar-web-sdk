import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

process.env.SHOPIFY_HMAC_SECRET = "shopify-test-secret";

const mockFetchCustomerPurchaseCountById = vi.fn();
const mockIssueTicket = vi.fn();
const mockReadTicket = vi.fn();

vi.mock("@/src/shopify/client", () => ({
  fetchCustomerPurchaseCountById: (...args: unknown[]) =>
    mockFetchCustomerPurchaseCountById(...args),
}));

vi.mock("@/src/lib/rate-limit", () => ({
  rateLimitByEndpoint: vi.fn().mockResolvedValue({
    success: true,
    limit: 20,
    remaining: 19,
    reset: Date.now() + 60_000,
  }),
}));

vi.mock("@/src/lib/clara-buyer-access", () => ({
  CLARA_BUYER_COOKIE_NAME: "clara_buyer_access",
  CLARA_BUYER_TICKET_TTL_SECONDS: 7200,
  issueClaraBuyerTicket: (...args: unknown[]) => mockIssueTicket(...args),
  readClaraBuyerTicket: (...args: unknown[]) => mockReadTicket(...args),
}));

const route = await import("@/app/api/shopify-access/route");

function post(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3001/api/shopify-access", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function v2Body(
  ordersCount: number,
  options: {
    includePurchaseContext?: boolean;
    issuedAt?: number;
    lastOrderDate?: string;
    lastOrderProduct?: string;
  } = {},
) {
  const customerId = "9455117238574";
  const issuedAt = options.issuedAt ?? Math.floor(Date.now() / 1000);
  const includePurchaseContext = options.includePurchaseContext ?? true;
  const lastOrderDate = options.lastOrderDate ?? "2026-09-18T14:30:00Z";
  const lastOrderProduct = options.lastOrderProduct ?? "Beta Hydra";
  const payload = [
    `v=2&customer_id=${customerId}&orders_count=${ordersCount}&issued_at=${issuedAt}`,
    includePurchaseContext
      ? `purchase_context=1&last_order_date=${lastOrderDate}&last_order_product=${lastOrderProduct}`
      : null,
  ]
    .filter(Boolean)
    .join("&");
  return {
    clara_v: "2",
    customer_id: customerId,
    orders_count: String(ordersCount),
    issued_at: String(issuedAt),
    ...(includePurchaseContext
      ? {
          purchase_context: "1",
          last_order_date: lastOrderDate,
          last_order_product: lastOrderProduct,
        }
      : {}),
    shopify_token: createHmac("sha256", "shopify-test-secret")
      .update(payload)
      .digest("hex"),
    first_name: "Ana",
    last_name: "No debe guardarse",
    email: "not-stored@example.test",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIssueTicket.mockResolvedValue("opaque-browser-ticket");
  mockReadTicket.mockResolvedValue(null);
});

describe("Shopify buyer access exchange", () => {
  it("issues an HttpOnly ticket for a fresh signed buyer link", async () => {
    const response = await route.POST(post(v2Body(1)));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.accessMode).toBe("signed_v2");
    expect(response.headers.get("set-cookie")).toContain(
      "clara_buyer_access=opaque-browser-ticket",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(mockIssueTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        lastOrderProduct: "Beta Hydra",
        lastOrderDate: "2026-09-18T14:30:00Z",
      }),
    );
    expect(mockIssueTicket).toHaveBeenCalledWith(
      expect.not.objectContaining({ email: expect.anything() }),
    );
  });

  it("rejects a valid identity with no purchases", async () => {
    const response = await route.POST(post(v2Body(0)));
    expect(response.status).toBe(403);
    expect(mockIssueTicket).not.toHaveBeenCalled();
  });

  it("rejects tampered purchase entitlement", async () => {
    const body = v2Body(1);
    body.orders_count = "2";
    const response = await route.POST(post(body));
    expect(response.status).toBe(401);
  });

  it("rejects tampered signed purchase context", async () => {
    const body = v2Body(1);
    body.last_order_product = "Otro producto";
    const response = await route.POST(post(body));
    expect(response.status).toBe(401);
    expect(mockIssueTicket).not.toHaveBeenCalled();
  });

  it("accepts legacy v2 links but ignores unsigned purchase context", async () => {
    const body = v2Body(1, { includePurchaseContext: false });
    body.last_order_product = "Producto no firmado";
    body.last_order_date = "2026-09-18T14:30:00Z";

    const response = await route.POST(post(body));

    expect(response.status).toBe(200);
    expect(mockIssueTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        lastOrderProduct: null,
        lastOrderDate: null,
      }),
    );
  });

  it("accepts a signed buyer with no available last-order details", async () => {
    const response = await route.POST(
      post(v2Body(1, { lastOrderDate: "", lastOrderProduct: "" })),
    );

    expect(response.status).toBe(200);
    expect(mockIssueTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        lastOrderProduct: null,
        lastOrderDate: null,
      }),
    );
  });

  it("rejects an expired signed buyer link", async () => {
    const response = await route.POST(
      post(
        v2Body(1, {
          issuedAt: Math.floor(Date.now() / 1000) - 301,
        }),
      ),
    );

    expect(response.status).toBe(401);
    expect(mockIssueTicket).not.toHaveBeenCalled();
  });

  it("never trusts legacy orders_count without checking Shopify", async () => {
    const customerId = "9455117238574";
    const token = createHmac("sha256", "shopify-test-secret")
      .update(customerId)
      .digest("hex");
    mockFetchCustomerPurchaseCountById.mockResolvedValue(0);

    const response = await route.POST(
      post({
        customer_id: customerId,
        shopify_token: token,
        orders_count: "999",
      }),
    );
    expect(response.status).toBe(403);
    expect(mockFetchCustomerPurchaseCountById).toHaveBeenCalledWith(customerId);
  });
});
