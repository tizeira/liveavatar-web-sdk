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

  const consultation = await getClaraConsultationAccessContext(id);
  if (
    !consultation ||
    !verifyConsultationAccessToken(accessToken, consultation.accessTokenHash)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await releaseClaraBuyerSession(consultation.shopifyCustomerKey, id);
  return NextResponse.json({ released: true });
}
