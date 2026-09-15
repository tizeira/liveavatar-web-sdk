import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/db/prisma";
import {
  completeClaraConsultation,
  createClaraConsultation,
  getClaraConsultation,
  getLatestClaraConsultation,
  runConsultationRetention,
  saveClaraRoutine,
} from "@/src/consultations/repository";
import {
  hashConsultationAccessToken,
  verifyConsultationAccessToken,
} from "@/src/consultations/security";

const enabled = process.env.RUN_NEON_INTEGRATION === "1";
const firstId = "c0dec0de-0000-4000-8000-000000000001";
const secondId = "c0dec0de-0000-4000-8000-000000000002";
const ids = [firstId, secondId];

describe.skipIf(!enabled)("Clara repository against isolated Neon QA", () => {
  afterAll(async () => {
    await prisma.claraConsultation.deleteMany({ where: { id: { in: ids } } });
    await prisma.claraDailyMetric.deleteMany({
      where: { date: new Date("2026-09-14T00:00:00.000Z") },
    });
    await prisma.$disconnect();
  });

  it("enforces access, idempotency, customer isolation and retention", async () => {
    await prisma.claraConsultation.deleteMany({ where: { id: { in: ids } } });
    const token = "integration-browser-secret";
    const customerA = "a".repeat(64);
    const customerB = "b".repeat(64);

    await createClaraConsultation({
      id: firstId,
      accessTokenHash: hashConsultationAccessToken(token),
      liveAvatarSessionId: "integration-liveavatar-a",
      shopifyCustomerKey: customerA,
    });
    const pending = await getClaraConsultation(firstId);
    expect(pending).not.toBeNull();
    expect(verifyConsultationAccessToken(token, pending!.accessTokenHash)).toBe(
      true,
    );
    expect(
      verifyConsultationAccessToken("wrong", pending!.accessTokenHash),
    ).toBe(false);

    const completion = {
      consultationId: firstId,
      elevenLabsConversationId: "integration-elevenlabs-a",
      transcript: [{ role: "user" as const, message: "Consulta ficticia" }],
      analysisMetrics: { callSuccessful: "success" },
      summary: "Resumen ficticio",
    };
    await completeClaraConsultation(completion);
    await completeClaraConsultation(completion);

    const routine = {
      concerns: ["hydration"],
      cautions: [],
      steps: [
        {
          moment: "morning" as const,
          order: 1,
          instruction: "Aplicar una cantidad pequeña.",
          product: null,
        },
      ],
    };
    await saveClaraRoutine(firstId, "Resumen con rutina", routine);
    await saveClaraRoutine(firstId, "Resumen con rutina", routine);

    expect((await getLatestClaraConsultation(customerA))?.routine).toEqual(
      routine,
    );
    expect(await getLatestClaraConsultation(customerB)).toBeNull();

    await createClaraConsultation({
      id: secondId,
      accessTokenHash: hashConsultationAccessToken("retention-token"),
      liveAvatarSessionId: "integration-liveavatar-b",
    });
    const oldDate = new Date("2024-01-01T00:00:00.000Z");
    await prisma.claraConsultation.update({
      where: { id: secondId },
      data: {
        transcript: [{ role: "user", message: "Expirada" }],
        transcriptExpiresAt: oldDate,
        recordExpiresAt: oldDate,
      },
    });
    const cleanup = await runConsultationRetention(
      new Date("2026-09-14T12:00:00.000Z"),
    );
    expect(cleanup.transcriptsPurged).toBeGreaterThanOrEqual(1);
    expect(cleanup.recordsPurged).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.claraConsultation.findUnique({ where: { id: secondId } }),
    ).toBeNull();

    const metric = await prisma.claraDailyMetric.findFirst({
      where: { consultationsCompleted: { gte: 1 } },
    });
    expect(metric?.consultationsCompleted).toBe(1);
    expect(metric?.consultationsWithRoutine).toBe(1);
  }, 30_000);
});
