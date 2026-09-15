import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

process.env.CLARA_AGENT_TOOL_SECRET = "test-tool-secret";

const mockSearchProducts = vi.fn();
const mockFetchProduct = vi.fn();
const mockSaveRoutine = vi.fn();

vi.mock("@/src/shopify/client", () => ({
  searchProductsForClara: (...args: unknown[]) => mockSearchProducts(...args),
  fetchProductForClaraByHandle: (...args: unknown[]) =>
    mockFetchProduct(...args),
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
  mockFetchProduct.mockResolvedValue(null);
  mockSaveRoutine.mockResolvedValue({});
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
});

describe("Clara routine tool", () => {
  const consultationId = "51bcaeed-9e1b-4c75-ad05-7b23fbd9d46f";

  it("omits invented or unavailable Shopify product handles", async () => {
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

    expect(response.status).toBe(200);
    expect(json.routine.steps[0].product).toBeNull();
    expect(json.rejected_product_handles).toEqual(["producto-inventado"]);
    expect(mockSaveRoutine).toHaveBeenCalledOnce();
  });

  it("replaces a handle with canonical Shopify product data", async () => {
    mockFetchProduct.mockResolvedValue({
      id: "gid://shopify/Product/1",
      title: "Booster 02",
      handle: "booster-02",
      description: "Producto real",
      url: "https://example.test/products/booster-02",
      imageUrl: null,
      imageAlt: null,
      availableForSale: true,
      price: { amount: "100", currencyCode: "ARS" },
    });

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
});
