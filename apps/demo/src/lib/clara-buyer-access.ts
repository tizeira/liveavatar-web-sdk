import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { ClaraConsultationStatus, Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db/prisma";

export const CLARA_BUYER_COOKIE_NAME = "clara_buyer_access";
export const CLARA_BUYER_TICKET_TTL_SECONDS = 2 * 60 * 60;
export const CLARA_ACTIVE_SESSION_TTL_SECONDS = 12 * 60;
export const CLARA_START_WINDOW_SECONDS = 60 * 60;
export const CLARA_MAX_STARTS_PER_WINDOW = 3;

const TICKET_VERSION = "v1";
const TICKET_AAD = Buffer.from("clara-buyer-access:v1");

export interface ClaraBuyerTicket {
  buyerKey: string;
  firstName: string | null;
  ordersCount: number;
  lastOrderProduct: string | null;
  lastOrderDate: string | null;
  issuedAt: number;
}

export type ClaraSessionReservation =
  | { ok: true; remaining: number; resetAt: number }
  | {
      ok: false;
      reason: "active_session" | "start_limit" | "unavailable";
      retryAfter: number;
    };

function ticketKey(secret: string): Buffer {
  if (!secret) throw new Error("Ticket secret unavailable");
  return createHash("sha256").update(`clara-buyer-ticket:${secret}`).digest();
}

function isValidTicket(
  value: unknown,
  nowSeconds: number,
): value is ClaraBuyerTicket {
  if (!value || typeof value !== "object") return false;
  const ticket = value as Partial<ClaraBuyerTicket>;
  return Boolean(
    typeof ticket.buyerKey === "string" &&
      /^[0-9a-f]{64}$/.test(ticket.buyerKey) &&
      (ticket.firstName === null || typeof ticket.firstName === "string") &&
      Number.isSafeInteger(ticket.ordersCount) &&
      Number(ticket.ordersCount) >= 1 &&
      (ticket.lastOrderProduct === null ||
        typeof ticket.lastOrderProduct === "string") &&
      (ticket.lastOrderDate === null ||
        typeof ticket.lastOrderDate === "string") &&
      Number.isSafeInteger(ticket.issuedAt) &&
      Number(ticket.issuedAt) <= nowSeconds + 60 &&
      Number(ticket.issuedAt) > nowSeconds - CLARA_BUYER_TICKET_TTL_SECONDS,
  );
}

/**
 * The browser ticket uses authenticated encryption instead of a Redis lookup.
 * It is HttpOnly and cannot be read or modified without the server secret.
 */
export async function issueClaraBuyerTicket(
  ticket: ClaraBuyerTicket,
  secret = process.env.SHOPIFY_HMAC_SECRET || "",
): Promise<string> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ticketKey(secret), iv);
  cipher.setAAD(TICKET_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(ticket), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    TICKET_VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export async function readClaraBuyerTicket(
  opaqueToken: string | undefined,
  secret = process.env.SHOPIFY_HMAC_SECRET || "",
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<ClaraBuyerTicket | null> {
  if (!opaqueToken) return null;
  try {
    const [version, ivValue, ciphertextValue, tagValue, extra] =
      opaqueToken.split(".");
    if (
      version !== TICKET_VERSION ||
      !ivValue ||
      !ciphertextValue ||
      !tagValue ||
      extra
    ) {
      return null;
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      ticketKey(secret),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAAD(TICKET_AAD);
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const ticket: unknown = JSON.parse(plaintext);
    return isValidTicket(ticket, nowSeconds) ? ticket : null;
  } catch {
    return null;
  }
}

export function deriveAuthenticatedTesterKey(
  email: string,
  secret: string,
): string {
  if (!email || !secret) throw new Error("Tester identity cannot be derived");
  return createHmac("sha256", secret)
    .update(`clara-tester:${email.trim().toLowerCase()}`)
    .digest("hex");
}

/**
 * A transaction-scoped advisory lock makes the buyer checks atomic across
 * concurrent Vercel instances. Neon is already Clara's durable source of truth.
 */
export async function reserveClaraBuyerSession(input: {
  buyerKey: string;
  consultationId: string;
  accessTokenHash: string;
  now?: Date;
}): Promise<ClaraSessionReservation> {
  const now = input.now || new Date();
  const activeSince = new Date(
    now.getTime() - CLARA_ACTIVE_SESSION_TTL_SECONDS * 1000,
  );
  const windowStart = new Date(
    now.getTime() - CLARA_START_WINDOW_SECONDS * 1000,
  );

  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`clara-buyer:${input.buyerKey}`}, 0))`;

        const active = await tx.claraConsultation.findFirst({
          where: {
            shopifyCustomerKey: input.buyerKey,
            status: {
              in: [
                ClaraConsultationStatus.pending,
                ClaraConsultationStatus.routine_ready,
              ],
            },
            createdAt: { gt: activeSince },
          },
          select: { createdAt: true },
          orderBy: { createdAt: "desc" },
        });
        if (active) {
          return {
            ok: false as const,
            reason: "active_session" as const,
            retryAfter: Math.max(
              1,
              Math.ceil(
                (active.createdAt.getTime() +
                  CLARA_ACTIVE_SESSION_TTL_SECONDS * 1000 -
                  now.getTime()) /
                  1000,
              ),
            ),
          };
        }

        const [count, oldest] = await Promise.all([
          tx.claraConsultation.count({
            where: {
              shopifyCustomerKey: input.buyerKey,
              createdAt: { gte: windowStart },
            },
          }),
          tx.claraConsultation.findFirst({
            where: {
              shopifyCustomerKey: input.buyerKey,
              createdAt: { gte: windowStart },
            },
            select: { createdAt: true },
            orderBy: { createdAt: "asc" },
          }),
        ]);
        if (count >= CLARA_MAX_STARTS_PER_WINDOW) {
          return {
            ok: false as const,
            reason: "start_limit" as const,
            retryAfter: Math.max(
              1,
              Math.ceil(
                ((oldest?.createdAt.getTime() || now.getTime()) +
                  CLARA_START_WINDOW_SECONDS * 1000 -
                  now.getTime()) /
                  1000,
              ),
            ),
          };
        }

        await tx.claraConsultation.create({
          data: {
            id: input.consultationId,
            accessTokenHash: input.accessTokenHash,
            shopifyCustomerKey: input.buyerKey,
            transcriptExpiresAt: new Date(now.getTime() + 30 * 86400 * 1000),
            recordExpiresAt: new Date(
              Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth() + 12,
                now.getUTCDate(),
                now.getUTCHours(),
                now.getUTCMinutes(),
                now.getUTCSeconds(),
                now.getUTCMilliseconds(),
              ),
            ),
          },
        });

        return {
          ok: true as const,
          remaining: CLARA_MAX_STARTS_PER_WINDOW - count - 1,
          resetAt:
            (oldest?.createdAt.getTime() || now.getTime()) +
            CLARA_START_WINDOW_SECONDS * 1000,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch {
    return { ok: false, reason: "unavailable", retryAfter: 30 };
  }
}

export async function attachClaraLiveAvatarSession(
  consultationId: string,
  liveAvatarSessionId: string,
): Promise<void> {
  await prisma.claraConsultation.update({
    where: { id: consultationId },
    data: { liveAvatarSessionId },
  });
}

export async function cancelClaraBuyerSession(
  buyerKey: string,
  consultationId: string,
): Promise<boolean> {
  try {
    const result = await prisma.claraConsultation.deleteMany({
      where: {
        id: consultationId,
        shopifyCustomerKey: buyerKey,
        status: ClaraConsultationStatus.pending,
        routine: { equals: Prisma.DbNull },
        elevenLabsConversationId: null,
      },
    });
    return result.count === 1;
  } catch {
    return false;
  }
}

export async function releaseClaraBuyerSession(
  buyerKey: string | null | undefined,
  consultationId: string,
): Promise<boolean> {
  if (!buyerKey) return false;
  try {
    const released = await prisma.claraConsultation.updateMany({
      where: {
        id: consultationId,
        shopifyCustomerKey: buyerKey,
        status: {
          in: [
            ClaraConsultationStatus.pending,
            ClaraConsultationStatus.routine_ready,
          ],
        },
      },
      data: { status: ClaraConsultationStatus.processing },
    });
    if (released.count === 1) return true;
    // A repeated close is successful only when this buyer's consultation was
    // already released for processing or reached a terminal state. An
    // unavailable database still returns false below.
    const terminal = await prisma.claraConsultation.findFirst({
      where: {
        id: consultationId,
        shopifyCustomerKey: buyerKey,
        status: {
          in: [
            ClaraConsultationStatus.processing,
            ClaraConsultationStatus.completed,
            ClaraConsultationStatus.failed,
          ],
        },
      },
      select: { id: true },
    });
    return Boolean(terminal);
  } catch {
    return false;
  }
}
