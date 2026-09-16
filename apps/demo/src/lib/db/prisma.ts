// Prisma Client Singleton
//
// En serverless cada instancia de funcion crea su propio PrismaClient con su
// propio pool de conexiones. Reusar la instancia entre invocaciones "warm" evita
// agotar las conexiones de la base. En desarrollo, ademas, evita que cada hot
// reload de Next cree un cliente nuevo.
//
// NOTA: antes este archivo hacia require("@prisma/client") dentro de un try/catch
// y, si fallaba, sustituia el cliente por una clase mock vacia. Combinado con el
// `|| echo` que tenia el postinstall, eso hacia que un fallo total de la capa de
// datos fuera indistinguible de una operacion normal: la app arrancaba "sana" y
// el unico sintoma era un console.warn. Ahora si el cliente no se genero, el
// import falla en build y nos enteramos.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "production"
        ? ["error"]
        : ["query", "error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
