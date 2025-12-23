import { useState, useCallback, useRef, useEffect } from "react";

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface OpenAIRealtimeAgentState {
  isConnected: boolean;
  isConnecting: boolean;
  isListening: boolean;
  isThinking: boolean;
  isSpeaking: boolean;
  error: string | null;
  transcript: string | null;
  agentResponse: string | null;
}

export interface UseOpenAIRealtimeAgentConfig {
  voice?:
    | "alloy"
    | "ash"
    | "ballad"
    | "coral"
    | "echo"
    | "sage"
    | "shimmer"
    | "verse";
  model?: "gpt-4o-realtime-preview" | "gpt-4o-mini-realtime-preview";
  instructions?: string;
  onAudioData?: (audioBase64: string) => void;
  onAgentResponse?: (text: string) => void;
  onAgentResponseEnd?: () => void;
  onInterruption?: () => void;
  onUserTranscript?: (text: string) => void;
  onError?: (error: string) => void;
}

export interface UseOpenAIRealtimeAgentReturn extends OpenAIRealtimeAgentState {
  connect: () => Promise<void>;
  disconnect: () => void;
  startListening: () => void;
  stopListening: () => void;
}

// ============================================================================
// Audio Utility Functions
// ============================================================================

// Convert ArrayBuffer to base64 string
function arrayBufferToBase64(buffer: ArrayBuffer | ArrayBufferLike): string {
  const bytes = new Uint8Array(buffer as ArrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

// Convert base64 to ArrayBuffer (kept for potential future use)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Convert Float32Array to Int16Array (PCM 16-bit)
function float32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]!));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Array;
}

// Resample audio from source rate to target rate using linear interpolation
function resampleAudio(
  sourceBuffer: Int16Array,
  sourceRate: number,
  targetRate: number,
): Int16Array {
  if (sourceRate === targetRate) {
    return sourceBuffer;
  }

  const ratio = sourceRate / targetRate;
  const targetLength = Math.round(sourceBuffer.length / ratio);
  const targetBuffer = new Int16Array(targetLength);

  for (let i = 0; i < targetLength; i++) {
    const sourceIndex = i * ratio;
    const indexFloor = Math.floor(sourceIndex);
    const indexCeil = Math.min(indexFloor + 1, sourceBuffer.length - 1);
    const fraction = sourceIndex - indexFloor;

    // Linear interpolation
    targetBuffer[i] = Math.round(
      sourceBuffer[indexFloor]! * (1 - fraction) +
        sourceBuffer[indexCeil]! * fraction,
    );
  }

  return targetBuffer;
}

// ============================================================================
// OpenAI Realtime Event Types
// ============================================================================

interface OpenAISessionCreatedEvent {
  type: "session.created";
  session: {
    id: string;
    model: string;
    voice: string;
  };
}

interface OpenAISessionUpdatedEvent {
  type: "session.updated";
  session: object;
}

interface OpenAISpeechStartedEvent {
  type: "input_audio_buffer.speech_started";
  audio_start_ms: number;
}

interface OpenAISpeechStoppedEvent {
  type: "input_audio_buffer.speech_stopped";
  audio_end_ms: number;
}

interface OpenAITranscriptionCompletedEvent {
  type: "conversation.item.input_audio_transcription.completed";
  transcript: string;
}

interface OpenAIResponseAudioDeltaEvent {
  type: "response.audio.delta";
  delta: string; // base64 encoded PCM16 audio at 24kHz
}

interface OpenAIResponseAudioDoneEvent {
  type: "response.audio.done";
}

interface OpenAIResponseTextDeltaEvent {
  type: "response.audio_transcript.delta";
  delta: string;
}

interface OpenAIResponseCreatedEvent {
  type: "response.created";
  response: { id: string };
}

interface OpenAIResponseDoneEvent {
  type: "response.done";
  response: { id: string; status: string };
}

interface OpenAIErrorEvent {
  type: "error";
  error: {
    type: string;
    code: string;
    message: string;
  };
}

type OpenAIRealtimeEvent =
  | OpenAISessionCreatedEvent
  | OpenAISessionUpdatedEvent
  | OpenAISpeechStartedEvent
  | OpenAISpeechStoppedEvent
  | OpenAITranscriptionCompletedEvent
  | OpenAIResponseAudioDeltaEvent
  | OpenAIResponseAudioDoneEvent
  | OpenAIResponseTextDeltaEvent
  | OpenAIResponseCreatedEvent
  | OpenAIResponseDoneEvent
  | OpenAIErrorEvent
  | { type: string; [key: string]: unknown };

// ============================================================================
// Main Hook
// ============================================================================

export const useOpenAIRealtimeAgent = (
  config: UseOpenAIRealtimeAgentConfig = {},
): UseOpenAIRealtimeAgentReturn => {
  const {
    voice,
    model,
    instructions,
    onAudioData,
    onAgentResponse,
    onAgentResponseEnd,
    onInterruption,
    onUserTranscript,
    onError,
  } = config;

  // State
  const [state, setState] = useState<OpenAIRealtimeAgentState>({
    isConnected: false,
    isConnecting: false,
    isListening: false,
    isThinking: false,
    isSpeaking: false,
    error: null,
    transcript: null,
    agentResponse: null,
  });

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  // Connection state refs (for immediate checks)
  const isConnectingRef = useRef(false);
  const isConnectedRef = useRef(false);

  // OpenAI Realtime uses 24kHz for both input and output
  const OPENAI_SAMPLE_RATE = 24000;

  // Track microphone native sample rate
  const micSampleRateRef = useRef<number>(48000);

  // Reconnection state
  const reconnectAttemptsRef = useRef<number>(0);
  const maxReconnectAttempts = 3;
  const shouldReconnectRef = useRef<boolean>(true);

  // Accumulated response text
  const accumulatedResponseRef = useRef<string>("");

  // ============================================================================
  // Cleanup
  // ============================================================================

  const cleanup = useCallback(() => {
    console.log("[OpenAI] Cleaning up...");

    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current.port.close();
      audioWorkletNodeRef.current = null;
    }

    if (mediaStreamSourceRef.current) {
      mediaStreamSourceRef.current.disconnect();
      mediaStreamSourceRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Reset connection refs
    isConnectingRef.current = false;
    isConnectedRef.current = false;
    accumulatedResponseRef.current = "";

    setState({
      isConnected: false,
      isConnecting: false,
      isListening: false,
      isThinking: false,
      isSpeaking: false,
      error: null,
      transcript: null,
      agentResponse: null,
    });
  }, []);

  // ============================================================================
  // WebSocket Message Handling
  // ============================================================================

  const handleWebSocketMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const data: OpenAIRealtimeEvent = JSON.parse(event.data);

        // Log all events except audio deltas (too verbose)
        if (data.type !== "response.audio.delta") {
          console.log("[OpenAI] Event:", data.type, data);
        }

        switch (data.type) {
          // Session events
          case "session.created":
            console.log("[OpenAI] Session created:", data.session);
            setState((prev) => ({ ...prev, isListening: true }));
            break;

          case "session.updated":
            console.log("[OpenAI] Session updated");
            break;

          // Speech detection (VAD)
          case "input_audio_buffer.speech_started":
            console.log("[OpenAI] User started speaking");
            // User interrupted - clear previous response
            accumulatedResponseRef.current = "";
            setState((prev) => ({
              ...prev,
              isThinking: false,
              isSpeaking: false,
              isListening: true,
            }));
            onInterruption?.();
            break;

          case "input_audio_buffer.speech_stopped":
            console.log("[OpenAI] User stopped speaking");
            setState((prev) => ({ ...prev, isThinking: true }));
            break;

          // User transcription
          case "conversation.item.input_audio_transcription.completed": {
            const transcriptData = data as OpenAITranscriptionCompletedEvent;
            console.log("[OpenAI] User transcript:", transcriptData.transcript);
            setState((prev) => ({
              ...prev,
              transcript: transcriptData.transcript,
            }));
            onUserTranscript?.(transcriptData.transcript);
            break;
          }

          // Response lifecycle
          case "response.created":
            console.log("[OpenAI] Response started");
            accumulatedResponseRef.current = "";
            setState((prev) => ({
              ...prev,
              isThinking: false,
              isSpeaking: true,
            }));
            break;

          // Audio output - ALREADY 24kHz, pass directly to HeyGen!
          case "response.audio.delta": {
            const audioData = data as OpenAIResponseAudioDeltaEvent;
            // delta is base64 encoded PCM16 audio at 24kHz
            // No resampling needed - HeyGen expects 24kHz!
            onAudioData?.(audioData.delta);
            break;
          }

          // Text transcript of agent response
          case "response.audio_transcript.delta": {
            const textData = data as OpenAIResponseTextDeltaEvent;
            accumulatedResponseRef.current += textData.delta;
            setState((prev) => ({
              ...prev,
              agentResponse: accumulatedResponseRef.current,
            }));
            onAgentResponse?.(textData.delta);
            break;
          }

          // Audio complete
          case "response.audio.done":
            console.log("[OpenAI] Audio response complete");
            onAgentResponseEnd?.();
            break;

          // Response complete
          case "response.done": {
            const doneData = data as OpenAIResponseDoneEvent;
            console.log("[OpenAI] Response done:", doneData.response?.status);
            setState((prev) => ({
              ...prev,
              isSpeaking: false,
              isListening: true,
            }));
            break;
          }

          // Error handling
          case "error": {
            const errorData = data as OpenAIErrorEvent;
            console.error("[OpenAI] Error:", errorData.error);
            setState((prev) => ({
              ...prev,
              error: errorData.error.message,
            }));
            onError?.(errorData.error.message);
            break;
          }

          default:
            // Log unknown events for debugging
            if (!data.type.startsWith("rate_limits")) {
              console.log("[OpenAI] Unhandled event:", data.type);
            }
        }
      } catch (e) {
        console.error("[OpenAI] Failed to parse message:", e);
      }
    },
    [
      onAudioData,
      onAgentResponse,
      onAgentResponseEnd,
      onInterruption,
      onUserTranscript,
      onError,
    ],
  );

  // ============================================================================
  // Microphone Capture
  // ============================================================================

  const startMicrophoneCapture = useCallback(async () => {
    try {
      console.log("[OpenAI] Starting microphone capture...");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      audioStreamRef.current = stream;

      // Create AudioContext - we'll capture at native rate and resample to 24kHz
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      // Get actual microphone sample rate
      const actualSampleRate = audioContext.sampleRate;
      micSampleRateRef.current = actualSampleRate;
      console.log("[OpenAI] Microphone sample rate:", actualSampleRate);
      console.log("[OpenAI] Will resample to:", OPENAI_SAMPLE_RATE);

      // Try AudioWorklet first, fallback to ScriptProcessor
      let useWorklet = true;
      try {
        await audioContext.audioWorklet.addModule(
          "/audio-worklet-processor.js",
        );
      } catch (workletError) {
        console.warn(
          "[OpenAI] AudioWorklet not supported, falling back to ScriptProcessor:",
          workletError,
        );
        useWorklet = false;
      }

      const source = audioContext.createMediaStreamSource(stream);
      mediaStreamSourceRef.current = source;

      if (useWorklet) {
        // Modern AudioWorkletNode approach
        const workletNode = new AudioWorkletNode(audioContext, "mic-processor");
        audioWorkletNodeRef.current = workletNode;

        let audioChunkCount = 0;
        workletNode.port.onmessage = (event) => {
          if (
            event.data.type === "audio" &&
            wsRef.current?.readyState === WebSocket.OPEN
          ) {
            const float32Data = event.data.buffer as Float32Array;

            // Convert Float32 to Int16 (PCM 16-bit)
            const pcmData = float32ToInt16(float32Data);

            // Resample from native rate to 24kHz (OpenAI requirement)
            const resampledData = resampleAudio(
              pcmData,
              actualSampleRate,
              OPENAI_SAMPLE_RATE,
            );

            const base64Audio = arrayBufferToBase64(resampledData.buffer);

            // Log every 100th chunk
            audioChunkCount++;
            if (audioChunkCount % 100 === 1) {
              console.log(
                `[OpenAI] Sending audio chunk #${audioChunkCount}, samples: ${resampledData.length}, rate: ${OPENAI_SAMPLE_RATE}Hz`,
              );
            }

            // Send to OpenAI in their expected format
            wsRef.current.send(
              JSON.stringify({
                type: "input_audio_buffer.append",
                audio: base64Audio,
              }),
            );
          }
        };

        source.connect(workletNode);
        console.log("[OpenAI] AudioWorkletNode started");
      } else {
        // Fallback: ScriptProcessorNode (deprecated but widely supported)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const processor = (audioContext as any).createScriptProcessor(
          2048,
          1,
          1,
        );

        let audioChunkCount = 0;
        processor.onaudioprocess = (e: AudioProcessingEvent) => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            const inputData = e.inputBuffer.getChannelData(0);

            // Convert Float32 to Int16
            const pcmData = float32ToInt16(inputData);

            // Resample to 24kHz
            const resampledData = resampleAudio(
              pcmData,
              actualSampleRate,
              OPENAI_SAMPLE_RATE,
            );

            const base64Audio = arrayBufferToBase64(resampledData.buffer);

            audioChunkCount++;
            if (audioChunkCount % 100 === 1) {
              console.log(
                `[OpenAI] ScriptProcessor chunk #${audioChunkCount}, samples: ${resampledData.length}`,
              );
            }

            wsRef.current.send(
              JSON.stringify({
                type: "input_audio_buffer.append",
                audio: base64Audio,
              }),
            );
          }
        };

        source.connect(processor);
        processor.connect(audioContext.destination);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (audioWorkletNodeRef as any).current = processor;
        console.log("[OpenAI] ScriptProcessorNode started (legacy fallback)");
      }

      setState((prev) => ({ ...prev, isListening: true }));
    } catch (error) {
      console.error("[OpenAI] Failed to start microphone:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Microphone access denied";
      setState((prev) => ({ ...prev, error: errorMessage }));
      onError?.(errorMessage);
    }
  }, [onError, OPENAI_SAMPLE_RATE]);

  // ============================================================================
  // Connection
  // ============================================================================

  const connect = useCallback(async () => {
    // Prevent multiple connection attempts
    if (isConnectingRef.current || isConnectedRef.current) {
      console.log("[OpenAI] Already connecting or connected, skipping");
      return;
    }

    isConnectingRef.current = true;
    shouldReconnectRef.current = true;

    console.log("[OpenAI] Connecting...");

    try {
      cleanup();
      setState((prev) => ({ ...prev, error: null, isConnecting: true }));

      // Get ephemeral token from our API
      console.log("[OpenAI] Fetching ephemeral token...");
      const res = await fetch("/api/openai-realtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice, model, instructions }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to get ephemeral token");
      }

      const { clientSecret, sessionId } = await res.json();
      console.log("[OpenAI] Got ephemeral token for session:", sessionId);

      // Connect WebSocket with ephemeral token
      // Note: Browser WebSocket doesn't support custom headers, so we use the token in the URL
      const wsUrl = `wss://api.openai.com/v1/realtime?model=${model || "gpt-4o-mini-realtime-preview"}`;

      // Create WebSocket with subprotocols for auth (OpenAI's approach for browser)
      const ws = new WebSocket(wsUrl, [
        "realtime",
        `openai-insecure-api-key.${clientSecret}`,
        "openai-beta.realtime-v1",
      ]);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[OpenAI] WebSocket connected");
        isConnectedRef.current = true;
        isConnectingRef.current = false;
        reconnectAttemptsRef.current = 0;

        setState((prev) => ({
          ...prev,
          isConnected: true,
          isConnecting: false,
        }));

        // Start microphone capture
        startMicrophoneCapture();
      };

      ws.onmessage = (event) => {
        handleWebSocketMessage(event);
      };

      ws.onerror = (error) => {
        console.error("[OpenAI] WebSocket error:", error);
        isConnectingRef.current = false;
        setState((prev) => ({
          ...prev,
          error: "WebSocket connection error",
        }));
        onError?.("WebSocket connection error");
      };

      ws.onclose = (event) => {
        console.log("[OpenAI] WebSocket closed:", event.code, event.reason);
        isConnectedRef.current = false;
        isConnectingRef.current = false;
        setState((prev) => ({ ...prev, isConnected: false }));

        // Auto-reconnect on abnormal closure
        if (
          (event.code === 1005 || event.code === 1006) &&
          shouldReconnectRef.current
        ) {
          if (reconnectAttemptsRef.current < maxReconnectAttempts) {
            reconnectAttemptsRef.current++;
            const delay = Math.min(1000 * reconnectAttemptsRef.current, 5000);
            console.log(
              `[OpenAI] Abnormal close (${event.code}), reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`,
            );
            setTimeout(() => {
              if (shouldReconnectRef.current) {
                connect();
              }
            }, delay);
          } else {
            console.log("[OpenAI] Max reconnect attempts reached");
            onError?.("Connection lost. Please refresh the page.");
          }
        } else if (event.code !== 1000) {
          onError?.(
            `WebSocket closed: ${event.code} - ${event.reason || "Unknown reason"}`,
          );
        }
      };
    } catch (error) {
      isConnectingRef.current = false;
      const errorMessage =
        error instanceof Error ? error.message : "Connection failed";
      setState((prev) => ({
        ...prev,
        error: errorMessage,
        isConnecting: false,
      }));
      onError?.(errorMessage);
    }
  }, [
    cleanup,
    voice,
    model,
    instructions,
    onError,
    handleWebSocketMessage,
    startMicrophoneCapture,
  ]);

  // ============================================================================
  // Disconnect
  // ============================================================================

  const disconnect = useCallback(() => {
    console.log("[OpenAI] Disconnecting...");
    shouldReconnectRef.current = false;
    cleanup();
  }, [cleanup]);

  // ============================================================================
  // Start/Stop Listening (Mute functionality)
  // ============================================================================

  const startListening = useCallback(() => {
    if (audioContextRef.current?.state === "suspended") {
      audioContextRef.current.resume();
      setState((prev) => ({ ...prev, isListening: true }));
    } else if (
      !audioContextRef.current &&
      wsRef.current?.readyState === WebSocket.OPEN
    ) {
      startMicrophoneCapture();
    }
  }, [startMicrophoneCapture]);

  const stopListening = useCallback(() => {
    if (audioContextRef.current?.state === "running") {
      audioContextRef.current.suspend();
      setState((prev) => ({ ...prev, isListening: false }));
    }
  }, []);

  // ============================================================================
  // Cleanup on Unmount
  // ============================================================================

  const cleanupRef = useRef(cleanup);
  cleanupRef.current = cleanup;

  useEffect(() => {
    let isRealUnmount = false;

    const timeoutId = setTimeout(() => {
      isRealUnmount = true;
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      if (isRealUnmount || isConnectedRef.current) {
        cleanupRef.current();
      }
    };
  }, []);

  // ============================================================================
  // Return
  // ============================================================================

  return {
    ...state,
    connect,
    disconnect,
    startListening,
    stopListening,
  };
};
