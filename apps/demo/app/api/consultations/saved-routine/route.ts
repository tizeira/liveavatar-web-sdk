import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { SHOPIFY_HMAC_SECRET } from "@/app/api/secrets";
import {
  getSavedClaraRoutine,
  resolveClaraRoutineProposal,
} from "@/src/consultations/repository";
import {
  CLARA_BUYER_COOKIE_NAME,
  deriveAuthenticatedTesterKey,
  readClaraBuyerTicket,
} from "@/src/lib/clara-buyer-access";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

async function resolveBuyerKey(request: NextRequest): Promise<string | null> {
  const opaqueBuyerTicket = request.cookies.get(CLARA_BUYER_COOKIE_NAME)?.value;
  const hasBuyerCookie = request.cookies.has(CLARA_BUYER_COOKIE_NAME);
  let buyerTicket;
  try {
    buyerTicket = await readClaraBuyerTicket(opaqueBuyerTicket);
  } catch {
    throw new Error("access_service_unavailable");
  }

  // A supplied buyer ticket represents the active buyer identity. Do not let
  // a malformed or expired ticket fall through to a different QA account.
  if (hasBuyerCookie && !buyerTicket) {
    return null;
  }

  let buyerKey = buyerTicket?.buyerKey;
  if (!buyerKey) {
    let session;
    try {
      session = await auth();
    } catch {
      throw new Error("access_service_unavailable");
    }
    if (session?.user?.email && SHOPIFY_HMAC_SECRET) {
      try {
        buyerKey = deriveAuthenticatedTesterKey(
          session.user.email,
          SHOPIFY_HMAC_SECRET,
        );
      } catch {
        throw new Error("access_service_unavailable");
      }
    }
  }

  return buyerKey || null;
}

export async function GET(request: NextRequest) {
  let buyerKey: string | null;
  try {
    buyerKey = await resolveBuyerKey(request);
  } catch {
    return json({ error: "Access service unavailable" }, 503);
  }
  if (!buyerKey) return json({ error: "Unauthorized" }, 401);

  try {
    const result = await getSavedClaraRoutine(buyerKey);
    const { routine, consultationDate, pendingProposal } = result;
    return json({ routine, consultationDate, pendingProposal });
  } catch {
    return json({ error: "Service unavailable" }, 503);
  }
}

export async function POST(request: NextRequest) {
  let buyerKey: string | null;
  try {
    buyerKey = await resolveBuyerKey(request);
  } catch {
    return json({ error: "Access service unavailable" }, 503);
  }
  if (!buyerKey) return json({ error: "Unauthorized" }, 401);

  let body: { consultationId?: unknown; action?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const consultationId =
    typeof body.consultationId === "string" ? body.consultationId : "";
  const action = body.action;
  if (
    !/^[0-9a-f-]{36}$/i.test(consultationId) ||
    (action !== "confirm" && action !== "dismiss")
  ) {
    return json({ error: "Invalid proposal resolution" }, 400);
  }

  try {
    const result = await resolveClaraRoutineProposal({
      consultationId,
      shopifyCustomerKey: buyerKey,
      action,
    });
    if (!result.resolved) {
      return json({ error: "Proposal is no longer pending" }, 409);
    }
    return json({ resolved: true, confirmed: action === "confirm" });
  } catch {
    return json({ error: "Proposal not found" }, 404);
  }
}
