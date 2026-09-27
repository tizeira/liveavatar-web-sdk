"use client";

import React, {
  useEffect,
  useRef,
  useCallback,
  useState,
  useMemo,
} from "react";
import {
  SessionState,
  ConnectionQuality,
  AgentEventsEnum,
  VoiceChatState,
} from "@heygen/liveavatar-web-sdk";
import {
  LiveAvatarContextProvider,
  useSession,
  useLiveAvatarContext,
  WidgetState,
  CustomerData,
} from "../liveavatar";
import { useScreenSize, useFixedHeight } from "../hooks";
import { sendCustomerContextAndWait } from "../utils/heygen/elevenlabs-commands";
import { waitForMediaPlaybackReady } from "../utils/media-playback-readiness";
import { useChromaKey } from "../hooks/useChromaKey";
import type { ChromaKeyConfig } from "../hooks/useChromaKey";
import type {
  ClaraRoutine,
  ClaraConsultationResult,
  ClaraConversationMemory,
} from "../consultations/types";
import type { ClaraCatalogProduct } from "../shopify/types";
import { routineGoalsText } from "../consultations/routine";
import { releaseConsultation } from "../consultations/release";
import { pollConsultationResult } from "../consultations/poll-result";
import { ClaraFlowDiagnosticEvent } from "../liveavatar/flow-diagnostics";
import styles from "./ClaraVoiceAgent.module.css";
import { SavedRoutinePanel, SavedRoutineStatus } from "./SavedRoutinePanel";
import { ShopifyVerificationStates } from "./ShopifyVerificationStates";

// Debug (solo preview/develop)
import { MobileLogger } from "./debug/MobileLogger";

// shadcn/ui components
import { Button } from "./ui/button";
// Lucide icons
import {
  PhoneOff,
  Mic,
  MicOff,
  Clock,
  MessageSquare,
  Bug,
  ChevronLeft,
  ArrowUpRight,
} from "lucide-react";

// Toast notifications
import { toast } from "sonner";

// ============================================
// DEBUG UI TOGGLE
// ============================================
// Set to true to show debug UI (Test Agent button, Mic Status button, MobileLogger).
// Keep false in production. Diagnostic event logging in console stays regardless.
const DEBUG_UI = false;

type SafeClientTelemetryEvent =
  | "voicechat_state_observed"
  | "voicechat_ready"
  | "voicechat_prepare_failed"
  | "greeting_triggered"
  | "greeting_trigger_failed"
  | "greeting_completed"
  | "microphone_ready"
  | "microphone_unmute_failed"
  | "agent_event_observed";

// ============================================
// SESSION LIMIT CONFIGURATION
// ============================================
// Toggle: false = no limit (beta), true = enforce limit (production)
const SESSION_LIMIT_ENABLED = true;
// Maximum session duration in minutes
const SESSION_LIMIT_MINUTES = 10;
// Warning before session ends (in seconds)
const SESSION_WARNING_SECONDS = 30;

const BrandMark: React.FC<{ dark?: boolean; className?: string }> = ({
  dark = false,
  className = "",
}) => (
  <div
    className={`${styles.brand} ${styles.display} ${dark ? styles.brandOnDark : ""} ${className}`}
    aria-label="Beta Skintech"
  >
    <span className={styles.brandBeta}>BETA</span>
    <span className={styles.brandSkintech}>SKINTECH</span>
  </div>
);

const ClaraPortrait: React.FC<{ compact?: boolean }> = ({
  compact = false,
}) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    src="/clara-avatar.png"
    alt=""
    width={compact ? 138 : 102}
    height={compact ? 138 : 102}
    className={styles.claraVoiceIcon}
  />
);

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
  if (!isConnected) return null;

  const label = isMuted
    ? "Silenciado"
    : isListening
      ? "Escuchando"
      : isThinking
        ? "Pensando"
        : isSpeaking
          ? "Hablando"
          : connectionQuality === ConnectionQuality.BAD
            ? "Conexión inestable"
            : "Conectada";
  const showMotion = isListening || isThinking || isSpeaking;

  return (
    <div className={styles.statusWrap} aria-live="polite">
      <div className={styles.statusPill}>
        {showMotion ? (
          <span className={styles.voiceBars} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        ) : isMuted ? (
          <MicOff size={15} aria-hidden="true" />
        ) : (
          <span
            className={styles.recordDot}
            style={{
              background:
                connectionQuality === ConnectionQuality.BAD
                  ? "#e5484d"
                  : "#7fb2f2",
            }}
            aria-hidden="true"
          />
        )}
        <span>{label}</span>
      </div>
    </div>
  );
};

// ============================================
// VOICE CONTROLS COMPONENT (shadcn/ui redesign)
// ============================================
interface VoiceControlsProps {
  isMuted: boolean;
  isActive: boolean;
  onToggleMute: () => void;
}

const VoiceControls: React.FC<VoiceControlsProps> = ({
  isMuted,
  isActive,
  onToggleMute,
}) => {
  if (!isActive) return null;

  return (
    <button
      type="button"
      onClick={onToggleMute}
      className={`${styles.roundControl} ${styles.muteControl} ${isMuted ? styles.mutedControl : ""}`}
      title={isMuted ? "Activar micrófono" : "Silenciar"}
      aria-pressed={isMuted}
    >
      {isMuted ? <MicOff size={27} /> : <Mic size={27} />}
      <span className={styles.srOnly}>
        {isMuted ? "Activar micrófono" : "Silenciar micrófono"}
      </span>
    </button>
  );
};

// ============================================
// LANDING SCREEN COMPONENT (shadcn/ui redesign)
// ============================================
interface LandingScreenProps {
  /** Local design preview only; never bypasses microphone permission in production. */
  previewPermission?: "request" | "denied";
  designOnly?: boolean;
  onViewSavedRoutine?: () => void;
  onViewLastConsultation?: () => void;
  onStartCall: () => Promise<void>;
  isLoading: boolean;
  userName?: string | null;
  customerData?: CustomerData | null;
  isRateLimited?: boolean;
  rateLimitCountdown?: number;
}

export const LandingScreen: React.FC<LandingScreenProps> = ({
  previewPermission,
  designOnly = false,
  onViewSavedRoutine,
  onViewLastConsultation,
  onStartCall,
  isLoading,
  userName,
  customerData,
  isRateLimited = false,
  rateLimitCountdown = 0,
}) => {
  const displayName = customerData?.firstName || userName;
  const [showPermission, setShowPermission] = useState(
    process.env.NODE_ENV !== "production" && Boolean(previewPermission),
  );
  const [permissionDenied, setPermissionDenied] = useState(
    process.env.NODE_ENV !== "production" && previewPermission === "denied",
  );
  const screenRef = useClaraScreenFocus(
    showPermission ? "permission" : "welcome",
  );

  const requestMicrophone = async () => {
    setPermissionDenied(false);
    if (process.env.NODE_ENV !== "production" && designOnly) {
      await onStartCall();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      await onStartCall();
    } catch {
      console.warn("[MIC] Permission request failed");
      setPermissionDenied(true);
    }
  };

  return (
    <div
      ref={screenRef}
      className={`${styles.lightScreen} ${!showPermission ? styles.welcomeScreen : ""}`}
    >
      <BrandMark className={styles.topBrand} />
      {showPermission && (
        <button
          type="button"
          className={styles.backButton}
          onClick={() => {
            setShowPermission(false);
            setPermissionDenied(false);
          }}
          aria-label="Volver"
        >
          <ChevronLeft size={20} />
        </button>
      )}

      <main className={styles.centerContent}>
        {showPermission ? (
          <>
            <div
              className={`${styles.micHalo} ${permissionDenied ? styles.micHaloDenied : ""}`}
            >
              <div
                className={`${styles.micDisc} ${permissionDenied ? styles.micDiscDenied : ""}`}
              >
                {permissionDenied ? <MicOff size={34} /> : <Mic size={34} />}
              </div>
            </div>
            <h1
              tabIndex={-1}
              className={`${styles.permissionTitle} ${styles.display}`}
            >
              {permissionDenied
                ? "Activa tu micrófono"
                : "Hablemos de tu piel."}
            </h1>
            <p className={styles.subtitle}>
              {permissionDenied
                ? "Permite el acceso en tu navegador y vuelve a intentarlo."
                : "Permite el micrófono para conversar. Puedes silenciarlo cuando quieras."}
            </p>
          </>
        ) : (
          <>
            <p className={styles.eyebrow}>Clara / Asesoría personal</p>
            <p className={styles.greeting}>
              {displayName ? `Hola, ${displayName}.` : "Hola, soy Clara."}
            </p>
            <h1 tabIndex={-1} className={`${styles.title} ${styles.display}`}>
              Tu cuidado,
              <br />
              más simple.
            </h1>
            <p className={styles.subtitle}>
              Conversemos sobre tu piel y los productos que van contigo.
            </p>
          </>
        )}
      </main>

      <div className={styles.bottomActions}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={
            showPermission ? requestMicrophone : () => setShowPermission(true)
          }
          disabled={isLoading || isRateLimited}
        >
          {isLoading
            ? "Conectando con Clara…"
            : isRateLimited
              ? `Intenta de nuevo en ${rateLimitCountdown}s`
              : showPermission
                ? permissionDenied
                  ? "Volver a pedir permiso"
                  : "Permitir micrófono"
                : "Hablar con Clara"}
        </button>
        {!showPermission && (
          <p className={styles.actionNote}>
            Asesoría de cuidado de la piel con IA.
          </p>
        )}
        {isRateLimited && (
          <p className={styles.errorNote}>
            Alcanzaste el límite temporal de sesiones.
          </p>
        )}
        {!showPermission && onViewSavedRoutine && (
          <button
            type="button"
            className={styles.routineEntry}
            onClick={onViewSavedRoutine}
            disabled={isLoading}
          >
            <span>
              <span className={styles.eyebrow}>Tu cuidado diario</span>
              <span className={styles.routineEntryTitle}>
                Mi rutina guardada
              </span>
              <span className={styles.routineEntryCopy}>
                Consulta tus productos y pasos.
              </span>
            </span>
            <ArrowUpRight size={22} aria-hidden="true" />
          </button>
        )}
        {!showPermission && onViewLastConsultation && (
          <button
            type="button"
            className={styles.textButton}
            onClick={onViewLastConsultation}
            disabled={isLoading}
          >
            Volver a mi consulta
          </button>
        )}
      </div>
    </div>
  );
};

// ============================================
// CONNECTING SCREEN COMPONENT (shadcn/ui redesign)
// ============================================
const ConnectingScreen: React.FC = () => {
  return (
    <div className={styles.darkScreen} role="status" aria-live="polite">
      <BrandMark dark className={styles.topBrand} />
      <div className={styles.connectingContent}>
        <div className={styles.connectingPortrait}>
          <ClaraPortrait compact />
        </div>
        <p className={`${styles.connectingLabel} ${styles.display}`}>
          Conectando con Clara…
        </p>
        <div className={styles.progressTrack} aria-hidden="true">
          <div className={styles.progressBar} />
        </div>
      </div>
    </div>
  );
};

// ============================================
// AVATAR VIDEO COMPONENT
// ============================================
interface AvatarVideoProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isStreamReady: boolean;
  chromaKeyEnabled: boolean;
  chromaSettings: ChromaSettings;
}

/**
 * Avatar video with optional chroma key (green screen removal).
 *
 * DOM stack when chroma key is ON (matches HeyGen official bg-removal-demo):
 *   <container>
 *     <bg-layer />   ← transparent, color, or image background (z-0)
 *     <video />      ← raw avatar stream, visibility:hidden keeps decoder alive (z-10)
 *     <canvas />     ← processed frames with green removed (z-20)
 *   </container>
 *
 * When chroma key is OFF: plain <video> element, no canvas.
 *
 * CRITICAL: video uses `visibility: hidden` (NOT opacity:0 or display:none)
 * because the browser may pause the video decoder if the element is not visible.
 *
 * @see https://docs.liveavatar.com/docs/guides/change-background
 */
const AvatarVideo: React.FC<AvatarVideoProps> = ({
  videoRef,
  isStreamReady,
  chromaKeyEnabled,
  chromaSettings,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const chromaConfig = useMemo<ChromaKeyConfig>(
    () => ({
      enabled: chromaKeyEnabled && isStreamReady,
      options: {
        ...(chromaSettings.minHue != null && { minHue: chromaSettings.minHue }),
        ...(chromaSettings.maxHue != null && { maxHue: chromaSettings.maxHue }),
        ...(chromaSettings.minSaturation != null && {
          minSaturation: chromaSettings.minSaturation,
        }),
        ...(chromaSettings.edgeSharpness != null && {
          edgeSharpness: chromaSettings.edgeSharpness,
        }),
      },
    }),
    [chromaKeyEnabled, isStreamReady, chromaSettings],
  );

  useChromaKey(videoRef, canvasRef, chromaConfig);

  const { isDesktop: isDesktopBg } = useScreenSize();
  const bgUrl = isDesktopBg
    ? chromaSettings.bgUrlDesktop
    : chromaSettings.bgUrlMobile;

  return (
    <div className="avatar-container rounded-2xl overflow-hidden shadow-2xl relative">
      {!isStreamReady && (
        <div className="avatar-placeholder flex items-center justify-center">
          <div className="spinner w-8 h-8" />
        </div>
      )}

      {/* Background layer (z-0) — transparent, or custom image via CHROMA_BG_URL */}
      {chromaKeyEnabled && (
        <div className="absolute inset-0 z-0">
          {bgUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={bgUrl} alt="" className="w-full h-full object-cover" />
          ) : null}
        </div>
      )}

      {/* Raw video (z-10) — always playing so the canvas has a live source.
          visibility:hidden keeps the decoder running; display:none would freeze it. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={false}
        className={`w-full h-full object-cover ${chromaKeyEnabled ? "absolute inset-0 z-10" : ""}`}
        style={
          chromaKeyEnabled
            ? { visibility: isStreamReady ? "hidden" : "visible" }
            : { opacity: isStreamReady ? 1 : 0, transition: "opacity 500ms" }
        }
      />

      {/* Chroma key canvas (z-20) — only rendered when enabled */}
      {chromaKeyEnabled && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-cover z-20"
          style={{
            visibility: isStreamReady ? "visible" : "hidden",
          }}
        />
      )}
    </div>
  );
};

// ============================================
// CONNECTED SESSION COMPONENT (Voice Agent)
// ============================================
interface ConnectedSessionProps {
  onEndCall: () => void;
  isEnding: boolean;
  canRetryStop: boolean;
  chromaKeyEnabled: boolean;
  chromaSettings: ChromaSettings;
}

const ConnectedSession: React.FC<ConnectedSessionProps> = ({
  onEndCall,
  isEnding,
  canRetryStop,
  chromaKeyEnabled,
  chromaSettings,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { isDesktop } = useScreenSize();
  const { fixedHeight, isInIframe } = useFixedHeight();

  // State from context — driven by SDK events (AgentEventsEnum / VoiceChatEvent)
  const {
    sessionRef,
    customerData,
    isMuted,
    isUserTalking,
    isAvatarTalking,
    flowDiagnostics,
  } = useLiveAvatarContext();
  const { isStreamReady, connectionQuality, attachElement } = useSession();

  // Local state: "thinking" = between USER_SPEAK_ENDED and AVATAR_SPEAK_STARTED
  const [isThinking, setIsThinking] = useState(false);
  // Track subscription is not enough: wait for decoded/presented video frames.
  const [isMediaPlaybackReady, setIsMediaPlaybackReady] = useState(false);

  // Note: removed full-screen warmup overlay (it was covering the avatar
  // while audio played). The AvatarVideo component already has its own
  // in-container spinner shown while !isStreamReady — that disappears
  // automatically once the stream attaches, without blocking the avatar.

  // Session limit
  const [sessionSecondsRemaining, setSessionSecondsRemaining] = useState(
    SESSION_LIMIT_MINUTES * 60,
  );
  const [showExpiryWarning, setShowExpiryWarning] = useState(false);
  const sessionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const keepAliveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const deferredSessionStopRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Track if customer context has been sent (one-time per session)
  const hasSentContextRef = useRef(false);

  // === SAFE CLIENT TELEMETRY (non-production only) ===
  // Send only allowlisted event names; never send conversational or provider payloads.
  const sendServerLog = useCallback(
    (
      event: SafeClientTelemetryEvent,
      level: "info" | "warn" | "error" = "info",
    ) => {
      // NEXT_PUBLIC_VERCEL_ENV is available client-side; skip only in actual production
      if (process.env.NEXT_PUBLIC_VERCEL_ENV === "production") return;
      const device = isDesktop ? "desktop" : "mobile";
      fetch("/api/client-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event,
          level,
          device,
        }),
      }).catch(() => {}); // Fire and forget
    },
    [isDesktop],
  );

  // === PLUGIN INIT: voiceChat verify → wait for greeting → contextual_update ===
  // IMPORTANT: Do NOT send contextual_update before the greeting finishes.
  // Sending commands too early can cause the ElevenLabs agent to reinitialize,
  // creating multiple simultaneous conversations (observed: 3 conversations
  // with 3 separate greetings, none responding to user input afterward).
  //
  // Flow: streamReady → verify mic → attach media → present stable video frames
  //                  → contextual_update → greeting trigger
  // REQUIRES: ElevenLabs agent dashboard → "First message" must be EMPTY.
  const hasStartedVoiceChatRef = useRef(false);
  const [isVoiceChatReady, setIsVoiceChatReady] = useState(false);

  // Step 1: On streamReady, ensure mic stays MUTED during greeting.
  // The mic is unmuted in Step 3 (after AVATAR_SPEAK_ENDED) so the agent
  // can't be interrupted by ambient noise or echo during its opening line.
  useEffect(() => {
    const session = sessionRef.current;
    if (!isStreamReady || !session) return;

    if (hasStartedVoiceChatRef.current) return;
    hasStartedVoiceChatRef.current = true;
    let cancelled = false;

    const prepareVoiceChat = async () => {
      const vcState = session.voiceChat.state;
      const vcMuted = session.voiceChat.isMuted;

      console.info("[PLUGIN] voiceChat state observed");
      sendServerLog("voicechat_state_observed");

      try {
        // Force-mute during greeting so ambient sound can't trigger an interrupt.
        // Await startup completely: unmute() is intentionally ignored by the SDK
        // while VoiceChat is STARTING, which previously left the call muted.
        if (vcState === VoiceChatState.ACTIVE) {
          if (!vcMuted) await session.voiceChat.mute();
        } else {
          console.log("[PLUGIN] VoiceChat not active, starting muted...");
          await session.voiceChat.start({ defaultMuted: true });
        }

        if (cancelled) return;
        if (session.voiceChat.state !== VoiceChatState.ACTIVE) {
          throw new Error(
            `VoiceChat did not become active (state=${session.voiceChat.state})`,
          );
        }

        console.info("[PLUGIN] VoiceChat ready for greeting");
        sendServerLog("voicechat_ready");
        setIsVoiceChatReady(true);
      } catch {
        console.error("[PLUGIN] voiceChat preparation failed");
        sendServerLog("voicechat_prepare_failed", "error");
        hasStartedVoiceChatRef.current = false;
        if (!cancelled) {
          toast.error("No pudimos activar el micrófono", {
            description: "Revisá el micrófono y volvé a intentar la llamada.",
          });
        }
      }
    };

    void prepareVoiceChat();
    return () => {
      cancelled = true;
      // React Strict Mode runs an immediate setup → cleanup → setup cycle in
      // development. Allow the second setup to finish mic preparation.
      hasStartedVoiceChatRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreamReady]);

  // Step 2: After real media playback readiness, do a 2-step handshake:
  //
  //   2a. contextual_update → inject customer info as silent context (no response)
  //   2b. sendUserMessage("Hola") → trigger the agent's first response
  //
  // Why two steps: contextual_update is purely silent (stores info, doesn't
  // trigger a response). sendUserMessage simulates a user message which DOES
  // trigger a response — that response will use the context from step 2a.
  // Reliable LiveKit publishes are awaited in order. This proves local publish
  // settlement (not connector ingestion) and avoids timer-based ordering.
  //
  // REQUIRES: ElevenLabs agent dashboard → "First message" must be EMPTY.
  useEffect(() => {
    const session = sessionRef.current;
    if (
      !isStreamReady ||
      !isMediaPlaybackReady ||
      !isVoiceChatReady ||
      !session
    )
      return;
    if (hasSentContextRef.current) return;
    hasSentContextRef.current = true;

    console.info("[PLUGIN] Sending context and greeting trigger");

    let cancelled = false;
    const initializeGreeting = async () => {
      const context = {
        firstName: customerData?.firstName,
        skinType: customerData?.skinType,
        skinConcerns: customerData?.skinConcerns,
        ordersCount: customerData?.ordersCount,
        lastOrderProduct: customerData?.lastOrderProduct,
        lastOrderDate: customerData?.lastOrderDate,
        conversationMemory: customerData?.conversationMemory,
      };

      // Contextual updates are idempotent, so retry one rejected local publish.
      try {
        await sendCustomerContextAndWait(session, context);
      } catch {
        console.warn("[PLUGIN] Context publish rejected; retrying once");
        try {
          await sendCustomerContextAndWait(session, context);
        } catch {
          hasSentContextRef.current = false;
          console.error("[PLUGIN] Context publish failed after retry");
          sendServerLog("greeting_trigger_failed", "error");
          return;
        }
      }

      if (cancelled) return;
      try {
        console.info("[PLUGIN] Sending greeting trigger after context settled");
        await session.sendUserMessageAndWait("[START]");
        if (!cancelled) sendServerLog("greeting_triggered");
      } catch {
        hasSentContextRef.current = false;
        console.error("[PLUGIN] greeting trigger publish failed");
        sendServerLog("greeting_trigger_failed", "error");
      }
    };
    void initializeGreeting();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreamReady, isMediaPlaybackReady, isVoiceChatReady, customerData]);

  // Step 3: After the greeting finishes (first AVATAR_SPEAK_ENDED), unmute
  // the mic so the user can respond. This prevents ambient noise from
  // interrupting the greeting mid-sentence.
  const hasUnmutedAfterGreetingRef = useRef(false);
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;

    const onGreetingFinished = async () => {
      if (hasUnmutedAfterGreetingRef.current) return;
      hasUnmutedAfterGreetingRef.current = true;
      console.info("[PLUGIN] Greeting completed");
      sendServerLog("greeting_completed");

      try {
        if (session.voiceChat.state !== VoiceChatState.ACTIVE) {
          throw new Error(
            `Cannot unmute VoiceChat in state ${session.voiceChat.state}`,
          );
        }

        await session.voiceChat.unmute();
        if (session.voiceChat.isMuted) {
          throw new Error("VoiceChat remained muted after unmute()");
        }

        console.info("[PLUGIN] Microphone ready for user input");
        sendServerLog("microphone_ready");
      } catch {
        console.error("[PLUGIN] Microphone unmute failed");
        sendServerLog("microphone_unmute_failed", "error");
        toast.error("El micrófono sigue silenciado", {
          description: "Tocá el botón del micrófono para activarlo.",
        });
      }
      session.off(AgentEventsEnum.AVATAR_SPEAK_ENDED, onGreetingFinished);
    };

    session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, onGreetingFinished);
    return () => {
      session.off(AgentEventsEnum.AVATAR_SPEAK_ENDED, onGreetingFinished);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // === DIAGNOSTIC: Test ElevenLabs agent with text message ===
  const handleTestAgent = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      console.log("[DIAG] Sending test message via sendUserMessage...");
      session.sendUserMessage("Hola, me puedes escuchar?");
      console.log("[DIAG] sendUserMessage sent ✓");
      sendServerLog("agent_event_observed");
    } catch {
      console.error("[DIAG] sendUserMessage failed");
      sendServerLog("agent_event_observed", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // === DIAGNOSTIC: Log ALL SDK agent events (exhaustive) ===
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;

    // Event names are useful for lifecycle diagnosis; event payloads can contain
    // transcripts or identifiers and must not be logged client- or server-side.
    const logEvt = (tag: string) => {
      console.info(`[EVT] ${tag.slice(0, 64)}`);
      sendServerLog("agent_event_observed");
    };

    // Listen for EVERY known AgentEventsEnum
    const handlers: Array<[string, (...args: unknown[]) => void]> = [
      [
        AgentEventsEnum.ELEVENLABS_AGENT_EVENT,
        (e: unknown) => {
          const ev = e as Record<string, unknown>;
          logEvt(`EL:${String(ev.elevenlabs_event_type || "unknown")}`);
        },
      ],
      [AgentEventsEnum.USER_SPEAK_STARTED, () => logEvt("USER_SPEAK_STARTED")],
      [AgentEventsEnum.USER_SPEAK_ENDED, () => logEvt("USER_SPEAK_ENDED")],
      [AgentEventsEnum.USER_TRANSCRIPTION, () => logEvt("USER_TRANSCRIPTION")],
      [AgentEventsEnum.USER_TRANSCRIPTION_CHUNK, () => logEvt("USER_TX_CHUNK")],
      [
        AgentEventsEnum.AVATAR_SPEAK_STARTED,
        () => logEvt("AVATAR_SPEAK_STARTED"),
      ],
      [AgentEventsEnum.AVATAR_SPEAK_ENDED, () => logEvt("AVATAR_SPEAK_ENDED")],
      [AgentEventsEnum.AVATAR_TRANSCRIPTION, () => logEvt("AVATAR_TX")],
      [
        AgentEventsEnum.AVATAR_TRANSCRIPTION_CHUNK,
        () => logEvt("AVATAR_TX_CHUNK"),
      ],
      [AgentEventsEnum.SESSION_STOPPED, () => logEvt("SESSION_STOPPED")],
    ];

    for (const [evt, handler] of handlers) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session.on(evt as any, handler as any);
    }

    // CRITICAL: Catch-all for ANY emitted event (EventEmitter wildcard via monkeypatch)
    // This will show us if events arrive with unexpected names
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessionAny = session as any;
    const origEmit = sessionAny.emit.bind(session);
    sessionAny.emit = (event: string, ...args: unknown[]) => {
      // Only log agent-related events, skip noisy internal ones
      if (
        typeof event === "string" &&
        !event.startsWith("session.state") &&
        !event.startsWith("voicechat")
      ) {
        console.info(`[EMIT] ${event.slice(0, 64)}`);
        sendServerLog("agent_event_observed");
      }
      return origEmit(event, ...args);
    };

    return () => {
      for (const [evt, handler] of handlers) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        session.off(evt as any, handler as any);
      }
      // Restore original emit
      sessionAny.emit = origEmit;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // === UI STATE: Derive "thinking" from SDK events ===
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;

    const onUserSpeakEnded = () => {
      console.log("[STATE] User stopped speaking → thinking");
      setIsThinking(true);
    };
    const onAvatarSpeakStarted = () => {
      console.log("[STATE] Avatar speaking → not thinking");
      setIsThinking(false);
    };
    const onAvatarSpeakEnded = () => {
      console.log("[STATE] Avatar finished speaking");
      setIsThinking(false);
    };

    session.on(AgentEventsEnum.USER_SPEAK_ENDED, onUserSpeakEnded);
    session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, onAvatarSpeakStarted);
    session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, onAvatarSpeakEnded);

    return () => {
      session.off(AgentEventsEnum.USER_SPEAK_ENDED, onUserSpeakEnded);
      session.off(AgentEventsEnum.AVATAR_SPEAK_STARTED, onAvatarSpeakStarted);
      session.off(AgentEventsEnum.AVATAR_SPEAK_ENDED, onAvatarSpeakEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mute/unmute: SDK voiceChat handles mic + fires VoiceChatEvent
  const handleToggleMute = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      if (isMuted) {
        await session.voiceChat.unmute();
        console.log("[VOICECHAT] Unmuted");
      } else {
        await session.voiceChat.mute();
        console.log("[VOICECHAT] Muted");
      }
    } catch {
      console.error("[VOICECHAT] Toggle mute failed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMuted]);

  // Attach tracks, then wait for actual presented frames before greeting.
  useEffect(() => {
    const video = videoRef.current;
    if (!isStreamReady || !video) {
      setIsMediaPlaybackReady(false);
      return;
    }

    const abortController = new AbortController();
    const onPlaying = () =>
      flowDiagnostics?.mark(ClaraFlowDiagnosticEvent.MEDIA_PLAYING);
    video.addEventListener("playing", onPlaying, { once: true });
    let firstFrameHandle: number | null = null;
    if (video.requestVideoFrameCallback) {
      firstFrameHandle = video.requestVideoFrameCallback(() => {
        firstFrameHandle = null;
        flowDiagnostics?.mark(ClaraFlowDiagnosticEvent.FIRST_FRAME);
      });
    }
    const readiness = waitForMediaPlaybackReady(video, {
      signal: abortController.signal,
    });

    attachElement(video);

    readiness
      .then((result) => {
        const metric =
          `[MEDIA_READY] reason=${result.reason}` +
          ` elapsed_ms=${Math.round(result.elapsedMs)}` +
          ` frames=${result.framesPresented}` +
          ` ready_state=${result.readyState}` +
          ` chroma=${chromaKeyEnabled}`;

        if (result.reason === "timeout") {
          console.warn(metric);
        } else {
          console.info(metric);
        }
        setIsMediaPlaybackReady(true);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        console.error("[MEDIA_READY] readiness probe failed");
        setIsMediaPlaybackReady(true);
      });

    return () => {
      abortController.abort();
      video.removeEventListener("playing", onPlaying);
      if (firstFrameHandle !== null)
        video.cancelVideoFrameCallback?.(firstFrameHandle);
    };
  }, [isStreamReady, attachElement, chromaKeyEnabled, flowDiagnostics]);

  // Keep-alive with margin before the provider's five-minute boundary.
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;

    keepAliveIntervalRef.current = setInterval(
      () => {
        session
          .keepAlive()
          .then(() => console.log("[HEYGEN] Keep-alive sent"))
          .catch(() => console.warn("[HEYGEN] Keep-alive failed"));
      },
      4 * 60 * 1000,
    );

    return () => {
      if (keepAliveIntervalRef.current) {
        clearInterval(keepAliveIntervalRef.current);
        keepAliveIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Session limit timer
  useEffect(() => {
    if (!SESSION_LIMIT_ENABLED) return;

    sessionTimerRef.current = setInterval(() => {
      setSessionSecondsRemaining((prev) => {
        const newValue = prev - 1;
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

  // Handle session expiry
  useEffect(() => {
    if (SESSION_LIMIT_ENABLED && sessionSecondsRemaining <= 0) {
      console.log("[SESSION] Time limit reached, ending session");
      onEndCall();
    }
  }, [sessionSecondsRemaining, onEndCall]);

  // Cleanup on unmount
  useEffect(() => {
    const session = sessionRef.current;
    const stopOnPageUnload = () => {
      void session?.stop().catch(() => {
        console.error("[SESSION] Cleanup during page unload failed");
      });
    };

    // Some embedded browsers emit pagehide when merely changing tabs. Ending
    // there closes a healthy call. beforeunload is reserved for real
    // navigation/close; React unmount remains the in-app cleanup path.
    window.addEventListener("beforeunload", stopOnPageUnload);

    // Cancel the deferred stop scheduled by React Strict Mode's development
    // cleanup when the component is immediately mounted again.
    if (deferredSessionStopRef.current) {
      clearTimeout(deferredSessionStopRef.current);
      deferredSessionStopRef.current = null;
    }

    return () => {
      window.removeEventListener("beforeunload", stopOnPageUnload);
      // Defer one task so a Strict Mode remount can cancel this. On a real
      // unmount the callback runs and closes the complete provider session.
      deferredSessionStopRef.current = setTimeout(() => {
        void session?.stop().catch(() => {
          console.error("[SESSION] Cleanup after unmount failed");
        });
        deferredSessionStopRef.current = null;
      }, 0);
      if (sessionTimerRef.current) {
        clearInterval(sessionTimerRef.current);
        sessionTimerRef.current = null;
      }
      if (keepAliveIntervalRef.current) {
        clearInterval(keepAliveIntervalRef.current);
        keepAliveIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const containerStyle =
    fixedHeight && isInIframe
      ? { height: `${fixedHeight}px`, overflow: "hidden" as const }
      : {};
  const elapsedSeconds = SESSION_LIMIT_MINUTES * 60 - sessionSecondsRemaining;
  const elapsedLabel = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")}`;

  return (
    <div className={styles.darkScreen} style={containerStyle}>
      {isEnding && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/65 px-6 text-center">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-slate-900 shadow-2xl">
            <p className="text-lg font-semibold">Finalizando conversación…</p>
            <p className="mt-2 text-sm text-slate-600">
              Esperá un momento mientras cerramos la sesión de forma segura.
            </p>
            {canRetryStop && (
              <button
                type="button"
                onClick={onEndCall}
                className="mt-5 w-full rounded-full bg-blue-600 px-5 py-3 font-semibold text-white"
              >
                Reintentar cierre
              </button>
            )}
          </div>
        </div>
      )}
      {/* Session expiry warning */}
      {showExpiryWarning && (
        <SessionExpiryWarning secondsRemaining={sessionSecondsRemaining} />
      )}

      <div className={styles.callStage}>
        <div className={styles.callHeader}>
          <div
            className={styles.timerPill}
            aria-label={`Duración ${elapsedLabel}`}
          >
            <span className={styles.recordDot} aria-hidden="true" />
            {elapsedLabel}
          </div>
          <BrandMark dark className={styles.callBrand} />
          <span aria-hidden="true" />
        </div>

        <div className={styles.videoFrame}>
          <AvatarVideo
            videoRef={videoRef}
            isStreamReady={isStreamReady}
            chromaKeyEnabled={chromaKeyEnabled}
            chromaSettings={chromaSettings}
          />
        </div>

        <StatusIndicator
          isConnected={isStreamReady}
          isListening={isUserTalking}
          isThinking={isThinking}
          isSpeaking={isAvatarTalking}
          isMuted={isMuted}
          connectionQuality={connectionQuality}
        />

        <div className={styles.controls}>
          <VoiceControls
            isMuted={isMuted}
            isActive={isStreamReady}
            onToggleMute={handleToggleMute}
          />
          <button
            type="button"
            onClick={onEndCall}
            className={`${styles.roundControl} ${styles.endControl}`}
            aria-label="Finalizar conversación"
          >
            <PhoneOff size={27} />
          </button>

          {DEBUG_UI && (
            <div className="absolute left-4 bottom-4 flex gap-2">
              <Button
                onClick={handleTestAgent}
                variant="outline"
                size="sm"
                className="text-xs bg-yellow-100 border-yellow-300 hover:bg-yellow-200"
              >
                <MessageSquare className="w-3 h-3 mr-1" />
                Test Agent (text)
              </Button>
              <Button
                onClick={() => {
                  const vc = sessionRef.current?.voiceChat;
                  if (!vc) return;
                  const msg = `state=${vc.state}, muted=${vc.isMuted}`;
                  console.log(`[DIAG] Manual check: ${msg}`);
                  alert(`VoiceChat: ${msg}`);
                }}
                variant="outline"
                size="sm"
                className="text-xs bg-blue-100 border-blue-300 hover:bg-blue-200"
              >
                <Bug className="w-3 h-3 mr-1" />
                Mic Status
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================
// SESSION WRAPPER COMPONENT
// ============================================
interface ChromaSettings {
  minHue?: number;
  maxHue?: number;
  minSaturation?: number;
  edgeSharpness?: number;
  bgUrlDesktop?: string | null;
  bgUrlMobile?: string | null;
}

interface SessionWrapperProps {
  onSessionStopped: () => void;
  chromaKeyEnabled: boolean;
  chromaSettings: ChromaSettings;
}

const SessionWrapper: React.FC<SessionWrapperProps> = ({
  onSessionStopped,
  chromaKeyEnabled,
  chromaSettings,
}) => {
  const { widgetState, sessionState } = useLiveAvatarContext();
  const { startSession, stopSession } = useSession();
  const [canRetryStop, setCanRetryStop] = useState(false);

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

  useEffect(() => {
    if (sessionState !== SessionState.DISCONNECTING) {
      setCanRetryStop(false);
      return;
    }

    const retryTimer = setTimeout(() => setCanRetryStop(true), 5000);
    return () => clearTimeout(retryTimer);
  }, [sessionState]);

  const handleEndCall = useCallback(() => {
    setCanRetryStop(false);
    void stopSession().catch(() => {
      setCanRetryStop(true);
      toast.error("No pudimos confirmar el cierre", {
        description: "Reintentá para asegurar que la sesión quede finalizada.",
      });
    });
  }, [stopSession]);

  // Render based on widget state
  if (widgetState === WidgetState.CONNECTING) {
    return <ConnectingScreen />;
  }

  if (
    widgetState === WidgetState.CONNECTED ||
    sessionState === SessionState.DISCONNECTING
  ) {
    return (
      <ConnectedSession
        onEndCall={handleEndCall}
        isEnding={sessionState === SessionState.DISCONNECTING}
        canRetryStop={canRetryStop}
        chromaKeyEnabled={chromaKeyEnabled}
        chromaSettings={chromaSettings}
      />
    );
  }

  return <ConnectingScreen />;
};

type RecapView = "preparing" | "summary" | "routine";

// Reset presentation focus between screens without remounting the media session.
function useClaraScreenFocus(view: string) {
  const screenRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const screen = screenRef.current;
    // Do not scroll an embedding Shopify page when the UI is inside an iframe.
    window.scrollTo({ top: 0, behavior: "instant" });
    screen?.parentElement?.scrollTo({ top: 0, behavior: "instant" });
    screen
      ?.querySelector<HTMLHeadingElement>("h1")
      ?.focus({ preventScroll: true });
  }, [view]);
  return screenRef;
}

function formatCatalogPrice(product: ClaraCatalogProduct): string | null {
  if (!product.price) return null;
  const amount = Number(product.price.amount);
  if (!Number.isFinite(amount)) return null;
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: product.price.currencyCode,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

const RoutineProductCard: React.FC<{ product: ClaraCatalogProduct }> = ({
  product,
}) => {
  if (!product.url) return null;
  const price = formatCatalogPrice(product);
  const compareAtPrice = product.compareAtPrice
    ? formatCatalogPrice({ ...product, price: product.compareAtPrice })
    : null;

  return (
    <a
      className={styles.productCard}
      href={product.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Ver ${product.title} en la tienda`}
    >
      <div className={styles.productImageWrap}>
        {product.imageUrl ? (
          // Shopify CDN URL is validated server-side with the canonical product.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={styles.productImage}
            src={product.imageUrl}
            alt={product.imageAlt || product.title}
            loading="lazy"
          />
        ) : (
          <span className={styles.productImageFallback} aria-hidden="true">
            BETA
          </span>
        )}
      </div>
      <div className={styles.productDetails}>
        <span className={styles.productName}>{product.title}</span>
        {(price || compareAtPrice) && (
          <span className={styles.productPrices}>
            {price && <strong>{price}</strong>}
            {compareAtPrice && <del>{compareAtPrice}</del>}
            {compareAtPrice && <em>Oferta</em>}
          </span>
        )}
        <span className={styles.productLink}>
          Ver producto <ArrowUpRight size={14} aria-hidden="true" />
        </span>
      </div>
    </a>
  );
};

interface SessionRecapProps {
  savedRoutine?: ClaraRoutine;
  savedConsultationDate?: string | null;
  onViewSavedRoutine?: () => void;
  view: RecapView;
  durationSeconds: number;
  customerData?: CustomerData | null;
  result?: ClaraConsultationResult | null;
  processingError?: string | null;
  onRetrySummary?: () => void;
  releaseState?: "releasing" | "released" | "unconfirmed" | null;
  onViewChange: (view: RecapView) => void;
  onTalkAgain: () => void;
}

export const SessionRecap: React.FC<SessionRecapProps> = ({
  savedRoutine,
  savedConsultationDate,
  onViewSavedRoutine,
  view,
  durationSeconds,
  customerData,
  result = null,
  processingError = null,
  onRetrySummary,
  releaseState = null,
  onViewChange,
  onTalkAgain,
}) => {
  const minutes = Math.max(1, Math.round(durationSeconds / 60));
  const product = customerData?.lastOrderProduct;
  const hasRoutine = Boolean(result?.routine?.steps.length);
  const screenRef = useClaraScreenFocus(view);

  if (view === "preparing") {
    return (
      <div
        ref={screenRef}
        className={styles.lightScreen}
        role="status"
        aria-live="polite"
      >
        <div className={styles.centerContent}>
          <div className={styles.preparingDot} />
          <h1
            tabIndex={-1}
            className={`${styles.connectingLabel} ${styles.display}`}
          >
            {processingError || "Preparando tu resumen…"}
          </h1>
          {hasRoutine && (
            <p className={styles.recapText}>Tu rutina está guardada.</p>
          )}
          {onViewSavedRoutine && (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onViewSavedRoutine}
            >
              {hasRoutine ? "Ver mi rutina" : "Mi rutina guardada"}
            </button>
          )}
          {processingError && onRetrySummary && (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onRetrySummary}
            >
              Consultar resumen de nuevo
            </button>
          )}
          {releaseState === "unconfirmed" && (
            <p className={styles.errorNote}>
              No pudimos confirmar la liberación del acceso.
            </p>
          )}
          {processingError && (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onTalkAgain}
            >
              Volver al inicio
            </button>
          )}
        </div>
      </div>
    );
  }

  if (view === "routine") {
    const routine = savedRoutine || result?.routine;
    return (
      <div ref={screenRef} className={styles.recapScreen}>
        <div className={styles.recapInner}>
          <button
            type="button"
            className={styles.backButton}
            onClick={() => onViewChange("summary")}
            aria-label={savedRoutine ? "Volver" : "Volver al resumen"}
          >
            <ChevronLeft size={20} />
          </button>
          <BrandMark className={styles.topBrand} />
          <h1
            tabIndex={-1}
            className={`${styles.recapTitle} ${styles.display}`}
            style={{ marginTop: 28 }}
          >
            {savedRoutine ? "Mi rutina guardada" : "Mi rutina"}
          </h1>
          <p className={styles.recapMeta}>
            {savedRoutine
              ? savedConsultationDate
                ? `Rutina de la consulta del ${new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "long" }).format(new Date(savedConsultationDate))}`
                : "Tu última rutina guardada"
              : "Tus productos. Paso a paso."}
          </p>
          {savedRoutine && (
            <p className={styles.recapMeta}>
              Consulta precio y disponibilidad en la tienda.
            </p>
          )}
          <div className={styles.recapCard}>
            <div className={styles.eyebrow}>Objetivos conversados</div>
            <p className={styles.recapText}>{routineGoalsText(routine)}</p>
          </div>
          <ol className={styles.routineSteps} aria-label="Pasos de tu rutina">
            {routine?.steps.map((step, index) => (
              <li
                className={styles.routineStep}
                key={`${step.moment}-${step.order}-${index}`}
              >
                <div className={styles.eyebrow}>
                  {step.moment === "morning"
                    ? "Mañana"
                    : step.moment === "evening"
                      ? "Noche"
                      : step.moment === "morning_evening"
                        ? "Mañana y noche"
                        : "Semanal"}{" "}
                  · Paso {step.order}
                </div>
                {step.product?.url && (
                  <RoutineProductCard product={step.product} />
                )}
                <p className={styles.recapText}>{step.instruction}</p>
                {step.frequency && (
                  <p className={styles.recapMeta}>{step.frequency}</p>
                )}
              </li>
            ))}
          </ol>
          {routine?.cautions.map((caution) => (
            <div className={styles.recapCard} key={caution}>
              <div className={styles.eyebrow}>A tener en cuenta</div>
              <p className={styles.recapText}>{caution}</p>
            </div>
          ))}
          <div className={styles.recapActions}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={onTalkAgain}
            >
              Volver a hablar con Clara
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={screenRef} className={styles.recapScreen}>
      <div className={styles.recapInner}>
        <BrandMark className={styles.topBrand} />
        <p className={styles.eyebrow}>Consulta finalizada</p>
        <h1 tabIndex={-1} className={`${styles.recapTitle} ${styles.display}`}>
          Tu conversación con Clara
        </h1>
        <p className={styles.recapMeta}>Hoy · {minutes} min</p>
        {releaseState === "releasing" && (
          <p className={styles.recapMeta} role="status">
            Liberando el acceso…
          </p>
        )}
        {releaseState === "unconfirmed" && (
          <p className={styles.errorNote} role="status">
            No pudimos confirmar la liberación del acceso. Tu rutina no se borra
            por esto.
          </p>
        )}
        <div className={styles.recapCard}>
          <div className={styles.eyebrow}>Resumen de tu consulta</div>
          <p className={styles.recapText}>
            {result?.summary ||
              processingError ||
              "Tu resumen sigue procesándose."}
          </p>
          {onRetrySummary && processingError && (
            <button
              type="button"
              className={styles.textButton}
              onClick={onRetrySummary}
            >
              {result?.summary
                ? "Actualizar consulta"
                : "Consultar resumen de nuevo"}
            </button>
          )}
        </div>
        {product && (
          <div className={styles.recapCard}>
            <div className={styles.eyebrow}>Producto en contexto</div>
            <p className={`${styles.recapText} ${styles.display}`}>{product}</p>
          </div>
        )}
        {!hasRoutine && (
          <div className={styles.recapCard} role="status">
            <div className={styles.eyebrow}>Rutina de esta consulta</div>
            <p className={styles.recapText}>
              Todavía no confirmamos una nueva rutina. Puedes consultar tu
              rutina guardada.
            </p>
          </div>
        )}
        <div className={styles.recapActions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() =>
              hasRoutine
                ? onViewSavedRoutine
                  ? onViewSavedRoutine()
                  : onViewChange("routine")
                : onTalkAgain()
            }
          >
            {hasRoutine ? "Ver mi rutina" : "Hablar nuevamente con Clara"}
          </button>
          {!hasRoutine && onViewSavedRoutine && (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onViewSavedRoutine}
            >
              Mi rutina guardada
            </button>
          )}
          <a
            className={styles.secondaryButton}
            href="https://betaskintech.com"
            rel="noreferrer"
          >
            Volver a la tienda
          </a>
          {hasRoutine && (
            <button
              type="button"
              className={styles.textButton}
              onClick={onTalkAgain}
            >
              Hablar otra vez con Clara
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================
// MAIN WIDGET COMPONENT
// ============================================
export interface ClaraVoiceAgentProps {
  userName?: string | null;
  customerData?: CustomerData | null;
  designPreview?: string | null;
}

type ConsultationCredentials = {
  id: string;
  accessToken: string;
};

const designPreviewResult: ClaraConsultationResult = {
  consultationId: "preview",
  status: "completed",
  summary:
    "Conversaron sobre hidratación, sensibilidad y cómo incorporar los productos de forma gradual.",
  transcript: [],
  routine: {
    concerns: ["Hidratación", "Sensibilidad"],
    cautions: ["Introduce un producto nuevo por vez."],
    steps: [
      {
        moment: "morning",
        order: 1,
        instruction: "Aplica sobre la piel limpia, antes de tu hidratante.",
        frequency: "Todos los días",
        product: {
          id: "demo-radiance",
          title: "iD Radiance",
          handle: "demo-radiance",
          url: "#producto-demo",
          imageUrl: null,
          imageAlt: null,
          availableForSale: true,
          price: null,
          compareAtPrice: null,
          description: "",
          companionCondition: null,
          companionProducts: [],
        },
      },
      {
        moment: "morning_evening",
        order: 2,
        instruction: "Aplica tu hidratante en rostro y cuello.",
        product: {
          id: "demo-hidra",
          title: "Beta Hidra",
          handle: "demo-hidra",
          url: "#producto-demo",
          imageUrl: null,
          imageAlt: null,
          availableForSale: true,
          price: null,
          compareAtPrice: null,
          description: "",
          companionCondition: null,
          companionProducts: [],
        },
      },
    ],
  },
};

/** Visual sandbox: fixture data only, no media session or persistence requests. */
export function ClaraDesignPreview({
  initialView = "welcome",
}: {
  initialView?: string;
}) {
  const [view, setView] = useState(initialView);
  const [muted, setMuted] = useState(false);
  if (view === "board") {
    return (
      <main className={`${styles.shell} ${styles.previewBoard}`}>
        <header>
          <p className={styles.eyebrow}>Beta Skintech / Dirección visual</p>
          <h1 className={styles.recapTitle}>Clara. Diseño Lab.</h1>
          <p className={styles.recapMeta}>
            Demo local con datos de ejemplo. No inicia llamadas ni guarda
            cambios.
          </p>
          <a className={styles.productLink} href="?design_preview=welcome">
            Abrir el recorrido a pantalla completa <ArrowUpRight size={14} />
          </a>
        </header>
        <div className={styles.previewBoardGrid}>
          <section>
            <h2 className={styles.eyebrow}>01 / Inicio</h2>
            <iframe
              title="Inicio móvil de Clara"
              src="?design_preview=welcome"
            />
          </section>
          <section>
            <h2 className={styles.eyebrow}>02 / Mi rutina</h2>
            <iframe
              title="Rutina móvil de Clara"
              src="?design_preview=routine"
            />
          </section>
        </div>
      </main>
    );
  }
  const views = [
    ["welcome", "Inicio"],
    ["permission", "Micrófono"],
    ["denied", "Sin permiso"],
    ["connecting", "Conexión"],
    ["call", "Llamada"],
    ["preparing", "Procesando"],
    ["summary", "Resumen"],
    ["routine", "Rutina"],
    ["limited", "Límite"],
    ["empty", "Sin rutina"],
    ["routine-error", "Error"],
    ["access", "Acceso"],
  ];
  return (
    <div className={`${styles.shell} ${styles.previewFrame}`}>
      <nav className={styles.previewNav} aria-label="Pantallas de demostración">
        <strong>LAB · Demo sin llamadas</strong>
        {views.map(([id, label]) => (
          <a
            key={id}
            href={`?design_preview=${id}`}
            aria-current={view === id ? "page" : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      {view === "access" ? (
        <ShopifyVerificationStates state="loading" />
      ) : view === "empty" || view === "routine-error" ? (
        <SavedRoutineStatus
          loaded={view === "empty"}
          error={
            view === "routine-error"
              ? "No pudimos recuperar tu rutina. Intenta nuevamente; esto no significa que se haya borrado."
              : null
          }
          onBack={() => setView("welcome")}
          onRetry={() => setView("routine")}
        />
      ) : view === "connecting" ? (
        <ConnectingScreen />
      ) : view === "call" ? (
        <div className={styles.darkScreen}>
          <div className={styles.callStage}>
            <div className={styles.videoFrame}>
              {/* Local portrait is a placeholder, not a live stream. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className={styles.previewPortrait}
                src="/clara-avatar.png"
                alt="Vista de ejemplo de Clara, sin videollamada activa"
              />
            </div>
            <div className={styles.callHeader}>
              <div className={styles.timerPill}>02:14</div>
              <BrandMark dark className={styles.callBrand} />
              <span />
            </div>
            <div className={styles.statusWrap}>
              <span className={styles.statusPill}>
                {muted ? "Silenciado" : "Escuchando · Demo"}
              </span>
            </div>
            <div className={styles.controls}>
              <button
                className={`${styles.roundControl} ${styles.muteControl} ${muted ? styles.mutedControl : ""}`}
                onClick={() => setMuted(!muted)}
                aria-label={muted ? "Activar micrófono" : "Silenciar micrófono"}
                aria-pressed={muted}
              >
                {muted ? <MicOff /> : <Mic />}
              </button>
              <button
                className={`${styles.roundControl} ${styles.endControl}`}
                onClick={() => setView("summary")}
                aria-label="Finalizar conversación"
              >
                <PhoneOff />
              </button>
            </div>
          </div>
        </div>
      ) : ["preparing", "summary", "routine"].includes(view) ? (
        <SessionRecap
          view={view as RecapView}
          durationSeconds={364}
          result={designPreviewResult}
          onViewChange={setView}
          onTalkAgain={() => setView("welcome")}
          onViewSavedRoutine={() => setView("routine")}
        />
      ) : (
        <LandingScreen
          key={view}
          designOnly
          previewPermission={
            view === "permission"
              ? "request"
              : view === "denied"
                ? "denied"
                : undefined
          }
          userName="Ana"
          isLoading={false}
          isRateLimited={view === "limited"}
          rateLimitCountdown={45}
          onStartCall={async () => setView("call")}
          onViewSavedRoutine={() => setView("routine")}
        />
      )}
    </div>
  );
}

export const ClaraVoiceAgent: React.FC<ClaraVoiceAgentProps> = ({
  userName = null,
  customerData = null,
  designPreview = null,
}) => {
  const [showSavedRoutine, setShowSavedRoutine] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [diagnosticTiming, setDiagnosticTiming] = useState<{
    traceId: string | null;
    startedAt: number;
    tokenReceivedAt: number;
  } | null>(null);
  const [chromaKeyEnabled, setChromaKeyEnabled] = useState(false);
  const [chromaSettings, setChromaSettings] = useState<{
    minHue?: number;
    maxHue?: number;
    minSaturation?: number;
    edgeSharpness?: number;
    bgUrlDesktop?: string | null;
    bgUrlMobile?: string | null;
  }>({});
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recapView, setRecapView] = useState<RecapView | null>(null);
  const [completedSessionSeconds, setCompletedSessionSeconds] = useState(0);
  const [consultationCredentials, setConsultationCredentials] =
    useState<ConsultationCredentials | null>(null);
  const [consultationResult, setConsultationResult] =
    useState<ClaraConsultationResult | null>(null);
  const [consultationProcessingError, setConsultationProcessingError] =
    useState<string | null>(null);
  const [recapPolling, setRecapPolling] = useState(false);
  const [pollRevision, setPollRevision] = useState(0);
  const [releaseState, setReleaseState] = useState<
    "releasing" | "released" | "unconfirmed" | null
  >(null);
  const releaseGeneration = useRef(0);
  const [conversationMemory, setConversationMemory] =
    useState<ClaraConversationMemory>([]);
  const sessionStartedAtRef = useRef<number | null>(null);
  const { fixedHeight, isInIframe } = useFixedHeight();
  const { isDesktop } = useScreenSize();
  const activeCustomerData = useMemo<CustomerData | null>(
    () =>
      customerData || conversationMemory.length
        ? { ...(customerData || {}), conversationMemory }
        : null,
    [customerData, conversationMemory],
  );

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
    setConversationMemory([]);
    setRecapPolling(false);
    const requestedAt = performance.now();

    try {
      // LITE connector: ElevenLabs handles conversation; LiveAvatar renders it.
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

        // Buyer-specific start quota and active-session lock.
        if (res.status === 429 || res.status === 409) {
          const retryAfter = errorData.retryAfter || 60;
          setRateLimitCountdown(retryAfter);

          toast.error(
            res.status === 409
              ? "Ya hay una conversación activa"
              : "Límite de conversaciones alcanzado",
            {
              description:
                res.status === 409
                  ? "Finalizá la conversación abierta o esperá unos minutos para volver a intentar."
                  : `Podés iniciar hasta tres conversaciones por hora. Volvé a intentar en ${Math.ceil(retryAfter / 60)} min.`,
              duration: 5000,
            },
          );

          return; // Exit early, don't throw error
        }

        if (res.status === 503) {
          toast.error("Acceso temporalmente no disponible", {
            description:
              "No iniciamos una sesión paga porque no pudimos validar el límite. Probá nuevamente en unos segundos.",
          });
          return;
        }

        throw new Error(errorData.error || "Failed to start session");
      }

      const {
        session_token,
        chroma_key_enabled,
        chroma_config,
        consultation_id,
        consultation_access_token,
        consultation_persistence_available,
        conversation_memory,
        diagnostic_trace_id,
      } = await res.json();
      setDiagnosticTiming({
        traceId:
          typeof diagnostic_trace_id === "string" ? diagnostic_trace_id : null,
        startedAt: requestedAt,
        tokenReceivedAt: performance.now(),
      });
      sessionStartedAtRef.current = Date.now();
      releaseGeneration.current += 1;
      setReleaseState(null);
      setRecapView(null);
      setConsultationResult(null);
      setConsultationProcessingError(null);
      setConsultationCredentials(
        consultation_persistence_available !== false &&
          consultation_id &&
          consultation_access_token
          ? {
              id: consultation_id,
              accessToken: consultation_access_token,
            }
          : null,
      );
      setConversationMemory(
        Array.isArray(conversation_memory) ? conversation_memory : [],
      );
      setSessionToken(session_token);
      setChromaKeyEnabled(chroma_key_enabled === true);
      if (chroma_config) setChromaSettings(chroma_config);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsStarting(false);
    }
  }, [isDesktop]);

  const handleSessionStopped = useCallback(() => {
    const startedAt = sessionStartedAtRef.current;
    setCompletedSessionSeconds(
      startedAt ? Math.max(1, Math.round((Date.now() - startedAt) / 1000)) : 0,
    );
    sessionStartedAtRef.current = null;
    setSessionToken(null);
    setRecapView("preparing");
    setConsultationProcessingError(null);
    setRecapPolling(true);
    if (consultationCredentials) {
      setReleaseState("releasing");
      const generation = releaseGeneration.current;
      void releaseConsultation(
        consultationCredentials.id,
        consultationCredentials.accessToken,
      ).then((released) => {
        if (generation !== releaseGeneration.current) return;
        setReleaseState(released ? "released" : "unconfirmed");
        if (!released)
          toast.error(
            "No pudimos confirmar el cierre. Revisá tu conexión antes de volver a intentar.",
          );
      });
    }
  }, [consultationCredentials]);

  useEffect(() => {
    if (!recapPolling) return;
    if (!consultationCredentials) {
      setConsultationProcessingError(
        "No pudimos preparar el resumen de esta conversación.",
      );
      setRecapPolling(false);
      return;
    }
    const controller = new AbortController();
    void pollConsultationResult({
      ...consultationCredentials,
      signal: controller.signal,
      onResult: (result) => {
        setConsultationResult(result);
        if (
          result.summary ||
          result.routine?.steps.length ||
          result.status === "completed"
        ) {
          setRecapView((view) => (view === "preparing" ? "summary" : view));
        }
      },
    }).then((outcome) => {
      if (controller.signal.aborted) return;
      setRecapPolling(false);
      setConsultationProcessingError(
        outcome === "ready"
          ? null
          : outcome === "partial"
            ? "Todavía no confirmamos una nueva rutina. Puedes volver a consultar."
            : outcome === "pending"
              ? "Tu resumen sigue pendiente. Puedes volver a consultarlo."
              : outcome === "unauthorized"
                ? "Tu acceso venció. Vuelve a entrar desde la tienda."
                : "No pudimos consultar el resumen. Puedes intentarlo de nuevo.",
      );
    });
    return () => controller.abort();
  }, [recapPolling, consultationCredentials, pollRevision]);

  const retrySummary = useCallback(() => {
    setConsultationProcessingError(null);
    setPollRevision((value) => value + 1);
    setRecapPolling(true);
  }, []);

  const handleTalkAgain = useCallback(() => {
    setRecapView(null);
    setError(null);
    setRecapPolling(false);
    // Keep the last consultation capability only in this component's memory.
    // A new successful call replaces it; no token is persisted in browser storage.
  }, []);

  const containerStyle =
    fixedHeight && isInIframe
      ? { height: `${fixedHeight}px`, overflow: "hidden" as const }
      : {};

  if (process.env.NODE_ENV !== "production" && designPreview) {
    return <ClaraDesignPreview initialView={designPreview} />;
  }

  return (
    <div
      className={styles.shell}
      style={{
        ...containerStyle,
        ...(fixedHeight && isInIframe && !sessionToken
          ? { overflow: "auto" }
          : {}),
      }}
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

      {/* MobileLogger: hidden unless DEBUG_UI=true */}
      {DEBUG_UI && <MobileLogger filter="" />}

      {showSavedRoutine ? (
        <SavedRoutinePanel
          onBack={() => setShowSavedRoutine(false)}
          renderRoutine={(saved) => (
            <SessionRecap
              view="routine"
              durationSeconds={0}
              savedRoutine={saved.routine!}
              savedConsultationDate={saved.consultationDate}
              onViewChange={() => setShowSavedRoutine(false)}
              onTalkAgain={() => {
                setShowSavedRoutine(false);
                handleTalkAgain();
              }}
            />
          )}
        />
      ) : recapView ? (
        <SessionRecap
          view={recapView}
          durationSeconds={completedSessionSeconds}
          customerData={customerData}
          result={consultationResult}
          processingError={consultationProcessingError}
          onRetrySummary={consultationCredentials ? retrySummary : undefined}
          releaseState={releaseState}
          onViewChange={setRecapView}
          onTalkAgain={handleTalkAgain}
          onViewSavedRoutine={() => setShowSavedRoutine(true)}
        />
      ) : !sessionToken ? (
        <LandingScreen
          onStartCall={handleStartCall}
          isLoading={isStarting}
          userName={userName}
          customerData={customerData}
          isRateLimited={isRateLimited}
          rateLimitCountdown={rateLimitCountdown}
          onViewSavedRoutine={() => setShowSavedRoutine(true)}
          onViewLastConsultation={
            consultationCredentials
              ? () => {
                  setRecapView(consultationResult ? "summary" : "preparing");
                  retrySummary();
                }
              : undefined
          }
        />
      ) : (
        <LiveAvatarContextProvider
          sessionAccessToken={sessionToken}
          diagnosticTraceId={diagnosticTiming?.traceId}
          diagnosticStartedAt={diagnosticTiming?.startedAt}
          diagnosticTokenReceivedAt={diagnosticTiming?.tokenReceivedAt}
          userName={userName}
          customerData={activeCustomerData}
        >
          <SessionWrapper
            onSessionStopped={handleSessionStopped}
            chromaKeyEnabled={chromaKeyEnabled}
            chromaSettings={chromaSettings}
          />
        </LiveAvatarContextProvider>
      )}
    </div>
  );
};

export default ClaraVoiceAgent;
