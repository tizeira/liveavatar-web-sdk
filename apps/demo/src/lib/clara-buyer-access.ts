import { createHash, createHmac, randomBytes } from "node:crypto";
import { kv } from "@vercel/kv";

export const CLARA_BUYER_COOKIE_NAME = "clara_buyer_access";
export const CLARA_BUYER_TICKET_TTL_SECONDS = 2 * 60 * 60;
export const CLARA_ACTIVE_SESSION_TTL_SECONDS = 12 * 60;
export const CLARA_START_WINDOW_SECONDS = 60 * 60;
export const CLARA_MAX_STARTS_PER_WINDOW = 3;

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

function hasKvConfiguration(): boolean {
  return Boolean(
    (process.env.KV_REST_API_URL || process.env.KV_URL) &&
      (process.env.KV_REST_API_TOKEN ||
        process.env.KV_REST_API_READ_ONLY_TOKEN),
  );
}

function ticketKey(ticket: string): string {
  return `clara:buyer-ticket:${createHash("sha256").update(ticket).digest("hex")}`;
}

function buyerStartsKey(buyerKey: string): string {
  return `clara:buyer:${buyerKey}:starts`;
}

function buyerActiveKey(buyerKey: string): string {
  return `clara:buyer:${buyerKey}:active`;
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

export async function issueClaraBuyerTicket(
  ticket: ClaraBuyerTicket,
): Promise<string> {
  if (!hasKvConfiguration()) throw new Error("KV unavailable");
  const opaqueToken = randomBytes(32).toString("base64url");
  await kv.set(ticketKey(opaqueToken), ticket, {
    ex: CLARA_BUYER_TICKET_TTL_SECONDS,
  });
  return opaqueToken;
}

export async function readClaraBuyerTicket(
  opaqueToken: string | undefined,
): Promise<ClaraBuyerTicket | null> {
  if (!opaqueToken) return null;
  if (!hasKvConfiguration()) throw new Error("KV unavailable");
  const ticket = await kv.get<ClaraBuyerTicket>(ticketKey(opaqueToken));
  if (
    !ticket ||
    typeof ticket.buyerKey !== "string" ||
    ticket.buyerKey.length !== 64 ||
    !Number.isSafeInteger(ticket.ordersCount) ||
    ticket.ordersCount < 1
  ) {
    return null;
  }
  return ticket;
}

const RESERVE_SCRIPT = `
local starts_key = KEYS[1]
local active_key = KEYS[2]
local now_ms = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local max_starts = tonumber(ARGV[3])
local active_ttl = tonumber(ARGV[4])
local consultation_id = ARGV[5]
local member = ARGV[6]

redis.call('ZREMRANGEBYSCORE', starts_key, 0, now_ms - window_ms)
local active = redis.call('GET', active_key)
if active then
  return {2, redis.call('TTL', active_key)}
end

local count = redis.call('ZCARD', starts_key)
if count >= max_starts then
  local oldest = redis.call('ZRANGE', starts_key, 0, 0, 'WITHSCORES')
  local retry_after = math.ceil((tonumber(oldest[2]) + window_ms - now_ms) / 1000)
  return {3, retry_after}
end

redis.call('ZADD', starts_key, now_ms, member)
redis.call('EXPIRE', starts_key, math.ceil(window_ms / 1000))
redis.call('SET', active_key, consultation_id, 'EX', active_ttl)
return {1, max_starts - count - 1, now_ms + window_ms}
`;

export async function reserveClaraBuyerSession(
  buyerKey: string,
  consultationId: string,
  now = Date.now(),
): Promise<ClaraSessionReservation> {
  if (!hasKvConfiguration()) {
    return { ok: false, reason: "unavailable", retryAfter: 30 };
  }
  try {
    const member = `${now}:${randomBytes(8).toString("hex")}`;
    const result = await kv.eval<unknown[], number[]>(
      RESERVE_SCRIPT,
      [buyerStartsKey(buyerKey), buyerActiveKey(buyerKey)],
      [
        now,
        CLARA_START_WINDOW_SECONDS * 1000,
        CLARA_MAX_STARTS_PER_WINDOW,
        CLARA_ACTIVE_SESSION_TTL_SECONDS,
        consultationId,
        member,
      ],
    );
    if (result[0] === 1) {
      return {
        ok: true,
        remaining: Number(result[1]),
        resetAt: Number(result[2]),
      };
    }
    if (result[0] === 2) {
      return {
        ok: false,
        reason: "active_session",
        retryAfter: Math.max(1, Number(result[1]) || 30),
      };
    }
    return {
      ok: false,
      reason: "start_limit",
      retryAfter: Math.max(1, Number(result[1]) || CLARA_START_WINDOW_SECONDS),
    };
  } catch {
    return { ok: false, reason: "unavailable", retryAfter: 30 };
  }
}

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export async function releaseClaraBuyerSession(
  buyerKey: string | null | undefined,
  consultationId: string,
): Promise<boolean> {
  if (!buyerKey || !hasKvConfiguration()) return false;
  try {
    const released = await kv.eval<string[], number>(
      RELEASE_SCRIPT,
      [buyerActiveKey(buyerKey)],
      [consultationId],
    );
    return released === 1;
  } catch {
    return false;
  }
}
