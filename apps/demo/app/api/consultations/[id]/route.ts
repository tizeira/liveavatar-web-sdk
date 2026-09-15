import { NextRequest, NextResponse } from "next/server";
import { getClaraConsultation } from "@/src/consultations/repository";
import { verifyConsultationAccessToken } from "@/src/consultations/security";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const accessToken = request.headers.get("x-consultation-token") || "";
  const consultation = await getClaraConsultation(id);

  if (
    !consultation ||
    !verifyConsultationAccessToken(accessToken, consultation.accessTokenHash)
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      consultationId: consultation.consultationId,
      status: consultation.status,
      summary: consultation.summary,
      routine: consultation.routine,
      transcript: consultation.transcript,
    },
    {
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
