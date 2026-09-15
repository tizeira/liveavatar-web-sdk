import { NextRequest, NextResponse } from "next/server";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import {
  ELEVENLABS_AGENT_ID,
  ELEVENLABS_API_KEY,
  ELEVENLABS_WEBHOOK_SECRET,
} from "@/app/api/secrets";
import { completeClaraConsultation } from "@/src/consultations/repository";
import type { ClaraTranscriptTurn } from "@/src/consultations/types";
import { sanitizeUserFacingSummary } from "@/src/consultations/privacy";

const elevenlabs = new ElevenLabsClient({ apiKey: ELEVENLABS_API_KEY });

function stringValue(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function normalizeTranscript(value: unknown): ClaraTranscriptTurn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((turn): ClaraTranscriptTurn[] => {
    if (!turn || typeof turn !== "object") return [];
    const record = turn as Record<string, unknown>;
    const role =
      record.role === "user"
        ? "user"
        : record.role === "agent"
          ? "agent"
          : null;
    const message = stringValue(record.message, 4000);
    if (!role || !message || message === "[START]") return [];
    return [
      {
        role,
        message,
        ...(typeof record.time_in_call_secs === "number"
          ? { timeInCallSecs: record.time_in_call_secs }
          : {}),
      },
    ];
  });
}

function userFacingSummary(analysis: Record<string, unknown>): string | null {
  const dataCollection =
    analysis.data_collection_results &&
    typeof analysis.data_collection_results === "object"
      ? (analysis.data_collection_results as Record<string, unknown>)
      : {};
  const collectedSummary =
    dataCollection.resumen_usuario &&
    typeof dataCollection.resumen_usuario === "object"
      ? (dataCollection.resumen_usuario as Record<string, unknown>)
      : {};

  const summary =
    stringValue(collectedSummary.value, 1200) ||
    stringValue(analysis.transcript_summary, 4000);
  return summary ? sanitizeUserFacingSummary(summary) : null;
}

function allowlistedAnalysisMetrics(
  analysis: Record<string, unknown>,
  metadata: Record<string, unknown>,
) {
  return {
    callSuccessful: stringValue(analysis.call_successful, 32),
    sentiment: stringValue(
      (analysis.sentiment_analysis as Record<string, unknown> | undefined)
        ?.overall_label,
      32,
    ),
    durationSecs:
      typeof metadata.call_duration_secs === "number"
        ? metadata.call_duration_secs
        : null,
    terminationReason: stringValue(metadata.termination_reason, 120),
  };
}

export async function POST(request: NextRequest) {
  if (!ELEVENLABS_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get("elevenlabs-signature") || "";

  let event: unknown;
  try {
    event = await elevenlabs.webhooks.constructEvent(
      rawBody,
      signature,
      ELEVENLABS_WEBHOOK_SECRET,
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!event || typeof event !== "object") {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }
  const envelope = event as Record<string, unknown>;
  if (envelope.type !== "post_call_transcription") {
    return NextResponse.json({ received: true });
  }

  const data = envelope.data as Record<string, unknown> | undefined;
  if (!data || data.agent_id !== ELEVENLABS_AGENT_ID) {
    return NextResponse.json({ error: "Unknown agent" }, { status: 403 });
  }

  const clientData = data.conversation_initiation_client_data as
    | Record<string, unknown>
    | undefined;
  const variables = clientData?.dynamic_variables as
    | Record<string, unknown>
    | undefined;
  const consultationId = stringValue(variables?.consultation_id, 64);
  const conversationId = stringValue(data.conversation_id, 128);
  if (!consultationId || !conversationId) {
    return NextResponse.json(
      { error: "Missing consultation correlation" },
      { status: 422 },
    );
  }

  const analysis =
    data.analysis && typeof data.analysis === "object"
      ? (data.analysis as Record<string, unknown>)
      : {};
  const summary = userFacingSummary(analysis);
  const metadata =
    data.metadata && typeof data.metadata === "object"
      ? (data.metadata as Record<string, unknown>)
      : {};

  try {
    await completeClaraConsultation({
      consultationId,
      elevenLabsConversationId: conversationId,
      transcript: normalizeTranscript(data.transcript),
      analysisMetrics: allowlistedAnalysisMetrics(analysis, metadata),
      summary,
    });
  } catch {
    // ElevenLabs retries 5xx post-call deliveries. Never acknowledge a
    // persistence failure as successful or log the transcript payload.
    return NextResponse.json(
      { error: "Consultation persistence failed" },
      { status: 503 },
    );
  }

  return NextResponse.json({ received: true });
}
