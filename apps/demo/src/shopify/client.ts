/**
 * Shopify Admin API Client
 * GraphQL client for fetching customer data from Shopify
 */

import {
  SHOPIFY_STORE_DOMAIN,
  SHOPIFY_ADMIN_ACCESS_TOKEN,
} from "@/app/api/secrets";
import {
  CUSTOMER_BY_EMAIL_QUERY,
  CUSTOMER_BY_ID_QUERY,
  CUSTOMER_PURCHASE_COUNT_BY_ID_QUERY,
  PRODUCTS_FOR_CLARA_QUERY,
  PRODUCT_FOR_CLARA_BY_HANDLE_QUERY,
  PRODUCTS_FOR_CLARA_BY_HANDLES_QUERY,
} from "./queries";
import {
  ShopifyCustomer,
  ShopifyCustomerNode,
  ShopifyCustomersResponse,
  ShopifyCustomerByIdResponse,
  ShopifyOrder,
  SKIN_TYPE_KEY,
  SKIN_CONCERNS_KEY,
  ClaraCatalogProduct,
} from "./types";

// Current stable Admin API. Keep this server-side so the Admin token is never
// exposed to ElevenLabs or the browser.
const SHOPIFY_API_VERSION = "2026-07";
const getShopifyApiUrl = () =>
  `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

/**
 * Execute a GraphQL query against Shopify Admin API
 */
export async function shopifyGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
    throw new Error("Shopify API credentials not configured");
  }

  const response = await fetch(getShopifyApiUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Shopify API error (${response.status}): ${errorText}`);
  }

  const result = await response.json();

  if (result.errors) {
    console.error("Shopify GraphQL errors:", result.errors);
    throw new Error(`Shopify GraphQL error: ${result.errors[0]?.message}`);
  }

  return result.data;
}

type ClaraProductBaseNode = {
  id: string;
  title: string;
  handle: string;
  description: string;
  productType: string;
  tags: string[];
  status: string;
  onlineStoreUrl: string | null;
  resourcePublicationsV2: {
    nodes: Array<{
      isPublished: boolean;
      publication: { name: string };
    }>;
  };
  featuredMedia?: {
    preview?: { image?: { url: string; altText: string | null } | null } | null;
  } | null;
  variants: {
    nodes: Array<{
      availableForSale: boolean;
      price: string;
      compareAtPrice: string | null;
    }>;
  };
};

type ClaraProductNode = ClaraProductBaseNode & {
  companionCondition?: { value: string } | null;
  companionProducts?: {
    references?: { nodes: ClaraProductBaseNode[] } | null;
  } | null;
};

function toClaraCatalogProductSummary(
  node: ClaraProductBaseNode,
  currencyCode: string,
  primaryDomainUrl: string,
) {
  const availableVariant = node.variants.nodes.find(
    (variant) => variant.availableForSale,
  );
  const firstVariant = availableVariant || node.variants.nodes[0];
  const image = node.featuredMedia?.preview?.image;
  const isPublishedOnline = node.resourcePublicationsV2.nodes.some(
    (item) => item.isPublished && item.publication.name === "Online Store",
  );

  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    url: isPublishedOnline
      ? node.onlineStoreUrl ||
        `${primaryDomainUrl.replace(/\/$/, "")}/products/${node.handle}`
      : null,
    imageUrl: image?.url || null,
    imageAlt: image?.altText || null,
    availableForSale:
      Boolean(availableVariant) &&
      node.status === "ACTIVE" &&
      isPublishedOnline,
    price: firstVariant ? { amount: firstVariant.price, currencyCode } : null,
    compareAtPrice:
      firstVariant?.compareAtPrice &&
      Number(firstVariant.compareAtPrice) > Number(firstVariant.price)
        ? { amount: firstVariant.compareAtPrice, currencyCode }
        : null,
  };
}

function toClaraCatalogProduct(
  node: ClaraProductNode,
  currencyCode: string,
  primaryDomainUrl: string,
): ClaraCatalogProduct {
  const product = toClaraCatalogProductSummary(
    node,
    currencyCode,
    primaryDomainUrl,
  );
  const companionCondition =
    node.companionCondition?.value === "if_no_moisturizer"
      ? "if_no_moisturizer"
      : null;
  const companionProducts = (node.companionProducts?.references?.nodes || [])
    .map((companion) =>
      toClaraCatalogProductSummary(companion, currencyCode, primaryDomainUrl),
    )
    .filter((companion) => companion.availableForSale && companion.url);

  return {
    ...product,
    description: node.description.trim().slice(0, 1200),
    companionCondition,
    companionProducts,
  };
}

export async function searchProductsForClara(
  searchTerm: string,
  limit = 5,
): Promise<ClaraCatalogProduct[]> {
  const cleanTerm = searchTerm
    .trim()
    .replace(/[\\"']/g, " ")
    .slice(0, 120);
  if (!cleanTerm) return [];

  const data = await shopifyGraphQL<{
    shop: { currencyCode: string; primaryDomain: { url: string } };
    products: { nodes: ClaraProductNode[] };
  }>(PRODUCTS_FOR_CLARA_QUERY, {
    // Clara's catalogue is small. Shopify Admin search does not reliably match
    // Spanish concern words inside product descriptions, so fetch the active
    // catalogue and rank only fields that came from Shopify.
    first: 100,
  });

  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const normalizedTerm = normalize(cleanTerm);
  const tokens = normalizedTerm
    .split(/\s+/)
    .filter((token) => token.length >= 3);

  return data.products.nodes
    .filter((node) => node.status === "ACTIVE")
    .map((node) => {
      const title = normalize(node.title);
      const haystack = normalize(
        [
          node.title,
          node.handle,
          node.description,
          node.productType,
          ...node.tags,
        ].join(" "),
      );
      const score =
        (title.includes(normalizedTerm) ? 20 : 0) +
        tokens.reduce(
          (total, token) => total + (haystack.includes(token) ? 1 : 0),
          0,
        );
      return { node, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(Math.max(limit, 1), 8))
    .map(({ node }) =>
      toClaraCatalogProduct(
        node,
        data.shop.currencyCode,
        data.shop.primaryDomain.url,
      ),
    )
    .filter((product) => product.availableForSale && product.url);
}

export async function fetchProductForClaraByHandle(
  handle: string,
): Promise<ClaraCatalogProduct | null> {
  const cleanHandle = handle.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,254}$/.test(cleanHandle)) return null;

  const data = await shopifyGraphQL<{
    shop: { currencyCode: string; primaryDomain: { url: string } };
    productByHandle: ClaraProductNode | null;
  }>(PRODUCT_FOR_CLARA_BY_HANDLE_QUERY, { handle: cleanHandle });

  if (!data.productByHandle || data.productByHandle.status !== "ACTIVE") {
    return null;
  }
  return toClaraCatalogProduct(
    data.productByHandle,
    data.shop.currencyCode,
    data.shop.primaryDomain.url,
  );
}

export async function fetchProductsForClaraByHandles(
  handles: string[],
): Promise<Map<string, ClaraCatalogProduct>> {
  const uniqueHandles = [
    ...new Set(handles.map((handle) => handle.trim().toLowerCase())),
  ].filter((handle) => /^[a-z0-9][a-z0-9-]{0,254}$/.test(handle));
  if (!uniqueHandles.length) return new Map();

  const data = await shopifyGraphQL<{
    shop: { currencyCode: string; primaryDomain: { url: string } };
    products: { nodes: ClaraProductNode[] };
  }>(PRODUCTS_FOR_CLARA_BY_HANDLES_QUERY, {
    first: Math.min(uniqueHandles.length, 20),
    query: uniqueHandles.map((handle) => `handle:${handle}`).join(" OR "),
  });

  const requested = new Set(uniqueHandles);
  return new Map(
    data.products.nodes
      .filter((node) => node.status === "ACTIVE" && requested.has(node.handle))
      .map((node) =>
        toClaraCatalogProduct(
          node,
          data.shop.currencyCode,
          data.shop.primaryDomain.url,
        ),
      )
      .filter((product) => product.availableForSale && product.url)
      .map((product) => [product.handle, product]),
  );
}

/**
 * Transform raw Shopify customer node to our ShopifyCustomer type
 */
function transformCustomerNode(node: ShopifyCustomerNode): ShopifyCustomer {
  // Extract metafields
  const metafields = node.metafields.edges.reduce(
    (acc, { node: mf }) => {
      acc[mf.key] = mf.value;
      return acc;
    },
    {} as Record<string, string>,
  );

  // Parse skin concerns (stored as JSON array in metafield)
  let skinConcerns: string[] | undefined;
  if (metafields[SKIN_CONCERNS_KEY]) {
    try {
      const parsed = JSON.parse(metafields[SKIN_CONCERNS_KEY]);
      skinConcerns = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // If not JSON, treat as comma-separated
      skinConcerns = metafields[SKIN_CONCERNS_KEY].split(",").map((s) =>
        s.trim(),
      );
    }
  }

  // Transform orders
  const recentOrders: ShopifyOrder[] = node.orders.edges.map(
    ({ node: order }) => ({
      name: order.name,
      createdAt: order.createdAt,
      items: order.lineItems.edges.map(({ node: item }) => item.title),
      totalAmount: order.totalPriceSet?.shopMoney.amount,
      currencyCode: order.totalPriceSet?.shopMoney.currencyCode,
    }),
  );

  return {
    id: node.id.replace("gid://shopify/Customer/", ""),
    email: node.email,
    firstName: node.firstName,
    lastName: node.lastName,
    numberOfOrders: node.numberOfOrders,
    skinType: metafields[SKIN_TYPE_KEY],
    skinConcerns,
    recentOrders,
  };
}

/**
 * Fetch customer by email
 * Used for direct verification flow
 */
export async function fetchCustomerByEmail(
  email: string,
): Promise<ShopifyCustomer | null> {
  try {
    const data = await shopifyGraphQL<ShopifyCustomersResponse>(
      CUSTOMER_BY_EMAIL_QUERY,
      { query: `email:${email}` },
    );

    const customerEdge = data.customers.edges[0];
    if (!customerEdge) {
      return null;
    }

    return transformCustomerNode(customerEdge.node);
  } catch (error) {
    console.error("Error fetching customer by email:", error);
    throw error;
  }
}

/**
 * Fetch customer by ID
 * Used for Shopify iframe flow (with HMAC validation)
 */
export async function fetchCustomerById(
  customerId: string,
): Promise<ShopifyCustomer | null> {
  try {
    // Ensure proper GID format
    const gid = customerId.startsWith("gid://")
      ? customerId
      : `gid://shopify/Customer/${customerId}`;

    const data = await shopifyGraphQL<ShopifyCustomerByIdResponse>(
      CUSTOMER_BY_ID_QUERY,
      { id: gid },
    );

    if (!data.customer) {
      return null;
    }

    return transformCustomerNode(data.customer);
  } catch (error) {
    console.error("Error fetching customer by ID:", error);
    throw error;
  }
}

export async function fetchCustomerPurchaseCountById(
  customerId: string,
): Promise<number | null> {
  const gid = customerId.startsWith("gid://")
    ? customerId
    : `gid://shopify/Customer/${customerId}`;
  const data = await shopifyGraphQL<{
    customer: { numberOfOrders: number } | null;
  }>(CUSTOMER_PURCHASE_COUNT_BY_ID_QUERY, { id: gid });
  return data.customer?.numberOfOrders ?? null;
}

/**
 * Check if Shopify is properly configured
 */
export function isShopifyConfigured(): boolean {
  return Boolean(SHOPIFY_STORE_DOMAIN && SHOPIFY_ADMIN_ACCESS_TOKEN);
}
