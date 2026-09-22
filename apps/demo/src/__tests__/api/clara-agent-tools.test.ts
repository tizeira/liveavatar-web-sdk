import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

process.env.CLARA_AGENT_TOOL_SECRET = "test-tool-secret";

const mockSearchProducts = vi.fn();
const mockSearchSyncedProducts = vi.fn();
const mockFetchProducts = vi.fn();
const mockSaveRoutine = vi.fn();

vi.mock("@/src/shopify/client", () => ({
  searchProductsForClara: (...args: unknown[]) => mockSearchProducts(...args),
  fetchProductsForClaraByHandles: (...args: unknown[]) =>
    mockFetchProducts(...args),
}));

vi.mock("@/src/shopify/catalog", () => ({
  searchSyncedProductsForClara: (...args: unknown[]) =>
    mockSearchSyncedProducts(...args),
}));

vi.mock("@/src/consultations/repository", () => ({
  saveClaraRoutine: (...args: unknown[]) => mockSaveRoutine(...args),
}));

const productRoute = await import(
  "@/app/api/agent-tools/shopify-products/route"
);
const routineRoute = await import("@/app/api/agent-tools/save-routine/route");

function request(path: string, body: unknown, authorized = true) {
  return new NextRequest(`http://localhost:3001${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorized ? { authorization: "Bearer test-tool-secret" } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchProducts.mockResolvedValue([]);
  mockSearchSyncedProducts.mockResolvedValue({
    initialized: false,
    products: [],
  });
  mockFetchProducts.mockResolvedValue(new Map());
  mockSaveRoutine.mockImplementation(
    async (_consultationId: string, _summary: string, routine: unknown) => ({
      consultation: { routine },
      created: true,
    }),
  );
});

describe("Clara Shopify product tool", () => {
  it("rejects calls without the private tool credential", async () => {
    const response = await productRoute.POST(
      request(
        "/api/agent-tools/shopify-products",
        { query: "hidratación" },
        false,
      ),
    );
    expect(response.status).toBe(401);
    expect(mockSearchProducts).not.toHaveBeenCalled();
  });

  it("returns only products supplied by Shopify", async () => {
    mockSearchProducts.mockResolvedValue([
      {
        id: "gid://shopify/Product/1",
        title: "Booster 02",
        handle: "booster-02",
        url: "https://example.test/products/booster-02",
        availableForSale: true,
      },
    ]);

    const response = await productRoute.POST(
      request("/api/agent-tools/shopify-products", { query: "flacidez" }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockSearchProducts).toHaveBeenCalledWith("flacidez");
    expect(json.products[0].handle).toBe("booster-02");
  });

  it("uses the durable catalog without querying Shopify", async () => {
    mockSearchSyncedProducts.mockResolvedValue({
      initialized: true,
      products: [
        {
          id: "gid://shopify/Product/2",
          title: "Beta Hidra",
          handle: "beta-hidra",
          description: "Hidratación",
          url: "https://example.test/products/beta-hidra",
          imageUrl: null,
          imageAlt: null,
          availableForSale: true,
          price: null,
          compareAtPrice: null,
          companionCondition: null,
          companionProducts: [],
        },
      ],
    });

    const response = await productRoute.POST(
      request("/api/agent-tools/shopify-products", { query: "hidratación" }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.products[0].handle).toBe("beta-hidra");
    expect(mockSearchProducts).not.toHaveBeenCalled();
  });

  it("does not query Shopify when an initialized catalog has no match", async () => {
    mockSearchSyncedProducts.mockResolvedValue({
      initialized: true,
      products: [],
    });

    const response = await productRoute.POST(
      request("/api/agent-tools/shopify-products", { query: "inexistente" }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.products).toEqual([]);
    expect(mockSearchProducts).not.toHaveBeenCalled();
  });
});

describe("Clara routine tool", () => {
  const consultationId = "51bcaeed-9e1b-4c75-ad05-7b23fbd9d46f";

  it("rejects invented or unavailable Shopify product handles", async () => {
    const response = await routineRoute.POST(
      request("/api/agent-tools/save-routine", {
        consultation_id: consultationId,
        summary: "La persona busca una rutina hidratante.",
        concerns: ["hidratación"],
        cautions: ["Introducir gradualmente"],
        steps: [
          {
            moment: "morning",
            order: 1,
            instruction: "Aplicar sobre la piel limpia",
            product_handle: "producto-inventado",
          },
        ],
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.code).toBe("invalid_product_handle");
    expect(json.rejected_product_handles).toEqual(["producto-inventado"]);
    expect(mockSaveRoutine).not.toHaveBeenCalled();
  });

  it("rejects a named Beta product when the catalog handle is missing", async () => {
    const response = await routineRoute.POST(
      request("/api/agent-tools/save-routine", {
        consultation_id: consultationId,
        summary: "Rutina acordada.",
        steps: [
          {
            moment: "morning",
            order: 1,
            instruction: "Aplicar Beta Hidra sobre la piel limpia",
          },
        ],
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.code).toBe("product_handle_required");
    expect(json.invalid_steps).toEqual([1]);
    expect(mockSaveRoutine).not.toHaveBeenCalled();
  });

  it("returns the original routine without rewriting on a repeated save", async () => {
    const originalRoutine = {
      concerns: ["hidratación"],
      cautions: [],
      steps: [
        {
          moment: "morning",
          order: 1,
          instruction: "Aplicar una hidratante",
          product: null,
        },
      ],
    };
    mockSaveRoutine.mockResolvedValue({
      consultation: { routine: originalRoutine },
      created: false,
    });

    const response = await routineRoute.POST(
      request("/api/agent-tools/save-routine", {
        consultation_id: consultationId,
        summary: "Intento repetido.",
        steps: [
          {
            moment: "evening",
            order: 1,
            instruction: "Este cambio no debe persistirse",
          },
        ],
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.saved).toBe(true);
    expect(json.already_saved).toBe(true);
    expect(json.routine).toEqual(originalRoutine);
    expect(json.instruction).toContain("No changes were made");
  });

  it("replaces a handle with canonical Shopify product data", async () => {
    const product = {
      id: "gid://shopify/Product/1",
      title: "Booster 02",
      handle: "booster-02",
      description: "Producto real",
      url: "https://example.test/products/booster-02",
      imageUrl: null,
      imageAlt: null,
      availableForSale: true,
      price: { amount: "100", currencyCode: "ARS" },
      compareAtPrice: null,
      companionCondition: null,
      companionProducts: [],
    };
    mockFetchProducts.mockResolvedValue(new Map([[product.handle, product]]));

    const response = await routineRoute.POST(
      request("/api/agent-tools/save-routine", {
        consultation_id: consultationId,
        summary: "Rutina validada.",
        steps: [
          {
            moment: "evening",
            order: 2,
            instruction: "Aplicar por la noche",
            product_handle: "booster-02",
          },
        ],
      }),
    );
    const json = await response.json();

    expect(json.routine.steps[0].product.title).toBe("Booster 02");
    expect(json.routine.steps[0].product.url).toContain("booster-02");
  });

  it("requires moisturizer status before saving a conditional companion", async () => {
    const product = {
      id: "gid://shopify/Product/1",
      title: "Beta Hacker",
      handle: "beta-hacker",
      description: "Tratamiento",
      url: "https://example.test/products/beta-hacker",
      imageUrl: null,
      imageAlt: null,
      availableForSale: true,
      price: { amount: "100", currencyCode: "ARS" },
      compareAtPrice: null,
      companionCondition: "if_no_moisturizer",
      companionProducts: [
        {
          id: "gid://shopify/Product/2",
          title: "Beta Hidra",
          handle: "beta-hidra",
          url: "https://example.test/products/beta-hidra",
          imageUrl: null,
          imageAlt: null,
          availableForSale: true,
          price: { amount: "80", currencyCode: "ARS" },
          compareAtPrice: null,
        },
      ],
    };
    mockFetchProducts.mockResolvedValue(new Map([[product.handle, product]]));

    const response = await routineRoute.POST(
      request("/api/agent-tools/save-routine", {
        consultation_id: consultationId,
        summary: "Rutina validada.",
        steps: [
          {
            moment: "morning",
            order: 1,
            instruction: "Aplicar el tratamiento",
            product_handle: "beta-hacker",
          },
        ],
      }),
    );

    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("moisturizer_status_required");
    expect(mockSaveRoutine).not.toHaveBeenCalled();
  });

  it("requires the validated companion when the customer has no moisturizer", async () => {
    const hacker = {
      id: "gid://shopify/Product/1",
      title: "Beta Hacker",
      handle: "beta-hacker",
      description: "Tratamiento",
      url: "https://example.test/products/beta-hacker",
      imageUrl: null,
      imageAlt: null,
      availableForSale: true,
      price: { amount: "100", currencyCode: "ARS" },
      compareAtPrice: null,
      companionCondition: "if_no_moisturizer",
      companionProducts: [
        {
          id: "gid://shopify/Product/2",
          title: "Beta Hidra",
          handle: "beta-hidra",
          url: "https://example.test/products/beta-hidra",
          imageUrl: null,
          imageAlt: null,
          availableForSale: true,
          price: { amount: "80", currencyCode: "ARS" },
          compareAtPrice: null,
        },
      ],
    };
    mockFetchProducts.mockResolvedValue(new Map([[hacker.handle, hacker]]));

    const response = await routineRoute.POST(
      request("/api/agent-tools/save-routine", {
        consultation_id: consultationId,
        summary: "Rutina validada.",
        customer_has_moisturizer: false,
        steps: [
          {
            moment: "morning",
            order: 1,
            instruction: "Aplicar el tratamiento",
            product_handle: "beta-hacker",
          },
        ],
      }),
    );

    const json = await response.json();
    expect(response.status).toBe(422);
    expect(json.code).toBe("required_companion_missing");
    expect(json.required_companion_products[0].handle).toBe("beta-hidra");
  });

  it("accepts the treatment and companion together and consolidates repeated moments", async () => {
    const companion = {
      id: "gid://shopify/Product/2",
      title: "Beta Hidra",
      handle: "beta-hidra",
      description: "Hidratante",
      url: "https://example.test/products/beta-hidra",
      imageUrl: null,
      imageAlt: null,
      availableForSale: true,
      price: { amount: "80", currencyCode: "ARS" },
      compareAtPrice: null,
      companionCondition: null,
      companionProducts: [],
    };
    const hacker = {
      ...companion,
      id: "gid://shopify/Product/1",
      title: "Beta Hacker",
      handle: "beta-hacker",
      description: "Tratamiento",
      companionCondition: "if_no_moisturizer",
      companionProducts: [companion],
    };
    const verifiedProducts = new Map<string, unknown>();
    verifiedProducts.set(hacker.handle, hacker);
    verifiedProducts.set(companion.handle, companion);
    mockFetchProducts.mockResolvedValue(verifiedProducts);

    const repeated = {
      instruction: "Aplicar sobre la piel limpia",
      frequency: "Todos los días",
      product_handle: "beta-hacker",
    };
    const response = await routineRoute.POST(
      request("/api/agent-tools/save-routine", {
        consultation_id: consultationId,
        summary: "Cliente Iván acordó una rutina.",
        customer_has_moisturizer: false,
        steps: [
          { ...repeated, moment: "morning", order: 1 },
          { ...repeated, moment: "evening", order: 2 },
          {
            moment: "morning_evening",
            order: 3,
            instruction: "Aplicar hidratante",
            product_handle: "beta-hidra",
          },
        ],
      }),
    );

    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.routine.steps).toHaveLength(2);
    expect(json.routine.steps[0].moment).toBe("morning_evening");
    expect(mockSaveRoutine).toHaveBeenCalledWith(
      consultationId,
      "La persona acordó una rutina.",
      expect.objectContaining({ steps: expect.any(Array) }),
    );
  });
});
