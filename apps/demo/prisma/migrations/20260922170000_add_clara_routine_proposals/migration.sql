-- Routine proposals are written by the voice-agent tool and become durable
-- routines only after the authenticated buyer confirms them in the web UI.
ALTER TABLE "clara_consultations"
ADD COLUMN "routineProposal" JSONB,
ADD COLUMN "routineProposalSummary" TEXT,
ADD COLUMN "routineProposedAt" TIMESTAMP(3),
ADD COLUMN "routineProposalResolvedAt" TIMESTAMP(3),
ADD COLUMN "routineConfirmedAt" TIMESTAMP(3);

CREATE INDEX "clara_consultations_shopifyCustomerKey_routineProposedAt_idx"
ON "clara_consultations"("shopifyCustomerKey", "routineProposedAt");
