import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { SHOPIFY_HMAC_SECRET } from "@/app/api/secrets";
import { getSavedClaraRoutine } from "@/src/consultations/repository";
import {
  CLARA_BUYER_COOKIE_NAME,
  deriveAuthenticatedTesterKey,
  readClaraBuyerTicket,
} from "@/src/lib/clara-buyer-access";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

export async function GET(request: NextRequest) {
  const opaqueBuyerTicket = request.cookies.get(CLARA_BUYER_COOKIE_NAME)?.value;
  const hasBuyerCookie = request.cookies.has(CLARA_BUYER_COOKIE_NAME);
  let buyerTicket;
  try {
    buyerTicket = await readClaraBuyerTicket(opaqueBuyerTicket);
  } catch {
    return json({ error: "Access service unavailable" }, 503);
  }

  // A supplied buyer ticket represents the active buyer identity. Do not let
  // a malformed or expired ticket fall through to a different QA account.
  if (hasBuyerCookie && !buyerTicket) {
    return json({ error: "Unauthorized" }, 401);
  }

  let buyerKey = buyerTicket?.buyerKey;
  if (!buyerKey) {
    let session;
    try {
      session = await auth();
    } catch {
      return json({ error: "Access service unavailable" }, 503);
    }
    if (session?.user?.email && SHOPIFY_HMAC_SECRET) {
      try {
        buyerKey = deriveAuthenticatedTesterKey(
          session.user.email,
          SHOPIFY_HMAC_SECRET,
        );
      } catch {
        return json({ error: "Access service unavailable" }, 503);
      }
    }
  }

  if (!buyerKey) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const { routine, consultationDate } = await getSavedClaraRoutine(buyerKey);
    return json({ routine, consultationDate });
  } catch {
    return json({ error: "Service unavailable" }, 503);
  }
}
