-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ClaraConsultationStatus" AS ENUM ('pending', 'routine_ready', 'completed', 'failed');

-- CreateTable
CREATE TABLE "clara_consultations" (
    "id" UUID NOT NULL,
    "accessTokenHash" TEXT NOT NULL,
    "shopifyCustomerKey" TEXT,
    "liveAvatarSessionId" TEXT,
    "elevenLabsConversationId" TEXT,
    "status" "ClaraConsultationStatus" NOT NULL DEFAULT 'pending',
    "transcript" JSONB,
    "analysisMetrics" JSONB,
    "summary" TEXT,
    "routine" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "transcriptExpiresAt" TIMESTAMP(3) NOT NULL,
    "recordExpiresAt" TIMESTAMP(3) NOT NULL,
    "metricsRecordedAt" TIMESTAMP(3),
    "routineMetricRecordedAt" TIMESTAMP(3),

    CONSTRAINT "clara_consultations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clara_daily_metrics" (
    "date" DATE NOT NULL,
    "consultationsCompleted" INTEGER NOT NULL DEFAULT 0,
    "consultationsWithRoutine" INTEGER NOT NULL DEFAULT 0,
    "consultationsFailed" INTEGER NOT NULL DEFAULT 0,
    "transcriptsPurged" INTEGER NOT NULL DEFAULT 0,
    "recordsPurged" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clara_daily_metrics_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE UNIQUE INDEX "clara_consultations_liveAvatarSessionId_key" ON "clara_consultations"("liveAvatarSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "clara_consultations_elevenLabsConversationId_key" ON "clara_consultations"("elevenLabsConversationId");

-- CreateIndex
CREATE INDEX "clara_consultations_shopifyCustomerKey_completedAt_idx" ON "clara_consultations"("shopifyCustomerKey", "completedAt");

-- CreateIndex
CREATE INDEX "clara_consultations_status_idx" ON "clara_consultations"("status");

-- CreateIndex
CREATE INDEX "clara_consultations_transcriptExpiresAt_idx" ON "clara_consultations"("transcriptExpiresAt");

-- CreateIndex
CREATE INDEX "clara_consultations_recordExpiresAt_idx" ON "clara_consultations"("recordExpiresAt");
