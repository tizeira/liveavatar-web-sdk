import { auth } from "@/auth";
import { OPENAI_API_KEY } from "../secrets";

// OpenAI Realtime API configuration
const OPENAI_REALTIME_MODEL =
  process.env.OPENAI_REALTIME_MODEL || "gpt-4o-mini-realtime-preview";
const OPENAI_REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || "alloy";

// System instructions for the voice agent
const SYSTEM_INSTRUCTIONS =
  process.env.OPENAI_REALTIME_INSTRUCTIONS ||
  `Eres Clara, una asistente virtual amigable y profesional especializada en belleza y cuidado personal.
Responde de forma concisa y natural, como en una conversación real.
Mantén un tono cálido y cercano.
Si no sabes algo, admítelo honestamente.
Responde siempre en español a menos que el usuario hable en otro idioma.`;

export async function POST(request: Request) {
  // Auth guard
  const session = await auth();
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log("=== OpenAI Realtime API Called ===");
  console.log("OPENAI_API_KEY exists:", !!OPENAI_API_KEY);
  console.log("Model:", OPENAI_REALTIME_MODEL);
  console.log("Voice:", OPENAI_REALTIME_VOICE);

  try {
    // Parse optional configuration from request body
    let model = OPENAI_REALTIME_MODEL;
    let voice = OPENAI_REALTIME_VOICE;
    let instructions = SYSTEM_INSTRUCTIONS;

    try {
      const body = await request.json();
      if (body.model) model = body.model;
      if (body.voice) voice = body.voice;
      if (body.instructions) instructions = body.instructions;
    } catch {
      // No body or invalid JSON, use defaults
    }

    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "OpenAI API key not configured" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Create ephemeral token via OpenAI REST API
    // POST /v1/realtime/sessions - creates session with ephemeral client_secret
    const res = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        voice,
        instructions,
        modalities: ["text", "audio"],
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: {
          model: "whisper-1",
        },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
      }),
    });

    if (!res.ok) {
      const errorData = await res.text();
      console.error("OpenAI Realtime API error:", errorData);
      return new Response(
        JSON.stringify({
          error: "Failed to create realtime session",
          details: errorData,
        }),
        {
          status: res.status,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const data = await res.json();
    console.log("OpenAI Realtime session created successfully");
    console.log("Session ID:", data.id);
    console.log(
      "Client secret expires at:",
      data.client_secret?.expires_at
        ? new Date(data.client_secret.expires_at * 1000).toISOString()
        : "unknown",
    );

    // Return the client secret for WebSocket connection
    // The client will use this to connect directly to OpenAI
    return new Response(
      JSON.stringify({
        clientSecret: data.client_secret?.value,
        sessionId: data.id,
        model: data.model,
        voice: data.voice,
        expiresAt: data.client_secret?.expires_at,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error creating realtime session:", error);
    return new Response(
      JSON.stringify({ error: "Failed to create realtime session" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
