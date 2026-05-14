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
} from "@heygen/liveavatar-web-sdk";
import {
  LiveAvatarContextProvider,
  useSession,
  useLiveAvatarContext,
  WidgetState,
  CustomerData,
} from "../liveavatar";
import { useScreenSize, useFixedHeight } from "../hooks";
import { sendCustomerContext } from "../utils/heygen/elevenlabs-commands";
import { useChromaKey } from "../hooks/useChromaKey";
import type { ChromaKeyConfig } from "../hooks/useChromaKey";

// Debug (solo preview/develop)
import { MobileLogger } from "./debug/MobileLogger";

// shadcn/ui components
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import Image from "next/image";

// Lucide icons
import { Phone, PhoneOff, Mic, MicOff, Loader2, Clock } from "lucide-react";

// Toast notifications
import { toast } from "sonner";

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
        <Badge className="status-badge glass-morphism-strong bg-red-500/90 text-gray-900 border-red-400/40 hover:bg-red-500 shadow-lg">
          <MicOff className="w-3 h-3 mr-1" />
          <span className="font-medium">Silenciado</span>
        </Badge>
      );
    }

    if (isListening) {
      return (
        <Badge className="status-badge glass-morphism-strong bg-emerald-500/90 text-gray-900 border-emerald-400/40 status-pulse hover:bg-emerald-500 shadow-lg">
          <div className="voice-wave text-gray-900 mr-1">
            <span></span>
            <span></span>
            <span></span>
            <span></span>
          </div>
          <span className="font-medium">Escuchando</span>
        </Badge>
      );
    }

    if (isThinking) {
      return (
        <Badge className="status-badge glass-morphism-strong bg-amber-500/90 text-gray-900 border-amber-400/40 hover:bg-amber-500 shadow-lg">
          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          <span className="font-medium">Pensando</span>
        </Badge>
      );
    }

    if (isSpeaking) {
      return (
        <Badge className="status-badge glass-morphism-strong bg-blue-500/90 text-gray-900 border-blue-400/40 hover:bg-blue-500 shadow-lg">
          <div className="voice-wave text-gray-900 mr-1">
            <span></span>
            <span></span>
            <span></span>
            <span></span>
          </div>
          <span className="font-medium">Respondiendo</span>
        </Badge>
      );
    }

    return (
      <Badge className="status-badge badge-ios hover:bg-white/40 shadow-md">
        <div
          className={`connection-dot ${connectionQuality === ConnectionQuality.GOOD ? "good" : connectionQuality === ConnectionQuality.BAD ? "bad" : "unknown"} dot-pulse mr-1`}
        />
        <span className="font-medium text-neutral-700">Conectado</span>
      </Badge>
    );
  };

  return <div className="absolute top-4 left-4 z-10">{getStatusContent()}</div>;
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
    <Button
      onClick={onToggleMute}
      variant="ghost"
      size="icon"
      className={`floating-glass rounded-full w-12 h-12 transition-all duration-300 ${
        isMuted
          ? "bg-red-500/90 hover:bg-red-500 text-gray-900 border-red-400/40 shadow-xl"
          : "glass-morphism-dark text-gray-900 border-white/20 shadow-lg"
      }`}
      title={isMuted ? "Activar micrófono" : "Silenciar"}
    >
      {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
    </Button>
  );
};

// ============================================
// LANDING SCREEN COMPONENT (shadcn/ui redesign)
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
    <div className="flex-1 w-full flex flex-col items-center justify-center p-6 landing-gradient min-h-screen">
      <Card className="max-w-sm w-full card-ios border-0 shadow-2xl relative z-10">
        <CardHeader className="text-center pb-2">
          {/* Clara Avatar */}
          <div className="avatar-ring-ios mx-auto mb-4">
            <div className="h-20 w-20 rounded-full glass-morphism-strong flex items-center justify-center overflow-hidden p-3">
              <Image
                src="/images/clara-logo.png"
                alt="Clara Logo"
                width={80}
                height={80}
                className="w-full h-full object-contain"
              />
            </div>
          </div>

          {/* Badge */}
          <div className="badge-ios mx-auto mb-3 text-neutral-800">
            <span
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: "var(--platinum-600)" }}
            />
            Clara Skin Care Assistant
          </div>

          <CardTitle className="text-2xl font-bold text-neutral-800">
            {displayName ? `Hola, ${displayName}!` : "Hola!"}
          </CardTitle>
          <CardDescription className="text-base mt-2 text-neutral-600">
            Soy Clara, tu asistente de belleza personal. Estoy aquí para
            ayudarte a encontrar los productos perfectos para ti.
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-4">
          <Button
            onClick={onStartCall}
            disabled={isLoading || isRateLimited}
            size="lg"
            className="btn-ios-primary"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Conectando...
              </>
            ) : isRateLimited ? (
              <>
                <Clock className="w-5 h-5 mr-2" />
                Espera {rateLimitCountdown}s
              </>
            ) : (
              <>
                <Phone className="w-5 h-5 mr-2" />
                Iniciar Conversación
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

// ============================================
// CONNECTING SCREEN COMPONENT (shadcn/ui redesign)
// ============================================
const ConnectingScreen: React.FC = () => {
  return (
    <div className="flex-1 w-full flex flex-col items-center justify-center p-6 landing-gradient min-h-screen">
      <Card className="max-w-sm w-full card-ios border-0 shadow-2xl relative z-10">
        <CardContent className="pt-8 pb-8 text-center">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <Skeleton className="w-20 h-20 rounded-full glass-morphism-subtle" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2
                className="w-8 h-8 animate-spin"
                style={{ color: "var(--platinum-700)" }}
              />
            </div>
          </div>
          <h2 className="text-xl font-semibold text-neutral-800 mb-2">
            Conectando...
          </h2>
          <p className="text-neutral-600 text-sm font-medium">
            Preparando a Clara
          </p>
        </CardContent>
      </Card>
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
  chromaKeyEnabled: boolean;
  chromaSettings: ChromaSettings;
}

const ConnectedSession: React.FC<ConnectedSessionProps> = ({
  onEndCall,
  chromaKeyEnabled,
  chromaSettings,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { isDesktop } = useScreenSize();
  const { fixedHeight, isInIframe } = useFixedHeight();

  // State from context — driven by SDK events (AgentEventsEnum / VoiceChatEvent)
  const { sessionRef, customerData, isMuted, isUserTalking, isAvatarTalking } =
    useLiveAvatarContext();
  const { isStreamReady, connectionQuality, attachElement } = useSession();

  // Local state: "thinking" = between USER_SPEAK_ENDED and AVATAR_SPEAK_STARTED
  const [isThinking, setIsThinking] = useState(false);

  // Session limit
  const [sessionSecondsRemaining, setSessionSecondsRemaining] = useState(
    SESSION_LIMIT_MINUTES * 60,
  );
  const [showExpiryWarning, setShowExpiryWarning] = useState(false);
  const sessionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const keepAliveIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Track if customer context has been sent (one-time per session)
  const hasSentContextRef = useRef(false);

  // === PLUGIN INIT: contextual_update → voiceChat.start() ===
  // Deps include customerData so late-arriving Shopify data still gets sent.
  // hasSentContextRef prevents duplicate sends and duplicate voiceChat.start().
  const hasStartedVoiceChatRef = useRef(false);

  useEffect(() => {
    const session = sessionRef.current;
    if (!isStreamReady || !session) return;

    const initPlugin = async () => {
      // Step 1: Send customer context (if available, one-time)
      if (!hasSentContextRef.current && customerData) {
        hasSentContextRef.current = true;
        console.log("[PLUGIN] Sending customer context via contextual_update");
        sendCustomerContext(session, {
          firstName: customerData.firstName,
          lastName: customerData.lastName,
          email: customerData.email,
          skinType: customerData.skinType,
          skinConcerns: customerData.skinConcerns,
          ordersCount: customerData.ordersCount,
        });
        // Small delay to ensure context arrives before mic audio
        await new Promise((r) => setTimeout(r, 200));
      }

      // Step 2: Start voice chat (publishes mic to LiveKit) — once only
      if (!hasStartedVoiceChatRef.current) {
        hasStartedVoiceChatRef.current = true;
        try {
          console.log("[PLUGIN] Starting voiceChat");
          await session.voiceChat.start({ defaultMuted: false });
          console.log("[PLUGIN] VoiceChat started successfully");
        } catch (err) {
          console.error("[PLUGIN] Failed to start voiceChat:", err);
          hasStartedVoiceChatRef.current = false; // Allow retry on failure
        }
      }
    };

    initPlugin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreamReady, customerData]);

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
    } catch (err) {
      console.error("[VOICECHAT] Toggle mute failed:", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMuted]);

  // Attach video element when stream is ready
  useEffect(() => {
    if (isStreamReady && videoRef.current) {
      attachElement(videoRef.current);
    }
  }, [isStreamReady, attachElement]);

  // Keep-alive interval to prevent HeyGen session timeout
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;

    keepAliveIntervalRef.current = setInterval(
      () => {
        session
          .keepAlive()
          .then(() => console.log("[HEYGEN] Keep-alive sent"))
          .catch((error: unknown) =>
            console.warn("[HEYGEN] Keep-alive failed:", error),
          );
      },
      5 * 60 * 1000,
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
    return () => {
      session?.voiceChat.stop();
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

  return (
    <div
      className="flex-1 flex flex-col items-center justify-center relative safe-area-all w-full"
      style={containerStyle}
    >
      {/* Session expiry warning */}
      {showExpiryWarning && (
        <SessionExpiryWarning secondsRemaining={sessionSecondsRemaining} />
      )}

      {/* Main content area */}
      <div className="flex-1 flex items-center justify-center relative p-4 md:p-6 w-full">
        {/* Avatar container */}
        <div
          className={`
          relative h-full
          ${
            isDesktop
              ? "max-w-4xl w-full aspect-video"
              : "max-w-sm w-full aspect-[9/16] md:aspect-[3/4]"
          }
        `}
        >
          {/* Status indicator */}
          <StatusIndicator
            isConnected={isStreamReady}
            isListening={isUserTalking}
            isThinking={isThinking}
            isSpeaking={isAvatarTalking}
            isMuted={isMuted}
            connectionQuality={connectionQuality}
          />

          {/* Avatar video */}
          <AvatarVideo
            videoRef={videoRef}
            isStreamReady={isStreamReady}
            chromaKeyEnabled={chromaKeyEnabled}
            chromaSettings={chromaSettings}
          />

          {/* Controls overlay */}
          <div className="controls-overlay rounded-b-2xl">
            <div className="flex items-center justify-between gap-4">
              {/* Voice control */}
              <VoiceControls
                isMuted={isMuted}
                isActive={isStreamReady}
                onToggleMute={handleToggleMute}
              />

              {/* End call button */}
              <Button
                onClick={onEndCall}
                variant="destructive"
                size="lg"
                className="flex items-center gap-2 flex-1 max-w-xs justify-center floating-glass glass-morphism-strong bg-red-500/95 hover:bg-red-500 border border-red-400/40 shadow-xl transition-all duration-300 text-gray-900"
              >
                <PhoneOff className="w-5 h-5" />
                <span className="font-medium">Finalizar</span>
              </Button>

              {/* Spacer for symmetry */}
              {isStreamReady && <div className="w-11" />}
            </div>
          </div>
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
    return (
      <ConnectedSession
        onEndCall={handleEndCall}
        chromaKeyEnabled={chromaKeyEnabled}
        chromaSettings={chromaSettings}
      />
    );
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
      // Use LITE mode with ElevenLabs Plugin (HeyGen handles STT/LLM/TTS server-side)
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

      const { session_token, chroma_key_enabled, chroma_config } =
        await res.json();
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
    setSessionToken(null);
  }, []);

  const containerStyle =
    fixedHeight && isInIframe
      ? { height: `${fixedHeight}px`, overflow: "hidden" as const }
      : {};

  return (
    <div
      className="w-full h-full min-h-screen flex flex-col items-center justify-center bg-slate-50"
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

      {process.env.NODE_ENV !== "production" && (
        <MobileLogger filter="[PLUGIN]|[EL-CMD]|[VOICECHAT]|[STATE]" />
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
