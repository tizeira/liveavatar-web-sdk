import { NextRequest, NextResponse } from "next/server";
import { CRON_SECRET } from "@/app/api/secrets";
import { runConsultationRetention } from "@/src/consultations/repository";
import { hasValidCronSecret } from "@/src/consultations/security";

export async function GET(request: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json(
      { error: "Service not configured" },
      { status: 503 },
    );
  }
  if (!hasValidCronSecret(request.headers.get("authorization"), CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runConsultationRetention();
  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
