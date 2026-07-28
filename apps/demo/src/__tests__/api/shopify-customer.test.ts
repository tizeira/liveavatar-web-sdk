/**
 * Tests de comportamiento para /api/shopify-customer
 *
 * A diferencia de los tests de src/__tests__/security/auth-bypass.test.ts, que leen
 * el archivo fuente con fs.readFile y verifican que el TEXTO contenga ciertas
 * cadenas, estos tests invocan el handler real con requests forjadas.
 *
 * Motivo: la fuga de PII que arregla este PR pasaba la suite de auth-bypass entera,
 * porque un grep sobre el fuente no puede detectar que la validacion corre en el
 * orden equivocado.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// src/shopify/security.ts lee SHOPIFY_HMAC_SECRET al importarse, asi que hay que
// definirlo antes de los imports dinamicos de abajo. El beforeAll de setup.ts
// corre despues de la fase de import y llega tarde para este modulo.
process.env.SHOPIFY_HMAC_SECRET = "test-shopify-secret-hmac-key-here";

// --- Mocks ---------------------------------------------------------------

vi.mock("@/src/lib/rate-limit", () => ({
  rateLimitByEndpoint: vi.fn().mockResolvedValue({
    success: true,
    limit: 10,
    remaining: 9,
    reset: Date.now() + 60_000,
  }),
}));

const mockGetCachedCustomer = vi.fn();
const mockCacheCustomer = vi.fn();

vi.mock("@/src/lib/db/queries", () => ({
  getCachedCustomer: (...args: unknown[]) => mockGetCachedCustomer(...args),
  cacheCustomer: (...args: unknown[]) => mockCacheCustomer(...args),
}));

const mockSessionCreate = vi.fn().mockResolvedValue({});

vi.mock("@/src/lib/db/prisma", () => ({
  prisma: {
    session: {
      create: (...args: unknown[]) => mockSessionCreate(...args),
    },
  },
}));

// Importar despues de los mocks
const { POST } = await import("@/app/api/shopify-customer/route");
const { generateCustomerToken } = await import("@/src/shopify");

// --- Helpers -------------------------------------------------------------

const VICTIM = {
  shopifyId: "9876543210",
  shopifyEmail: "victima@example.com",
  firstName: "Victima",
  lastName: "Apellido",
  ordersCount: 4,
  skinType: "mixta",
  skinConcerns: ["acne"],
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
};

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3001/api/shopify-customer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCachedCustomer.mockResolvedValue(null);
  mockCacheCustomer.mockResolvedValue({});
  mockSessionCreate.mockResolvedValue({});
});

// --- Tests ---------------------------------------------------------------

describe("POST /api/shopify-customer - autenticacion antes que cache", () => {
  it("no devuelve PII cuando el body solo trae un email (sin token)", async () => {
    // Simula que la victima uso Clara hace poco y esta en la cache
    mockGetCachedCustomer.mockResolvedValue(VICTIM);

    const res = await POST(post({ email: VICTIM.shopifyEmail }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.valid).toBe(false);
    expect(json.customer).toBeNull();

    // Ningun dato personal puede aparecer en la respuesta
    const body = JSON.stringify(json);
    expect(body).not.toContain(VICTIM.firstName);
    expect(body).not.toContain(VICTIM.lastName);
    expect(body).not.toContain(VICTIM.shopifyId);
    expect(body).not.toContain(VICTIM.skinType);
  });

  it("no consulta la cache antes de verificar el HMAC", async () => {
    await POST(post({ email: VICTIM.shopifyEmail }));

    // Sin token valido, la cache no debe tocarse siquiera
    expect(mockGetCachedCustomer).not.toHaveBeenCalled();
  });

  it("rechaza con 401 cuando el token HMAC es invalido", async () => {
    mockGetCachedCustomer.mockResolvedValue(VICTIM);

    const res = await POST(
      post({
        customer_id: VICTIM.shopifyId,
        shopify_token: "token-falso",
        email: VICTIM.shopifyEmail,
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.valid).toBe(false);
    expect(json.customer).toBeNull();
    expect(mockGetCachedCustomer).not.toHaveBeenCalled();
  });

  it("rechaza con 400 cuando el customer_id no es numerico", async () => {
    const res = await POST(
      post({
        customer_id: "no-es-un-id",
        shopify_token: generateCustomerToken("no-es-un-id"),
      }),
    );

    expect(res.status).toBe(400);
    expect(mockGetCachedCustomer).not.toHaveBeenCalled();
  });
});

describe("POST /api/shopify-customer - camino valido", () => {
  it("acepta un token HMAC valido y devuelve los datos del cliente", async () => {
    const token = generateCustomerToken(VICTIM.shopifyId);

    const res = await POST(
      post({
        customer_id: VICTIM.shopifyId,
        shopify_token: token,
        first_name: "Ana",
        email: "ana@example.com",
        orders_count: "2",
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.valid).toBe(true);
    expect(json.hasOrders).toBe(true);
    expect(json.customer.firstName).toBe("Ana");
  });

  it("consulta la cache usando el customer_id firmado, no el email", async () => {
    const token = generateCustomerToken(VICTIM.shopifyId);

    await POST(
      post({
        customer_id: VICTIM.shopifyId,
        shopify_token: token,
        email: "ana@example.com",
      }),
    );

    expect(mockGetCachedCustomer).toHaveBeenCalledWith(VICTIM.shopifyId);
  });

  it("escribe la cache indexada por el customer_id firmado", async () => {
    const token = generateCustomerToken(VICTIM.shopifyId);

    await POST(
      post({
        customer_id: VICTIM.shopifyId,
        shopify_token: token,
        first_name: "Ana",
        email: "ana@example.com",
        orders_count: "2",
      }),
    );

    expect(mockCacheCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ shopifyId: VICTIM.shopifyId }),
    );
  });

  it("un cliente valido no puede envenenar la cache de otro email", async () => {
    // Atacante con token propio valido, pero declarando el email de la victima
    const token = generateCustomerToken("1111111111");

    await POST(
      post({
        customer_id: "1111111111",
        shopify_token: token,
        first_name: "Atacante",
        email: VICTIM.shopifyEmail,
        orders_count: "99",
      }),
    );

    // La escritura debe quedar bajo el id del atacante, no bajo el email ajeno
    const written = mockCacheCustomer.mock.calls[0]?.[0] as {
      shopifyId: string;
    };
    expect(written.shopifyId).toBe("1111111111");
  });
});
