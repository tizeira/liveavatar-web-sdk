import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

process.env.ELEVENLABS_WEBHOOK_SECRET = "test-webhook-secret";
process.env.ELEVENLABS_AGENT_ID = "test-agent-id";

const mockCompleteConsultation = vi.fn();

vi.mock("@/src/consultations/repository", () => ({
  completeClaraConsultation: (...args: unknown[]) =>
    mockCompleteConsultation(...args),
}));

const { POST } = await import("@/app/api/webhooks/elevenlabs/route");

function signedRequest(body: unknown, valid = true) {
  const rawBody = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const digest = createHmac("sha256", "test-webhook-secret")
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return new NextRequest("http://localhost:3001/api/webhooks/elevenlabs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "elevenlabs-signature": `t=${timestamp},v0=${valid ? digest : "invalid"}`,
    },
    body: rawBody,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCompleteConsultation.mockResolvedValue({});
});

describe("ElevenLabs post-call webhook", () => {
  it("rejects a forged signature", async () => {
    const response = await POST(
      signedRequest({ type: "post_call_transcription" }, false),
    );
    expect(response.status).toBe(401);
    expect(mockCompleteConsultation).not.toHaveBeenCalled();
  });

  it("stores the provider transcript and summary without re-analyzing them", async () => {
    const consultationId = "51bcaeed-9e1b-4c75-ad05-7b23fbd9d46f";
    const response = await POST(
      signedRequest({
        type: "post_call_transcription",
        data: {
          agent_id: "test-agent-id",
          conversation_id: "conversation-redacted",
          transcript: [
            {
              role: "user",
              message: "Necesito hidratación",
              time_in_call_secs: 3,
            },
            {
              role: "agent",
              message: "Vamos a armar una rutina",
              time_in_call_secs: 5,
            },
            { role: "user", message: "[START]", time_in_call_secs: 0 },
          ],
          analysis: {
            transcript_summary: "La persona consultó por hidratación.",
          },
          conversation_initiation_client_data: {
            dynamic_variables: { consultation_id: consultationId },
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mockCompleteConsultation).toHaveBeenCalledWith({
      consultationId,
      elevenLabsConversationId: "conversation-redacted",
      transcript: [
        { role: "user", message: "Necesito hidratación", timeInCallSecs: 3 },
        {
          role: "agent",
          message: "Vamos a armar una rutina",
          timeInCallSecs: 5,
        },
      ],
      analysisMetrics: {
        callSuccessful: null,
        durationSecs: null,
        sentiment: null,
        terminationReason: null,
      },
      summary: "La persona consultó por hidratación.",
    });
  });

  it("prefers the allowlisted Spanish user summary from data collection", async () => {
    const consultationId = "51bcaeed-9e1b-4c75-ad05-7b23fbd9d46f";
    const response = await POST(
      signedRequest({
        type: "post_call_transcription",
        data: {
          agent_id: "test-agent-id",
          conversation_id: "conversation-redacted",
          transcript: [],
          analysis: {
            transcript_summary: "English fallback containing a full name.",
            data_collection_results: {
              resumen_usuario: {
                value:
                  "Conversaste sobre hidratación y acordaste una rutina gradual.",
                rationale: "Must not be persisted",
              },
              ignored_private_field: { value: "Must not be persisted" },
            },
          },
          conversation_initiation_client_data: {
            dynamic_variables: { consultation_id: consultationId },
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mockCompleteConsultation).toHaveBeenCalledWith(
      expect.objectContaining({
        summary:
          "Conversaste sobre hidratación y acordaste una rutina gradual.",
      }),
    );
    expect(
      JSON.stringify(mockCompleteConsultation.mock.calls[0]),
    ).not.toContain("Must not be persisted");
  });

  it("falls back safely when the collected summary is malformed", async () => {
    const consultationId = "51bcaeed-9e1b-4c75-ad05-7b23fbd9d46f";
    const response = await POST(
      signedRequest({
        type: "post_call_transcription",
        data: {
          agent_id: "test-agent-id",
          conversation_id: "conversation-redacted",
          transcript: [],
          analysis: {
            transcript_summary: "Resumen de respaldo.",
            data_collection_results: {
              resumen_usuario: { value: { unsafe: true } },
            },
          },
          conversation_initiation_client_data: {
            dynamic_variables: { consultation_id: consultationId },
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mockCompleteConsultation).toHaveBeenCalledWith(
      expect.objectContaining({ summary: "Resumen de respaldo." }),
    );
  });

  it("redacts a personal name from the user-facing summary", async () => {
    const consultationId = "51bcaeed-9e1b-4c75-ad05-7b23fbd9d46f";
    const response = await POST(
      signedRequest({
        type: "post_call_transcription",
        data: {
          agent_id: "test-agent-id",
          conversation_id: "conversation-redacted",
          transcript: [],
          analysis: {
            data_collection_results: {
              resumen_usuario: {
                value: "Cliente Iván Tizeira busca una rutina hidratante.",
              },
            },
          },
          conversation_initiation_client_data: {
            dynamic_variables: { consultation_id: consultationId },
          },
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mockCompleteConsultation).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: "La persona busca una rutina hidratante.",
      }),
    );
  });

  it("returns a retryable error when persistence fails", async () => {
    mockCompleteConsultation.mockRejectedValueOnce(new Error("db unavailable"));
    const response = await POST(
      signedRequest({
        type: "post_call_transcription",
        data: {
          agent_id: "test-agent-id",
          conversation_id: "conversation-redacted",
          transcript: [],
          analysis: {},
          conversation_initiation_client_data: {
            dynamic_variables: {
              consultation_id: "51bcaeed-9e1b-4c75-ad05-7b23fbd9d46f",
            },
          },
        },
      }),
    );
    expect(response.status).toBe(503);
  });
});
