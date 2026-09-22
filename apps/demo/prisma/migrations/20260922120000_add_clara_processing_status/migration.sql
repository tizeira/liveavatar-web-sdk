-- A normal client release must free the active-session lease without
-- classifying a consultation as failed while ElevenLabs post-call processing
-- is still pending.
ALTER TYPE "ClaraConsultationStatus" ADD VALUE IF NOT EXISTS 'processing' AFTER 'routine_ready';
