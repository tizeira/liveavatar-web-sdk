import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.SHOPIFY_STORE_DOMAIN = "store.example.test";
process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "test-admin-token";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { fetchClaraCatalogSnapshot } = await import("@/src/shopify/client");

function product(id: string, handle: string) {
  return {
    id: `gid://shopify/Product/${id}`,
    title: handle === "beta-hidra" ? "Beta Hidra" : "Beta Lift",
    handle,
    updatedAt: "2026-09-21T12:00:00.000Z",
    description: "Producto de prueba",
    productType: "Skincare",
    tags: ["hidratación"],
    status: "ACTIVE",
    onlineStoreUrl: `https://store.example.test/products/${handle}`,
    resourcePublicationsV2: {
      nodes: [{ isPublished: true, publication: { name: "Online Store" } }],
    },
    featuredMedia: null,
    variants: {
      nodes: [{ availableForSale: true, price: "100", compareAtPrice: null }],
    },
    companionCondition: null,
    companionProducts: { references: { nodes: [] } },
  };
}

function response(
  nodes: unknown[],
  hasNextPage: boolean,
  endCursor: string | null,
) {
  return {
    ok: true,
    json: async () => ({
      data: {
        shop: {
          currencyCode: "CLP",
          primaryDomain: { url: "https://store.example.test" },
        },
        products: { nodes, pageInfo: { hasNextPage, endCursor } },
      },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchClaraCatalogSnapshot", () => {
  it("follows Shopify cursors before returning a complete snapshot", async () => {
    mockFetch
      .mockResolvedValueOnce(
        response([product("1", "beta-hidra")], true, "next"),
      )
      .mockResolvedValueOnce(
        response([product("2", "beta-lift")], false, null),
      );

    const snapshot = await fetchClaraCatalogSnapshot();

    expect(snapshot.map((entry) => entry.product.handle)).toEqual([
      "beta-hidra",
      "beta-lift",
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const firstRequest = mockFetch.mock.calls[0]?.[1] as RequestInit;
    const secondRequest = mockFetch.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(firstRequest.body)).variables.after).toBeNull();
    expect(JSON.parse(String(secondRequest.body)).variables.after).toBe("next");
  });

  it("rejects an incomplete pagination response", async () => {
    mockFetch.mockResolvedValueOnce(
      response([product("1", "beta-hidra")], true, null),
    );

    await expect(fetchClaraCatalogSnapshot()).rejects.toThrow("no cursor");
  });
});
