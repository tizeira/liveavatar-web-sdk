import { describe, expect, it } from "vitest";
import { buildShopifyAccessRequestBody } from "@/src/shopify/access-request";

describe("Shopify signed access request", () => {
  it("forwards the complete signed purchase-context contract", () => {
    const params = new URLSearchParams({
      clara_v: "2",
      customer_id: "9455117238574",
      orders_count: "1",
      issued_at: "1789945000",
      purchase_context: "1",
      last_order_date: "2026-09-18T14:30:00Z",
      last_order_product: "Beta Hydra & Balance",
      shopify_token: "signed-token",
      first_name: "Ana",
    });

    expect(buildShopifyAccessRequestBody(params)).toEqual({
      customer_id: "9455117238574",
      shopify_token: "signed-token",
      clara_v: "2",
      issued_at: "1789945000",
      purchase_context: "1",
      first_name: "Ana",
      orders_count: "1",
      last_order_product: "Beta Hydra & Balance",
      last_order_date: "2026-09-18T14:30:00Z",
    });
  });
});
