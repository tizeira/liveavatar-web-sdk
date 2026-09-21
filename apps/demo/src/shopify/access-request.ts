export function buildShopifyAccessRequestBody(params: URLSearchParams) {
  return {
    customer_id: params.get("customer_id"),
    shopify_token: params.get("shopify_token"),
    clara_v: params.get("clara_v"),
    issued_at: params.get("issued_at"),
    purchase_context: params.get("purchase_context"),
    first_name: params.get("first_name"),
    orders_count: params.get("orders_count"),
    last_order_product: params.get("last_order_product"),
    last_order_date: params.get("last_order_date"),
  };
}
