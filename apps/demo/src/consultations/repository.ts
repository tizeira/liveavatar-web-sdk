import { ClaraConsultationStatus, Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db/prisma";
import type {
  ClaraConsultationResult,
  ClaraRoutine,
  ClaraTranscriptTurn,
} from "./types";

const TRANSCRIPT_RETENTION_DAYS = 30;
const RECORD_RETENTION_MONTHS = 12;
const CLEANUP_BATCH_SIZE = 500;

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

function utcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function toResult(consultation: {
  id: string;
  status: ClaraConsultationStatus;
  summary: string | null;
  routine: Prisma.JsonValue | null;
  transcript: Prisma.JsonValue | null;
}): ClaraConsultationResult {
  return {
    consultationId: consultation.id,
    status: consultation.status,
    summary: consultation.summary,
    routine: consultation.routine as ClaraRoutine | null,
    transcript: (consultation.transcript || []) as ClaraTranscriptTurn[],
  };
}

export async function createClaraConsultation(input: {
  id: string;
  accessTokenHash: string;
  liveAvatarSessionId: string;
  shopifyCustomerKey?: string;
}) {
  const now = new Date();
  return prisma.claraConsultation.create({
    data: {
      ...input,
      transcriptExpiresAt: addDays(now, TRANSCRIPT_RETENTION_DAYS),
      recordExpiresAt: addMonths(now, RECORD_RETENTION_MONTHS),
    },
  });
}

export async function saveClaraRoutine(
  consultationId: string,
  summary: string,
  routine: ClaraRoutine,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.claraConsultation.findUniqueOrThrow({
      where: { id: consultationId },
      select: {
        status: true,
        completedAt: true,
        routineMetricRecordedAt: true,
      },
    });
    const updated = await tx.claraConsultation.update({
      where: { id: consultationId },
      data: {
        summary,
        routine: routine as unknown as Prisma.InputJsonValue,
        status:
          existing.status === ClaraConsultationStatus.completed
            ? ClaraConsultationStatus.completed
            : ClaraConsultationStatus.routine_ready,
      },
    });
    const routineMetricClaim =
      existing.status === ClaraConsultationStatus.completed
        ? await tx.claraConsultation.updateMany({
            where: {
              id: consultationId,
              metricsRecordedAt: { not: null },
              routineMetricRecordedAt: null,
            },
            data: { routineMetricRecordedAt: new Date() },
          })
        : { count: 0 };
    if (routineMetricClaim.count === 1) {
      const metricDate = utcDay(existing.completedAt || new Date());
      await tx.claraDailyMetric.upsert({
        where: { date: metricDate },
        create: { date: metricDate, consultationsWithRoutine: 1 },
        update: { consultationsWithRoutine: { increment: 1 } },
      });
    }
    return updated;
  });
}

export async function completeClaraConsultation(input: {
  consultationId: string;
  elevenLabsConversationId: string;
  transcript: ClaraTranscriptTurn[];
  analysisMetrics: Record<string, unknown>;
  summary: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.claraConsultation.findUniqueOrThrow({
      where: { id: input.consultationId },
    });
    if (
      existing.elevenLabsConversationId &&
      existing.elevenLabsConversationId !== input.elevenLabsConversationId
    ) {
      throw new Error("Consultation is already linked to another conversation");
    }

    const completedAt = existing.completedAt || new Date();
    const updated = await tx.claraConsultation.update({
      where: { id: input.consultationId },
      data: {
        elevenLabsConversationId: input.elevenLabsConversationId,
        transcript: input.transcript,
        analysisMetrics:
          input.analysisMetrics as unknown as Prisma.InputJsonValue,
        summary: input.summary || undefined,
        status: ClaraConsultationStatus.completed,
        completedAt,
        transcriptExpiresAt: addDays(completedAt, TRANSCRIPT_RETENTION_DAYS),
        recordExpiresAt: addMonths(completedAt, RECORD_RETENTION_MONTHS),
      },
    });

    const metricClaim = await tx.claraConsultation.updateMany({
      where: { id: input.consultationId, metricsRecordedAt: null },
      data: {
        metricsRecordedAt: new Date(),
        ...(existing.routine ? { routineMetricRecordedAt: new Date() } : {}),
      },
    });
    if (metricClaim.count === 1) {
      await tx.claraDailyMetric.upsert({
        where: { date: utcDay(completedAt) },
        create: {
          date: utcDay(completedAt),
          consultationsCompleted: 1,
          consultationsWithRoutine: existing.routine ? 1 : 0,
        },
        update: {
          consultationsCompleted: { increment: 1 },
          ...(existing.routine
            ? { consultationsWithRoutine: { increment: 1 } }
            : {}),
        },
      });
    }

    return updated;
  });
}

export async function getClaraConsultation(consultationId: string) {
  const consultation = await prisma.claraConsultation.findUnique({
    where: { id: consultationId },
  });
  if (!consultation || consultation.recordExpiresAt <= new Date()) return null;
  return {
    ...toResult(consultation),
    accessTokenHash: consultation.accessTokenHash,
  };
}

export async function getLatestClaraConsultation(shopifyCustomerKey: string) {
  const consultation = await prisma.claraConsultation.findFirst({
    where: {
      shopifyCustomerKey,
      recordExpiresAt: { gt: new Date() },
      status: {
        in: [
          ClaraConsultationStatus.routine_ready,
          ClaraConsultationStatus.completed,
        ],
      },
    },
    orderBy: [{ completedAt: "desc" }, { updatedAt: "desc" }],
  });
  return consultation ? toResult(consultation) : null;
}

export async function runConsultationRetention(now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const expiredTranscriptIds = (
      await tx.claraConsultation.findMany({
        where: {
          transcriptExpiresAt: { lte: now },
          transcript: { not: Prisma.DbNull },
        },
        select: { id: true },
        take: CLEANUP_BATCH_SIZE,
      })
    ).map(({ id }) => id);

    const expiredRecordIds = (
      await tx.claraConsultation.findMany({
        where: { recordExpiresAt: { lte: now } },
        select: { id: true },
        take: CLEANUP_BATCH_SIZE,
      })
    ).map(({ id }) => id);

    const transcriptsPurged = expiredTranscriptIds.length
      ? (
          await tx.claraConsultation.updateMany({
            where: { id: { in: expiredTranscriptIds } },
            data: { transcript: Prisma.DbNull },
          })
        ).count
      : 0;
    const recordsPurged = expiredRecordIds.length
      ? (
          await tx.claraConsultation.deleteMany({
            where: { id: { in: expiredRecordIds } },
          })
        ).count
      : 0;

    if (transcriptsPurged || recordsPurged) {
      await tx.claraDailyMetric.upsert({
        where: { date: utcDay(now) },
        create: { date: utcDay(now), transcriptsPurged, recordsPurged },
        update: {
          transcriptsPurged: { increment: transcriptsPurged },
          recordsPurged: { increment: recordsPurged },
        },
      });
    }
    return { transcriptsPurged, recordsPurged };
  });
}
