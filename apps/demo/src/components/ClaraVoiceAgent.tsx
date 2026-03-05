"use client";

import React, { useEffect, useRef, useCallback, useState } from "react";
import {
  SessionState,
  ConnectionQuality,
  AgentEventsEnum,
} from "@heygen/liveavatar-web-sdk";
import {
  LiveAvatarContextProvider,
  useSession,
  useLiveAvatarContext,
  WidgetState,
  CustomerData,
} from "../liveavatar";
import {
  useScreenSize,
  useFixedHeight,
  useElevenLabsAgent,
  VadInfo,
} from "../hooks";

import Image from "next/image";

// Lucide icons
import { Phone, PhoneOff, Mic, MicOff, Loader2, Clock } from "lucide-react";

// Toast notifications
import { toast } from "sonner";

// ============================================
// DEVICE DETECTION (runtime, not module-level)
// ============================================
const isMobileDevice = (): boolean => {
  if (typeof window === "undefined") return false;
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
};

// ============================================
// SESSION LIMIT CONFIGURATION
// ============================================
// Toggle: false = no limit (beta), true = enforce limit (production)
const SESSION_LIMIT_ENABLED = true;
// Maximum session duration in minutes
const SESSION_LIMIT_MINUTES = 10;
// Warning before session ends (in seconds)
const SESSION_WARNING_SECONDS = 30;

// ============================================
// SMART INTERRUPTION CONFIGURATION
// ============================================
// Filter out noise and brief sounds from triggering interruptions
// NOTE: onInterruption now trusts ElevenLabs detection directly (no filtering)
// These constants are only used in onUserTranscript for late transcript detection

// Minimum VAD score to consider valid speech (0-1 range from ElevenLabs)
const MIN_VAD_SCORE_FOR_INTERRUPT = 0.5;

// Enable/disable smart interruption filtering in onUserTranscript (set false for original behavior)
const SMART_INTERRUPTION_ENABLED = true;

// ============================================
// INTERRUPT RACE CONDITION PROTECTION
// ============================================
// Time window after interrupt where we block sending audio to HeyGen
// Prevents race condition where sendAllAudioToAvatar() continues after interrupt
const INTERRUPT_BLOCK_WINDOW_MS = 500;

// ============================================
// AUDIO FADE-OUT CONFIGURATION
// ============================================
// Smooth fade-out when user interrupts (instead of abrupt cut)
const AUDIO_FADE_ENABLED = true;
const AUDIO_FADE_DURATION_MS = 250; // 200-300ms recommended

// ============================================
// HYBRID AUDIO STRATEGY CONSTANTS
// ============================================
// These are DESKTOP defaults - mobile overrides happen at runtime in component

// Smart Chunking: Split large audio to avoid HeyGen 1MB limit
const MAX_AUDIO_SIZE_BYTES = 800 * 1024; // 800KB per chunk (~16s audio)
const CHUNK_WAIT_TIMEOUT_MS = 20000; // 20s timeout per chunk

// Ghost chunk protection: Ignore chunks arriving shortly after interrupt
const INTERRUPT_DEBOUNCE_MS = 300; // Ignore chunks for 300ms after interrupt

// Late transcript protection: Ignore user transcripts arriving shortly after audio sent
// On mobile, transcripts can arrive 3-50ms after audio was already sent to HeyGen
// Users cannot realistically interrupt within 100ms of receiving audio
const AUDIO_SENT_GRACE_PERIOD_MS = 100;

// Target sample rate for HeyGen
const TARGET_SAMPLE_RATE = 24000;

// ============================================
// DESKTOP vs MOBILE AUDIO CONFIG
// ============================================
// Desktop: Can handle larger buffers, longer gaps, works well with immediate send
// Mobile: Needs smaller buffers, shorter gaps, and careful timing
interface AudioConfig {
  gapThreshold: number; // ms gap to detect end of stream
  maxBufferSamples: number; // Max samples before forced processing
  phase1LeadingSilence: number; // Silence before first audio
  phase1TrailingSilence: number;
  phase2LeadingSilence: number; // Silence before subsequent audio
  phase2TrailingSilence: number;
  immediateFirstChunk: boolean; // Send first chunk without delay?
}

const DESKTOP_CONFIG: AudioConfig = {
  gapThreshold: 250,
  maxBufferSamples: 64000, // 4s @ 16kHz
  phase1LeadingSilence: 30, // Minimal - HeyGen handles it well
  phase1TrailingSilence: 0,
  phase2LeadingSilence: 50,
  phase2TrailingSilence: 150,
  immediateFirstChunk: true, // Works great on desktop
};

const MOBILE_CONFIG: AudioConfig = {
  gapThreshold: 150, // More sensitive for burst delivery
  maxBufferSamples: 48000, // 3s @ 16kHz - prevents premature buffer limit
  phase1LeadingSilence: 100, // More time for HeyGen to wake up on mobile
  phase1TrailingSilence: 0,
  phase2LeadingSilence: 80,
  phase2TrailingSilence: 150,
  immediateFirstChunk: true, // Still send immediately, but with more silence
};

// GREETING FIX: Skip immediate send for greeting to accumulate more audio
// This prevents fragmentation of the greeting message on mobile devices
const GREETING_SKIP_PHASE1 = true;

/**
 * Get minimum samples required for PHASE 1 immediate send.
 *
 * CRITICAL CONSTRAINT: Must be LESS than maxBufferSamples to avoid
 * truncation from BUFFER LIMIT override.
 *
 * Desktop: 48000 samples (3.0s @ 16kHz)
 *   - maxBufferSamples: 64000 (4.0s)
 *   - Safety margin: 16000 samples (1.0s)
 *   - Rationale: Works perfectly, no changes needed
 *
 * Mobile: 36000 samples (2.25s @ 16kHz)
 *   - maxBufferSamples: 48000 (3.0s)
 *   - Safety margin: 12000 samples (0.75s)
 *   - Rationale: Ensures complete thoughts, prevents BUFFER LIMIT override
 *
 * @param isMobile - Whether device is mobile (phone/tablet)
 * @returns Minimum samples threshold for PHASE 1
 */
const getMinPhase1Samples = (isMobile: boolean): number => {
  return isMobile ? 36000 : 48000; // Mobile: 2.25s, Desktop: 3s
};

// ============================================
// SESSION EXPIRY WARNING BANNER
// ============================================
interface SessionExpiryWarningProps {
  secondsRemaining: number;
}

const SessionExpiryWarning: React.FC<SessionExpiryWarningProps> = ({
  secondsRemaining,
}) => (
  <div className="fixed top-0 left-0 right-0 z-50 bg-red-50 border-b border-red-200 px-4 py-3 shadow-sm animate-pulse">
    <div className="flex items-center justify-center gap-3 max-w-4xl mx-auto">
      <Clock className="w-5 h-5 text-red-600 flex-shrink-0" />
      <p className="text-sm font-medium text-red-800">
        Tu sesión expira en {secondsRemaining} segundos
      </p>
    </div>
  </div>
);

// ============================================
// STATUS INDICATOR COMPONENT (shadcn/ui redesign)
// ============================================
interface StatusIndicatorProps {
  isConnected: boolean;
  isListening: boolean;
  isThinking: boolean;
  isSpeaking: boolean;
  isMuted: boolean;
  connectionQuality: ConnectionQuality;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  isConnected,
  isListening,
  isThinking,
  isSpeaking,
  isMuted,
  connectionQuality,
}) => {
  const getStatusContent = () => {
    if (!isConnected) {
      return null;
    }

    if (isMuted) {
      return (
        <div className="status-badge status-badge-dark flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium">
          <MicOff className="w-3 h-3 text-red-400" />
          <span>Silenciado</span>
        </div>
      );
    }

    if (isListening) {
      return (
        <div className="status-badge status-badge-cyan flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium status-pulse">
          <div className="voice-wave mr-0.5">
            <span></span>
            <span></span>
            <span></span>
            <span></span>
          </div>
          <span>Escuchando</span>
        </div>
      );
    }

    if (isThinking) {
      return (
        <div className="status-badge status-badge-dark flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium">
          <Loader2
            className="w-3 h-3 animate-spin"
            style={{ color: "rgba(0,200,255,0.9)" }}
          />
          <span>Pensando</span>
        </div>
      );
    }

    if (isSpeaking) {
      return (
        <div className="status-badge status-badge-cyan flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium">
          <div className="voice-wave mr-0.5">
            <span></span>
            <span></span>
            <span></span>
            <span></span>
          </div>
          <span>Respondiendo</span>
        </div>
      );
    }

    return (
      <div className="status-badge status-badge-dark flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium">
        <div
          className={`connection-dot ${connectionQuality === ConnectionQuality.GOOD ? "good" : connectionQuality === ConnectionQuality.BAD ? "bad" : "unknown"} dot-pulse`}
        />
        <span>Conectado</span>
      </div>
    );
  };

  return <div className="absolute top-4 left-4 z-20">{getStatusContent()}</div>;
};

// ============================================
// LANDING SCREEN COMPONENT (futuristic redesign)
// ============================================
interface LandingScreenProps {
  onStartCall: () => void;
  isLoading: boolean;
  userName?: string | null;
  customerData?: CustomerData | null;
  isRateLimited?: boolean;
  rateLimitCountdown?: number;
}

const LandingScreen: React.FC<LandingScreenProps> = ({
  onStartCall,
  isLoading,
  userName,
  customerData,
  isRateLimited = false,
  rateLimitCountdown = 0,
}) => {
  const displayName = customerData?.firstName || userName;

  return (
    <div className="futuristic-landing flex-1 w-full flex flex-col items-center justify-center px-8 min-h-screen relative">
      {/* Clara glassmorphic orb */}
      <div className="clara-orb mb-8 relative z-10">
        <Image
          src="/images/clara-logo.png"
          alt="Clara Logo"
          width={90}
          height={90}
          className="object-contain relative z-10"
          style={{ filter: "drop-shadow(0 2px 8px rgba(120,160,255,0.3))" }}
        />
      </div>

      {/* Text */}
      <h1 className="text-3xl font-bold text-gray-900 mb-3 text-center relative z-10">
        {displayName ? `Hola, ${displayName}!` : "Hola!"}
      </h1>
      <p className="text-base text-gray-500 text-center max-w-xs mb-10 relative z-10 leading-relaxed">
        Soy Clara, tu asistente de belleza personal. Estoy aquí para ayudarte a
        encontrar los productos perfectos para ti.
      </p>

      {/* CTA button */}
      <button
        onClick={onStartCall}
        disabled={isLoading || isRateLimited}
        className="btn-neon-connect w-72 h-14 flex items-center justify-center gap-3 text-base relative z-10"
      >
        {isLoading ? (
          <>
            <div
              className="w-5 h-5 rounded-full border-2 border-cyan-300/40 border-t-cyan-400 animate-spin flex-shrink-0"
              style={{ borderTopColor: "rgba(0,200,255,0.9)" }}
            />
            <span>Conectando...</span>
          </>
        ) : isRateLimited ? (
          <>
            <Clock className="w-5 h-5 flex-shrink-0" />
            <span>Espera {rateLimitCountdown}s</span>
          </>
        ) : (
          <>
            <Phone className="w-5 h-5 flex-shrink-0" />
            <span>Iniciar Conversación</span>
          </>
        )}
      </button>
    </div>
  );
};

// ============================================
// CONNECTING SCREEN COMPONENT (futuristic redesign)
// ============================================
const ConnectingScreen: React.FC = () => {
  return (
    <div className="futuristic-landing flex-1 w-full flex flex-col items-center justify-center px-8 min-h-screen relative">
      {/* Clara orb in loading pulse */}
      <div
        className="clara-orb mb-8 relative z-10"
        style={{ animation: "orb-shimmer 2s ease-in-out infinite" }}
      >
        <Loader2
          className="w-12 h-12 animate-spin relative z-10"
          style={{ color: "rgba(0,180,255,0.8)" }}
        />
      </div>

      <h2 className="text-3xl font-bold text-gray-900 mb-3 text-center relative z-10">
        Conectando...
      </h2>
      <p className="text-base text-gray-500 text-center max-w-xs mb-10 relative z-10 leading-relaxed">
        Preparando a Clara para ti
      </p>

      {/* Disabled loading button */}
      <div className="btn-neon-connect w-72 h-14 flex items-center justify-center gap-3 text-base relative z-10 opacity-70 cursor-not-allowed">
        <div
          className="w-5 h-5 rounded-full border-2 border-cyan-300/40 border-t-cyan-400 animate-spin flex-shrink-0"
          style={{ borderTopColor: "rgba(0,200,255,0.9)" }}
        />
        <span>Preparando...</span>
      </div>
    </div>
  );
};

// ============================================
// AVATAR VIDEO COMPONENT (fullscreen, edge-to-edge)
// ============================================
interface AvatarVideoProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isStreamReady: boolean;
}

const AvatarVideo: React.FC<AvatarVideoProps> = ({
  videoRef,
  isStreamReady,
}) => {
  return (
    <>
      {!isStreamReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
          <div className="spinner w-10 h-10" />
        </div>
      )}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={false}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${isStreamReady ? "opacity-100" : "opacity-0"}`}
        style={{ objectPosition: "43.5% center" }}
      />
    </>
  );
};

// ============================================
// CONNECTED SESSION COMPONENT (Voice Agent)
// ============================================
interface ConnectedSessionProps {
  onEndCall: () => void;
}

const ConnectedSession: React.FC<ConnectedSessionProps> = ({ onEndCall }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { fixedHeight, isInIframe } = useFixedHeight();
  const [isMuted, setIsMuted] = useState(false);

  // RUNTIME device detection - select appropriate audio config
  const audioConfig = React.useMemo(() => {
    const isMobile = isMobileDevice();
    const config = isMobile ? MOBILE_CONFIG : DESKTOP_CONFIG;
    console.log(
      `[AUDIO] Runtime config: ${isMobile ? "MOBILE" : "DESKTOP"} | ` +
        `Gap=${config.gapThreshold}ms | MaxBuffer=${config.maxBufferSamples} | ` +
        `Phase1=${config.phase1LeadingSilence}ms | Phase2=${config.phase2LeadingSilence}ms`,
    );
    return config;
  }, []);

  // Session limit state
  const [sessionSecondsRemaining, setSessionSecondsRemaining] = useState(
    SESSION_LIMIT_MINUTES * 60,
  );
  const [showExpiryWarning, setShowExpiryWarning] = useState(false);
  const sessionTimerRef = useRef<NodeJS.Timeout | null>(null);

  const { sessionRef, customerData } = useLiveAvatarContext();
  const { isStreamReady, connectionQuality, attachElement } = useSession();

  // Flag to prevent multiple agent connection attempts
  const hasConnectedAgentRef = useRef(false);

  // Audio buffer - accumulate all chunks, send when gap detected
  const audioBufferRef = useRef<string[]>([]);
  const totalChunksReceivedRef = useRef(0);
  const lastChunkTimeRef = useRef<number>(0);
  const gapCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Leading silence flag - add silence after interrupt to give HeyGen time
  const isAfterInterruptRef = useRef(false);

  // TWO-PHASE strategy refs
  const immediateSendTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hassentImmediateRef = useRef(false); // Track if we already sent immediate chunks
  const isFirstAudioRef = useRef(true); // Track if this is the first audio response

  // Ghost chunk debounce - ignore chunks arriving shortly after interruption
  const lastInterruptTimeRef = useRef<number>(0);

  // Track if HeyGen is currently playing audio (for conditional interrupt handling)
  const isSendingAudioRef = useRef(false);

  // Track when audio was sent to HeyGen (for late transcript detection)
  const audioSentTimeRef = useRef<number>(0);

  // Track ElevenLabs source sample rate (for resampling)
  const sourceRateRef = useRef<number>(16000);

  // Latency tracking refs - populated after useElevenLabsAgent is called
  const reportAudioSentRef = useRef<(() => void) | null>(null);
  const reportAvatarStartedRef = useRef<(() => void) | null>(null);

  // Audio fade-out refs for smooth interruptions
  const fadeInProgressRef = useRef(false);
  const fadeIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate total samples in buffer (for mobile buffer limit check)
  // Used to prevent accumulating too much audio before processing
  const calculateBufferSamples = useCallback((chunks: string[]): number => {
    let totalBytes = 0;
    for (const chunk of chunks) {
      // base64 → bytes: multiply by 0.75
      totalBytes += Math.round(chunk.length * 0.75);
    }
    // PCM 16-bit = 2 bytes per sample
    return Math.floor(totalBytes / 2);
  }, []);

  // Fade out audio and then interrupt - provides smooth audio transition
  const fadeOutAndInterrupt = useCallback(() => {
    if (!AUDIO_FADE_ENABLED || !videoRef.current || !sessionRef.current) {
      console.log("[FADE] Fade disabled or refs missing, immediate interrupt");
      sessionRef.current?.interrupt();
      return;
    }

    // Cancel any existing fade
    if (fadeIntervalRef.current) {
      clearInterval(fadeIntervalRef.current);
      fadeIntervalRef.current = null;
    }

    console.log("[FADE] Starting fade-out with setInterval");

    fadeInProgressRef.current = true;
    const startVolume = videoRef.current.volume;
    const startTime = Date.now();
    const frameInterval = 16; // 60fps

    // Immediate first frame
    videoRef.current.volume = startVolume;

    fadeIntervalRef.current = setInterval(() => {
      try {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / AUDIO_FADE_DURATION_MS, 1);

        console.log(
          `[FADE] Frame: elapsed=${elapsed}ms, progress=${(progress * 100).toFixed(1)}%`,
        );

        // Ease-out quadratic for smooth deceleration
        const eased = 1 - Math.pow(1 - progress, 2);
        const newVolume = startVolume * (1 - eased);

        if (videoRef.current) {
          videoRef.current.volume = Math.max(0, newVolume);
        } else {
          console.warn("[FADE] videoRef.current is null during fade");
        }

        if (progress >= 1) {
          // Fade complete - cleanup and interrupt
          if (fadeIntervalRef.current) {
            clearInterval(fadeIntervalRef.current);
            fadeIntervalRef.current = null;
          }

          fadeInProgressRef.current = false;

          // Restore volume for next response
          if (videoRef.current) {
            videoRef.current.volume = 1.0;
          }

          // NOW interrupt HeyGen
          console.log("[FADE] Fade-out complete, calling interrupt()");
          if (sessionRef.current) {
            try {
              sessionRef.current.interrupt();
              console.log("[FADE] interrupt() executed successfully");
            } catch (error) {
              console.error("[FADE] Error calling interrupt():", error);
            }
          } else {
            console.error(
              "[FADE] sessionRef.current is null, cannot interrupt",
            );
          }
        }
      } catch (error) {
        console.error("[FADE] Error in fade animation:", error);
        // Cleanup on error
        if (fadeIntervalRef.current) {
          clearInterval(fadeIntervalRef.current);
          fadeIntervalRef.current = null;
        }
        fadeInProgressRef.current = false;
      }
    }, frameInterval);
  }, [sessionRef]);

  // Generate silence in PCM 16-bit signed, 24kHz mono format (base64)
  const generateSilence = useCallback((durationMs: number): string => {
    const sampleRate = 24000;
    const numSamples = Math.floor((durationMs / 1000) * sampleRate);
    // PCM 16-bit = 2 bytes per sample
    const buffer = new Uint8Array(numSamples * 2);
    // All zeros = silence (16-bit signed PCM)
    // buffer is already filled with zeros by default

    // Convert to base64
    let binary = "";
    for (let i = 0; i < buffer.length; i++) {
      binary += String.fromCharCode(buffer[i]!);
    }
    return btoa(binary);
  }, []);

  // Resample audio from source rate to target rate using linear interpolation
  // Called ONCE on the entire concatenated audio to eliminate chunk boundary discontinuities
  const resampleAudio = useCallback(
    (
      sourceBuffer: Int16Array,
      sourceRate: number,
      targetRate: number,
    ): Int16Array => {
      if (sourceRate === targetRate) return sourceBuffer;

      const ratio = sourceRate / targetRate;
      const targetLength = Math.round(sourceBuffer.length / ratio);
      const targetBuffer = new Int16Array(targetLength);

      for (let i = 0; i < targetLength; i++) {
        const sourceIndex = i * ratio;
        const indexFloor = Math.floor(sourceIndex);
        const indexCeil = Math.min(indexFloor + 1, sourceBuffer.length - 1);
        const fraction = sourceIndex - indexFloor;

        targetBuffer[i] = Math.round(
          sourceBuffer[indexFloor]! * (1 - fraction) +
            sourceBuffer[indexCeil]! * fraction,
        );
      }

      return targetBuffer;
    },
    [],
  );

  // Concatenate base64 audio chunks into a single base64 string
  const concatenateBase64Audio = useCallback((chunks: string[]): string => {
    if (chunks.length === 0) return "";
    if (chunks.length === 1) return chunks[0]!;

    // Decode all chunks to binary
    const binaryChunks = chunks.map((chunk) => {
      const binaryString = atob(chunk);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    });

    // Calculate total length
    const totalLength = binaryChunks.reduce(
      (sum, chunk) => sum + chunk.length,
      0,
    );

    // Concatenate all chunks
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of binaryChunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    // Encode back to base64
    let binary = "";
    for (let i = 0; i < result.length; i++) {
      binary += String.fromCharCode(result[i]!);
    }
    return btoa(binary);
  }, []);

  // Helper: Wait for avatar to finish current audio segment
  const waitForAvatarSpeakEnded = useCallback(
    (timeoutMs: number = CHUNK_WAIT_TIMEOUT_MS): Promise<void> => {
      return new Promise((resolve) => {
        const session = sessionRef.current;
        if (!session) {
          resolve();
          return;
        }

        const handler = () => {
          session.off(AgentEventsEnum.AVATAR_SPEAK_ENDED, handler);
          clearTimeout(timeout);
          console.log("[AUDIO] avatar.speak_ended received");
          resolve();
        };

        const timeout = setTimeout(() => {
          session.off(AgentEventsEnum.AVATAR_SPEAK_ENDED, handler);
          console.warn(
            `[AUDIO] Timeout (${timeoutMs}ms) waiting for avatar.speak_ended`,
          );
          resolve(); // Continue anyway
        }, timeoutMs);

        session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, handler);
      });
    },
    [sessionRef],
  );

  // Split base64 audio into chunks of maxBytes (in decoded bytes)
  const smartSplitAudio = useCallback(
    (audioBase64: string, maxBytes: number): string[] => {
      // Base64: 4 chars = 3 bytes, so maxChars = maxBytes * 4 / 3
      const maxChars = Math.floor((maxBytes * 4) / 3);
      const chunks: string[] = [];

      for (let i = 0; i < audioBase64.length; i += maxChars) {
        chunks.push(audioBase64.slice(i, i + maxChars));
      }

      return chunks;
    },
    [],
  );

  // Send large audio in sequential chunks (waits for each to finish)
  const sendChunkedAudio = useCallback(
    async (audioBase64: string) => {
      const chunks = smartSplitAudio(audioBase64, MAX_AUDIO_SIZE_BYTES);
      console.log(
        `[AUDIO] Smart chunking: ${chunks.length} segments of ~${Math.round(MAX_AUDIO_SIZE_BYTES / 1024)}KB`,
      );

      for (let i = 0; i < chunks.length; i++) {
        // DOUBLE CHECK: Both flag AND timestamp-based interrupt detection
        const timeSinceInterrupt = Date.now() - lastInterruptTimeRef.current;

        // Check 1: Flag-based (set to false when interruption occurs)
        if (!isSendingAudioRef.current && i > 0) {
          console.log(
            `[SEND] ⛔ Chunk ${i + 1}/${chunks.length} stopped - isSendingAudioRef=false`,
          );
          break;
        }

        // Check 2: Timestamp-based (recent interrupt blocks all sends)
        if (timeSinceInterrupt < INTERRUPT_BLOCK_WINDOW_MS) {
          console.log(
            `[SEND] ⛔ Chunk ${i + 1}/${chunks.length} blocked - interrupt ${timeSinceInterrupt}ms ago`,
          );
          break;
        }

        const chunk = chunks[i]!;
        const sizeKB = Math.round((chunk.length * 0.75) / 1024);

        console.log(`[SEND] ✅ Chunk ${i + 1}/${chunks.length} (${sizeKB}KB)`);

        // Report audio sent for latency tracking (only first chunk)
        if (i === 0) {
          reportAudioSentRef.current?.();
          // Track when audio was sent (for late transcript detection)
          audioSentTimeRef.current = Date.now();
        }

        isSendingAudioRef.current = true;
        sessionRef.current?.repeatAudio(chunk);

        // Wait for this chunk to finish before sending next
        if (i < chunks.length - 1) {
          await waitForAvatarSpeakEnded();
        }
      }

      console.log(
        `[AUDIO] Smart chunking complete: ${chunks.length} chunks sent`,
      );
    },
    [smartSplitAudio, waitForAvatarSpeakEnded, sessionRef],
  );

  // Send ALL accumulated audio to avatar (called when gap detected or agent_response_end)
  // HYBRID: Resamples once after concatenation, adds silence, uses Smart Chunking for large audio
  // isImmediateSend: true for PHASE 1 (first words, minimal silence), false for PHASE 2 (rest of response)
  const sendAllAudioToAvatar = useCallback(
    (isImmediateSend: boolean = false) => {
      // Clear gap check interval
      if (gapCheckIntervalRef.current) {
        clearInterval(gapCheckIntervalRef.current);
        gapCheckIntervalRef.current = null;
      }

      // Clear immediate send timeout (TWO-PHASE cleanup)
      if (immediateSendTimeoutRef.current) {
        clearTimeout(immediateSendTimeoutRef.current);
        immediateSendTimeoutRef.current = null;
      }

      if (audioBufferRef.current.length === 0) {
        console.log("[AUDIO] No audio to send");
        return;
      }

      const chunks = audioBufferRef.current;
      audioBufferRef.current = [];

      // 1. Concatenate all RAW chunks (still at source sample rate, e.g., 16kHz)
      const concatenatedRaw = concatenateBase64Audio(chunks);
      if (!concatenatedRaw || !sessionRef.current) return;

      // 2. Decode base64 → Int16Array (raw PCM)
      const binaryString = atob(concatenatedRaw);
      const rawBytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        rawBytes[i] = binaryString.charCodeAt(i);
      }
      const sourceBuffer = new Int16Array(rawBytes.buffer);

      // 3. Resample ONCE from source rate (16kHz) to target rate (24kHz)
      const sourceRate = sourceRateRef.current;
      const resampledBuffer = resampleAudio(
        sourceBuffer,
        sourceRate,
        TARGET_SAMPLE_RATE,
      );

      console.log(
        `[AUDIO] Resampled: ${sourceBuffer.length} samples @ ${sourceRate}Hz → ${resampledBuffer.length} samples @ ${TARGET_SAMPLE_RATE}Hz`,
      );

      // 4. Encode resampled audio back to base64
      let binary = "";
      const resampledBytes = new Uint8Array(resampledBuffer.buffer);
      for (let i = 0; i < resampledBytes.length; i++) {
        binary += String.fromCharCode(resampledBytes[i]!);
      }
      let finalAudio = btoa(binary);

      // 5. Add leading + trailing silence (DIFFERENTIATED BY PHASE)
      // Uses runtime audioConfig for device-specific values
      const leadingSilenceMs = isImmediateSend
        ? audioConfig.phase1LeadingSilence
        : audioConfig.phase2LeadingSilence;
      const trailingSilenceMs = isImmediateSend
        ? audioConfig.phase1TrailingSilence
        : audioConfig.phase2TrailingSilence;

      const leadingSilence = generateSilence(leadingSilenceMs);
      const trailingSilence = generateSilence(trailingSilenceMs);

      // Only add silence if duration > 0
      const audioWithSilence = [finalAudio];
      if (leadingSilenceMs > 0) audioWithSilence.unshift(leadingSilence);
      if (trailingSilenceMs > 0) audioWithSilence.push(trailingSilence);
      finalAudio = concatenateBase64Audio(audioWithSilence);

      // Log with phase info
      const phaseLabel = isImmediateSend ? "PHASE 1 (fast)" : "PHASE 2";
      const interruptNote = isAfterInterruptRef.current
        ? " (post-interrupt)"
        : "";
      console.log(
        `[AUDIO] ${phaseLabel}: ${leadingSilenceMs}ms lead + ${trailingSilenceMs}ms trail${interruptNote}`,
      );

      // Reset interrupt flag
      if (isAfterInterruptRef.current) {
        isAfterInterruptRef.current = false;
      }

      // === SMART CHUNKING: Check size and split if needed ===
      const audioSizeBytes = Math.round(finalAudio.length * 0.75);
      const audioSizeKB = Math.round(audioSizeBytes / 1024);
      const estimatedDurationSec = audioSizeKB / 48; // ~48KB/s @ 24kHz 16-bit

      console.log(
        `[AUDIO] Size: ${audioSizeKB}KB (~${estimatedDurationSec.toFixed(1)}s)`,
      );

      if (audioSizeBytes > MAX_AUDIO_SIZE_BYTES) {
        // INTERRUPT CHECK: Verify no recent interrupt before chunked send
        const timeSinceInterrupt = Date.now() - lastInterruptTimeRef.current;
        if (timeSinceInterrupt < INTERRUPT_BLOCK_WINDOW_MS) {
          console.log(
            `[SEND] ⛔ BLOCKED large audio - recent interrupt (${timeSinceInterrupt}ms ago)`,
          );
          audioBufferRef.current = [];
          return;
        }

        console.log(
          `[AUDIO] Audio too large (${audioSizeKB}KB > ${Math.round(MAX_AUDIO_SIZE_BYTES / 1024)}KB), using smart chunking`,
        );
        // Send chunked - function handles isSendingAudioRef internally
        sendChunkedAudio(finalAudio);
        return; // Exit - chunked send handles everything
      }

      // === Normal path: audio is small enough for single send ===
      const totalSizeKB = Math.round(finalAudio.length / 1024);
      const isFirstAudio = isFirstAudioRef.current;

      if (isFirstAudio) {
        isFirstAudioRef.current = false;
        console.log(
          `[AUDIO] GREETING SENT: ${chunks.length} chunks, ${totalSizeKB}KB, single repeatAudio() call`,
        );
      } else {
        console.log(
          `[AUDIO] Response sent: ${chunks.length} chunks, ${totalSizeKB}KB`,
        );
      }

      // 6. INTERRUPT CHECK: Verify no recent interrupt before sending
      const timeSinceInterrupt = Date.now() - lastInterruptTimeRef.current;
      if (timeSinceInterrupt < INTERRUPT_BLOCK_WINDOW_MS) {
        console.log(
          `[SEND] ⛔ BLOCKED - recent interrupt (${timeSinceInterrupt}ms ago)`,
        );
        audioBufferRef.current = [];
        return;
      }

      // 7. Send ALL audio in a single call
      console.log(
        `[SEND] ✅ Sending complete audio (${totalSizeKB}KB) - ${timeSinceInterrupt}ms since last interrupt`,
      );
      try {
        // Report audio sent for latency tracking
        reportAudioSentRef.current?.();

        // Track when audio was sent (for late transcript detection)
        audioSentTimeRef.current = Date.now();

        isSendingAudioRef.current = true;
        sessionRef.current.repeatAudio(finalAudio);
      } catch (error) {
        console.error("Error sending audio to avatar:", error);
        isSendingAudioRef.current = false;
      }
    },
    [
      audioConfig,
      concatenateBase64Audio,
      generateSilence,
      resampleAudio,
      sendChunkedAudio,
      sessionRef,
    ],
  );

  // Start gap detection - checks if stream ended by detecting pause between chunks
  const startGapDetection = useCallback(() => {
    // Clear any existing interval
    if (gapCheckIntervalRef.current) {
      clearInterval(gapCheckIntervalRef.current);
    }

    // Check every 50ms if there's a gap in chunks
    // Uses runtime audioConfig.gapThreshold for device-specific timing
    gapCheckIntervalRef.current = setInterval(() => {
      const timeSinceLastChunk = Date.now() - lastChunkTimeRef.current;

      // If gap exceeds threshold, stream has ended - send buffered audio
      if (
        timeSinceLastChunk >= audioConfig.gapThreshold &&
        audioBufferRef.current.length > 0
      ) {
        console.log(
          `[AUDIO] Gap detected (${timeSinceLastChunk}ms >= ${audioConfig.gapThreshold}ms) - sending buffered audio`,
        );
        sendAllAudioToAvatar();
      }
    }, 50);
  }, [sendAllAudioToAvatar, audioConfig.gapThreshold]);

  // ElevenLabs Agent hook - SIMPLE: accumulate all chunks, send when gap detected
  const {
    isConnected: isAgentConnected,
    isListening,
    isThinking,
    isSpeaking,
    connect: connectAgent,
    disconnect: disconnectAgent,
    startListening,
    stopListening,
    error: agentError,
    // Latency tracking
    reportAudioSent,
    reportAvatarStarted,
  } = useElevenLabsAgent({
    // Pass customer data for ElevenLabs dynamic variables personalization
    customerData: customerData
      ? {
          firstName: customerData.firstName,
          lastName: customerData.lastName,
          email: customerData.email,
          skinType: customerData.skinType,
          skinConcerns: customerData.skinConcerns,
          ordersCount: customerData.ordersCount,
        }
      : undefined,
    onAudioData: (audioBase64, sampleRate) => {
      // DEBOUNCE: Ignore "ghost" chunks that arrive shortly after interruption
      // These are in-flight chunks from the previous response
      const timeSinceInterrupt = Date.now() - lastInterruptTimeRef.current;
      if (timeSinceInterrupt < INTERRUPT_DEBOUNCE_MS) {
        console.log(
          `[AUDIO] Ignoring ghost chunk (${timeSinceInterrupt}ms since interrupt)`,
        );
        return;
      }

      // Store source sample rate from first chunk (used for resampling after concatenation)
      if (totalChunksReceivedRef.current === 0) {
        sourceRateRef.current = sampleRate;
        console.log(`[AUDIO] Source sample rate: ${sampleRate}Hz`);
      }

      // Accumulate RAW chunks (no resampling) - resampling happens ONCE after concatenation
      totalChunksReceivedRef.current++;
      audioBufferRef.current.push(audioBase64);
      lastChunkTimeRef.current = Date.now();

      const currentBufferLength = audioBufferRef.current.length;
      const currentSamplesForLog = calculateBufferSamples(
        audioBufferRef.current,
      );
      console.log(
        `[AUDIO] Chunk #${totalChunksReceivedRef.current}, buffer: ${currentSamplesForLog} samples (${currentBufferLength} chunks), isGreeting: ${isFirstAudioRef.current}`,
      );

      // TWO-PHASE STRATEGY:
      // Phase 1: Send first chunk IMMEDIATELY (contains first words - reduces perceived latency)
      // This is SYNCHRONOUS - no timeout, no delay, just send NOW
      // GREETING FIX: Skip PHASE 1 for greeting to accumulate more audio
      if (!hassentImmediateRef.current && currentBufferLength === 1) {
        if (isFirstAudioRef.current && GREETING_SKIP_PHASE1) {
          console.log("[AUDIO] GREETING: Skipping PHASE 1 (immediate send)");
          // Don't send yet - continue to gap detection or buffer limit
        } else {
          // TRUNCATION FIX: Check if first chunk has enough audio content
          // Calculate samples from first chunk (base64 → bytes → samples)
          const firstChunk = audioBufferRef.current[0]!;
          const estimatedSamples = Math.round((firstChunk.length * 0.75) / 2);

          // Device-aware threshold to prevent mobile truncation
          const isMobile = isMobileDevice();
          const minPhase1Samples = getMinPhase1Samples(isMobile);

          if (estimatedSamples < minPhase1Samples) {
            console.log(
              `[AUDIO] PHASE 1 [${isMobile ? "MOBILE" : "DESKTOP"}]: First chunk too small (${estimatedSamples}/${minPhase1Samples} samples), waiting for more`,
            );
            // Don't send yet - let gap detection or buffer limit handle it
            // Continue to PHASE 2 logic below
          } else {
            hassentImmediateRef.current = true;
            console.log(
              `[AUDIO] PHASE 1 [${isMobile ? "MOBILE" : "DESKTOP"}]: IMMEDIATE send with sufficient content (${estimatedSamples} samples, threshold: ${minPhase1Samples})`,
            );
            // Send synchronously - first words go out ASAP
            sendAllAudioToAvatar(true); // isImmediateSend = true for minimal silence
            return;
          }
        }
      }

      // MOBILE OPTIMIZATION: Check if buffer exceeds limit
      // Mobile CPUs struggle with large resamples - process in smaller batches
      // Uses runtime audioConfig.maxBufferSamples for device-specific limits
      // GREETING FIX: Skip buffer limit for greeting to accumulate full message
      const currentSamples = calculateBufferSamples(audioBufferRef.current);
      if (currentSamples >= audioConfig.maxBufferSamples) {
        if (isFirstAudioRef.current && GREETING_SKIP_PHASE1) {
          console.log(
            `[AUDIO] GREETING: Skipping buffer limit (${currentSamples}/${audioConfig.maxBufferSamples} samples) - accumulating more`,
          );
          // Continue to gap detection - don't return
        } else {
          console.log(
            `[AUDIO] BUFFER LIMIT: ${currentSamples} samples >= ${audioConfig.maxBufferSamples}, processing NOW`,
          );
          // Clear gap detection since we're processing now
          if (gapCheckIntervalRef.current) {
            clearInterval(gapCheckIntervalRef.current);
            gapCheckIntervalRef.current = null;
          }
          sendAllAudioToAvatar(false); // PHASE 2 style padding
          return;
        }
      }

      // Phase 2: For remaining chunks, use gap detection
      if (!gapCheckIntervalRef.current) {
        startGapDetection();
      }
    },
    onAgentResponseEnd: () => {
      // Agent finished speaking - send immediately (faster than timeout)
      console.log("[AUDIO] agent_response_end received, sending all audio now");
      sendAllAudioToAvatar();
    },
    onAgentResponse: () => {
      console.log("[AUDIO] agent_response received - new response starting");

      // GREETING FIX: Reset interrupt debounce to accept new audio chunks immediately
      // Without this, fast responses (<300ms) get discarded as "ghost chunks"
      lastInterruptTimeRef.current = 0;
      console.log("[AUDIO] Reset interrupt debounce for new response");
    },
    onInterruption: (vadInfo: VadInfo) => {
      // ElevenLabs confirmed user interrupted - trust their detection system
      const interruptTime = Date.now();
      console.log(`[INTERRUPT] ══════════════════════════════════════`);
      console.log(`[INTERRUPT] Valid interruption at T=${interruptTime}`);
      console.log(
        `[INTERRUPT] VAD: ${vadInfo.vadScore.toFixed(2)}, Duration: ${vadInfo.speechDuration}ms`,
      );

      // Set flag to add leading silence on next response (gives HeyGen time after interrupt)
      isAfterInterruptRef.current = true;

      // Record interrupt time for debounce (ignore ghost chunks)
      lastInterruptTimeRef.current = interruptTime;

      // Clear buffer and stop gap detection
      if (gapCheckIntervalRef.current) {
        clearInterval(gapCheckIntervalRef.current);
        gapCheckIntervalRef.current = null;
      }

      // Clear immediate send timeout (TWO-PHASE cleanup)
      if (immediateSendTimeoutRef.current) {
        clearTimeout(immediateSendTimeoutRef.current);
        immediateSendTimeoutRef.current = null;
      }

      audioBufferRef.current = [];
      totalChunksReceivedRef.current = 0;
      hassentImmediateRef.current = false; // Reset for next response
      isSendingAudioRef.current = false; // Reset sending state

      // CRITICAL: Interrupt HeyGen avatar playback with smooth fade-out
      console.log(`[INTERRUPT] Initiating fade-out and interrupt`);
      fadeOutAndInterrupt();
      console.log(`[INTERRUPT] ══════════════════════════════════════`);
    },
    onUserTranscript: (text, vadInfo) => {
      console.log("[AUDIO] User said:", text);

      // Filter out noise/empty transcripts
      const cleanText = text?.trim().replace(/\./g, "").trim() || "";
      if (cleanText.length < 2) {
        console.log("[AUDIO] Ignoring noise/empty transcript");
        return;
      }

      // CONDITIONAL INTERRUPT: Only clear buffer if avatar is CURRENTLY speaking
      // If avatar finished, chunks arriving are from the NEW response - preserve them
      if (isSendingAudioRef.current) {
        // Check if this is a LATE transcript (arrived shortly after audio was sent)
        // On mobile, transcripts can arrive 3-50ms after audio was already sent
        // Users cannot realistically interrupt within 100ms of receiving audio
        const timeSinceAudioSent = Date.now() - audioSentTimeRef.current;

        if (timeSinceAudioSent < AUDIO_SENT_GRACE_PERIOD_MS) {
          console.log(
            `[AUDIO] Ignoring late transcript (${timeSinceAudioSent}ms since audio sent)`,
          );
          return; // Don't clear buffer - this is a late transcript, not a real interruption
        }

        // SMART INTERRUPTION: Check VAD score if available
        if (SMART_INTERRUPTION_ENABLED && vadInfo) {
          if (vadInfo.vadScore < MIN_VAD_SCORE_FOR_INTERRUPT) {
            console.log(
              `[AUDIO] Ignoring transcript interruption - low VAD (${vadInfo.vadScore.toFixed(2)})`,
            );
            return;
          }
        }

        console.log("[AUDIO] User interrupted active speech - clearing buffer");

        // Record interrupt time for debounce (ignore ghost chunks)
        lastInterruptTimeRef.current = Date.now();

        // Cancel gap detection
        if (gapCheckIntervalRef.current) {
          clearInterval(gapCheckIntervalRef.current);
          gapCheckIntervalRef.current = null;
        }

        // Clear immediate send timeout
        if (immediateSendTimeoutRef.current) {
          clearTimeout(immediateSendTimeoutRef.current);
          immediateSendTimeoutRef.current = null;
        }

        // Clear audio state
        audioBufferRef.current = [];
        isSendingAudioRef.current = false;
        hassentImmediateRef.current = false;

        // Set flag for leading silence on next response
        isAfterInterruptRef.current = true;

        // Interrupt HeyGen avatar playback with smooth fade-out
        fadeOutAndInterrupt();
      } else {
        // Avatar already finished - don't clear buffer, don't set debounce
        // Chunks arriving are from the NEW response being generated
        console.log(
          "[AUDIO] User spoke after avatar finished - preserving buffer",
        );

        // CRITICAL FIX: Reset hassentImmediateRef for the NEW conversation turn
        // Without this, PHASE 1 (100ms silence) is skipped and only PHASE 2 (80ms) runs
        // This caused first words to be cut off on subsequent responses
        hassentImmediateRef.current = false;

        // Set the interrupt flag for leading silence on next response
        isAfterInterruptRef.current = true;
      }
    },
    onError: (error) => {
      console.error("Agent error:", error);
    },
  });

  // Populate latency tracking refs (for use in callbacks defined before useElevenLabsAgent)
  useEffect(() => {
    reportAudioSentRef.current = reportAudioSent;
    reportAvatarStartedRef.current = reportAvatarStarted;
  }, [reportAudioSent, reportAvatarStarted]);

  // Attach video element when stream is ready
  useEffect(() => {
    if (isStreamReady && videoRef.current) {
      attachElement(videoRef.current);
    }
  }, [isStreamReady, attachElement]);

  // Connect to ElevenLabs agent when avatar stream is ready
  useEffect(() => {
    // Use ref flag to ensure we only connect once
    if (isStreamReady && !hasConnectedAgentRef.current) {
      hasConnectedAgentRef.current = true;
      console.log("Connecting to ElevenLabs agent...");
      connectAgent();
    }
  }, [isStreamReady, connectAgent]);

  // Cleanup on unmount - empty deps to run only once on true unmount
  useEffect(() => {
    return () => {
      disconnectAgent();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for AVATAR_SPEAK_STARTED to track HeyGen latency
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;

    const handleAvatarSpeakStarted = () => {
      console.log("[LATENCY] Avatar started speaking");
      reportAvatarStartedRef.current?.();
    };

    session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, handleAvatarSpeakStarted);

    return () => {
      session.off(
        AgentEventsEnum.AVATAR_SPEAK_STARTED,
        handleAvatarSpeakStarted,
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for AVATAR_SPEAK_ENDED to reset sending state
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;

    const handleAvatarSpeakEnded = () => {
      console.log("[AUDIO] Avatar finished speaking");
      isSendingAudioRef.current = false;
    };

    session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, handleAvatarSpeakEnded);

    return () => {
      session.off(AgentEventsEnum.AVATAR_SPEAK_ENDED, handleAvatarSpeakEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep-alive interval to prevent HeyGen session timeout (10 min inactivity)
  const keepAliveIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;

    // Send keep-alive every 5 minutes to prevent timeout
    keepAliveIntervalRef.current = setInterval(
      () => {
        session
          .keepAlive()
          .then(() => {
            console.log("[HEYGEN] Keep-alive sent successfully");
          })
          .catch((error) => {
            console.warn("[HEYGEN] Keep-alive failed:", error);
          });
      },
      5 * 60 * 1000,
    ); // 5 minutes

    return () => {
      if (keepAliveIntervalRef.current) {
        clearInterval(keepAliveIntervalRef.current);
        keepAliveIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Session limit timer - only runs if SESSION_LIMIT_ENABLED is true
  useEffect(() => {
    if (!SESSION_LIMIT_ENABLED) return;

    sessionTimerRef.current = setInterval(() => {
      setSessionSecondsRemaining((prev) => {
        const newValue = prev - 1;

        // Show warning when approaching limit
        if (newValue <= SESSION_WARNING_SECONDS && newValue > 0) {
          setShowExpiryWarning(true);
        }

        return newValue <= 0 ? 0 : newValue;
      });
    }, 1000);

    return () => {
      if (sessionTimerRef.current) {
        clearInterval(sessionTimerRef.current);
        sessionTimerRef.current = null;
      }
    };
  }, []);

  // Handle session expiry - separate effect to avoid setState during render
  useEffect(() => {
    if (SESSION_LIMIT_ENABLED && sessionSecondsRemaining <= 0) {
      console.log("[SESSION] Time limit reached, ending session");
      onEndCall();
    }
  }, [sessionSecondsRemaining, onEndCall]);

  const handleToggleMute = useCallback(() => {
    if (isMuted) {
      startListening();
      setIsMuted(false);
    } else {
      stopListening();
      setIsMuted(true);
    }
  }, [isMuted, startListening, stopListening]);

  // Cleanup on unmount - prevent memory leaks from intervals
  useEffect(() => {
    return () => {
      // Cleanup gap detection interval
      if (gapCheckIntervalRef.current) {
        clearInterval(gapCheckIntervalRef.current);
        gapCheckIntervalRef.current = null;
      }
      // Cleanup immediate send timeout (TWO-PHASE)
      if (immediateSendTimeoutRef.current) {
        clearTimeout(immediateSendTimeoutRef.current);
        immediateSendTimeoutRef.current = null;
      }
      // Cleanup session timer
      if (sessionTimerRef.current) {
        clearInterval(sessionTimerRef.current);
        sessionTimerRef.current = null;
      }
      // Cleanup keep-alive interval
      if (keepAliveIntervalRef.current) {
        clearInterval(keepAliveIntervalRef.current);
        keepAliveIntervalRef.current = null;
      }
      // Cleanup fade animation
      if (fadeIntervalRef.current) {
        clearInterval(fadeIntervalRef.current);
        fadeIntervalRef.current = null;
      }
      // Clear audio buffer
      audioBufferRef.current = [];
    };
  }, []);

  const containerStyle =
    fixedHeight && isInIframe
      ? { height: `${fixedHeight}px`, overflow: "hidden" as const }
      : {};

  return (
    <div
      className="fixed inset-0 z-0 bg-black overflow-hidden"
      style={containerStyle}
    >
      {/* Session expiry warning */}
      {showExpiryWarning && (
        <SessionExpiryWarning secondsRemaining={sessionSecondsRemaining} />
      )}

      {/* Error display */}
      {agentError && (
        <div className="absolute top-16 left-4 right-4 z-50 bg-black/70 border border-red-500/50 text-white px-4 py-3 rounded-xl text-sm backdrop-blur-sm">
          {agentError}
        </div>
      )}

      {/* Fullscreen video layer */}
      <div className="absolute inset-0">
        <AvatarVideo videoRef={videoRef} isStreamReady={isStreamReady} />
      </div>

      {/* Status indicator - top left floating */}
      <StatusIndicator
        isConnected={isStreamReady && isAgentConnected}
        isListening={isListening}
        isThinking={isThinking}
        isSpeaking={isSpeaking}
        isMuted={isMuted}
        connectionQuality={connectionQuality}
      />

      {/* Bottom controls - floating above video */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20 flex flex-col items-center px-8"
        style={{
          paddingBottom: "max(2.5rem, env(safe-area-inset-bottom, 0px) + 1rem)",
        }}
      >
        <div className="flex items-center justify-center gap-4 w-full max-w-sm">
          {/* Mute toggle - floating glass circle */}
          {isAgentConnected && (
            <button
              onClick={handleToggleMute}
              className={`btn-mute-dark rounded-full w-12 h-12 flex items-center justify-center flex-shrink-0 ${isMuted ? "muted" : ""}`}
              title={isMuted ? "Activar micrófono" : "Silenciar"}
            >
              {isMuted ? (
                <MicOff className="w-5 h-5 text-white" />
              ) : (
                <Mic className="w-5 h-5 text-white" />
              )}
            </button>
          )}

          {/* End call button - neon red pill */}
          <button
            onClick={onEndCall}
            className="btn-neon-end flex-1 h-12 flex items-center justify-center gap-2 text-sm"
          >
            <PhoneOff className="w-4 h-4 flex-shrink-0" />
            <span className="font-medium">Finalizar</span>
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================
// SESSION WRAPPER COMPONENT
// ============================================
interface SessionWrapperProps {
  onSessionStopped: () => void;
}

const SessionWrapper: React.FC<SessionWrapperProps> = ({
  onSessionStopped,
}) => {
  const { widgetState, sessionState } = useLiveAvatarContext();
  const { startSession, stopSession } = useSession();

  // Start session automatically
  useEffect(() => {
    if (sessionState === SessionState.INACTIVE) {
      startSession();
    }
  }, [sessionState, startSession]);

  // Handle session end
  useEffect(() => {
    if (sessionState === SessionState.DISCONNECTED) {
      onSessionStopped();
    }
  }, [sessionState, onSessionStopped]);

  const handleEndCall = useCallback(() => {
    stopSession();
  }, [stopSession]);

  // Render based on widget state
  if (widgetState === WidgetState.CONNECTING) {
    return <ConnectingScreen />;
  }

  if (widgetState === WidgetState.CONNECTED) {
    return <ConnectedSession onEndCall={handleEndCall} />;
  }

  return <ConnectingScreen />;
};

// ============================================
// MAIN WIDGET COMPONENT
// ============================================
export interface ClaraVoiceAgentProps {
  userName?: string | null;
  customerData?: CustomerData | null;
}

export const ClaraVoiceAgent: React.FC<ClaraVoiceAgentProps> = ({
  userName = null,
  customerData = null,
}) => {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { fixedHeight, isInIframe } = useFixedHeight();
  const { isDesktop } = useScreenSize();

  // Rate limit state
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);
  const rateLimitTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup rate limit timer on unmount
  useEffect(() => {
    return () => {
      if (rateLimitTimerRef.current) {
        clearInterval(rateLimitTimerRef.current);
        rateLimitTimerRef.current = null;
      }
    };
  }, []);

  // Countdown timer for rate limit
  useEffect(() => {
    if (rateLimitCountdown > 0) {
      setIsRateLimited(true);
      rateLimitTimerRef.current = setInterval(() => {
        setRateLimitCountdown((prev) => {
          const newValue = prev - 1;
          if (newValue <= 0) {
            setIsRateLimited(false);
            if (rateLimitTimerRef.current) {
              clearInterval(rateLimitTimerRef.current);
              rateLimitTimerRef.current = null;
            }
          }
          return newValue <= 0 ? 0 : newValue;
        });
      }, 1000);

      return () => {
        if (rateLimitTimerRef.current) {
          clearInterval(rateLimitTimerRef.current);
          rateLimitTimerRef.current = null;
        }
      };
    }
  }, [rateLimitCountdown]);

  const handleStartCall = useCallback(async () => {
    setIsStarting(true);
    setError(null);

    try {
      // Use CUSTOM mode for Voice Agent (we handle STT/LLM/TTS via ElevenLabs)
      const res = await fetch("/api/start-custom-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deviceType: isDesktop ? "desktop" : "mobile",
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();

        // Handle rate limit (429) specifically
        if (res.status === 429) {
          const retryAfter = errorData.retryAfter || 60;
          setRateLimitCountdown(retryAfter);

          // Show toast notification
          toast.error("Límite de sesiones alcanzado", {
            description: `Has iniciado muchas sesiones recientemente. Por favor espera ${retryAfter} segundos antes de intentar nuevamente.`,
            duration: 5000,
          });

          return; // Exit early, don't throw error
        }

        throw new Error(errorData.error || "Failed to start session");
      }

      const { session_token } = await res.json();
      setSessionToken(session_token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsStarting(false);
    }
  }, [isDesktop]);

  const handleSessionStopped = useCallback(() => {
    setSessionToken(null);
  }, []);

  const containerStyle =
    fixedHeight && isInIframe
      ? { height: `${fixedHeight}px`, overflow: "hidden" as const }
      : {};

  return (
    <div
      className="w-full h-full min-h-screen flex flex-col items-center justify-center"
      style={containerStyle}
    >
      {error && (
        <div className="absolute top-4 left-4 right-4 z-50 bg-red-100 border border-red-300 text-red-700 px-4 py-3 rounded-lg">
          <p className="text-sm">{error}</p>
          <button
            onClick={() => setError(null)}
            className="absolute top-2 right-2 text-red-500 hover:text-red-700"
          >
            &times;
          </button>
        </div>
      )}

      {!sessionToken ? (
        <LandingScreen
          onStartCall={handleStartCall}
          isLoading={isStarting}
          userName={userName}
          customerData={customerData}
          isRateLimited={isRateLimited}
          rateLimitCountdown={rateLimitCountdown}
        />
      ) : (
        <LiveAvatarContextProvider
          sessionAccessToken={sessionToken}
          userName={userName}
          customerData={customerData}
        >
          <SessionWrapper onSessionStopped={handleSessionStopped} />
        </LiveAvatarContextProvider>
      )}
    </div>
  );
};

export default ClaraVoiceAgent;
