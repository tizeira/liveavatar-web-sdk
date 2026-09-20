import { NextRequest, NextResponse } from "next/server";
import { getClaraConsultationAccessContext } from "@/src/consultations/repository";
import { verifyConsultationAccessToken } from "@/src/consultations/security";
import { releaseClaraBuyerSession } from "@/src/lib/clara-buyer-access";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const accessToken = request.headers.get("x-consultation-token") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || !accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let consultation;
  try {
    consultation = await getClaraConsultationAccessContext(id);
  } catch {
    return NextResponse.json(
      { released: false, error: "Release unavailable" },
      { status: 503 },
    );
  }
  if (
    !consultation ||
    !verifyConsultationAccessToken(accessToken, consultation.accessTokenHash)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const released = await releaseClaraBuyerSession(
    consultation.shopifyCustomerKey,
    id,
  );
  if (!released) {
    return NextResponse.json(
      { released: false, error: "Release unavailable" },
      { status: 503 },
    );
  }
  return NextResponse.json({ released: true });
}
