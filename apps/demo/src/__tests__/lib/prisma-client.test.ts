/**
 * Test centinela del cliente de Prisma.
 *
 * Antes, src/lib/db/prisma.ts hacia require("@prisma/client") dentro de un
 * try/catch y, si fallaba, sustituia el cliente por una clase mock vacia que solo
 * hacia console.warn. Combinado con el `|| echo` del postinstall, eso hacia que un
 * fallo total de la capa de datos fuera indistinguible de una operacion normal.
 *
 * Este test falla si alguien reintroduce ese patron: contra el mock,
 * `prisma.session` es undefined.
 *
 * IMPORTANTE: este archivo NO debe mockear "@/src/lib/db/prisma" (a diferencia de
 * los tests de rutas), porque justamente valida el modulo real.
 */

import { describe, it, expect } from "vitest";
import { prisma } from "@/src/lib/db/prisma";

describe("cliente de Prisma", () => {
  it("expone la API real del cliente, no un mock", () => {
    expect(typeof prisma.$connect).toBe("function");
    expect(typeof prisma.$disconnect).toBe("function");
    expect(typeof prisma.$queryRaw).toBe("function");
  });

  it("expone los modelos que usa la app", () => {
    expect(prisma.session).toBeDefined();
    expect(prisma.shopifyCustomerCache).toBeDefined();
  });

  it("expone los metodos que usan las rutas y queries", () => {
    expect(typeof prisma.session.create).toBe("function");
    expect(typeof prisma.shopifyCustomerCache.findUnique).toBe("function");
    expect(typeof prisma.shopifyCustomerCache.upsert).toBe("function");
    expect(typeof prisma.shopifyCustomerCache.delete).toBe("function");
  });
});
