import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ConnectionQuality,
  ElevenLabsAgentSession,
  SessionState,
  SessionEvent,
  VoiceChatEvent,
  VoiceChatState,
  AgentEventsEnum,
} from "@heygen/liveavatar-web-sdk";
import { LiveAvatarSessionMessage, CustomerData, WidgetState } from "./types";
import { API_URL } from "../../app/api/secrets";
import {
  ClaraStartupDiagnostics,
  logClaraStartupDiagnostic,
  shouldEnableClaraStartupDiagnostics,
} from "./startup-diagnostics";
import {
  ClaraFlowDiagnosticEvent,
  ClaraFlowDiagnostics,
  logClaraFlowDiagnostic,
} from "./flow-diagnostics";

type LiveAvatarContextProps = {
  sessionRef: React.RefObject<ElevenLabsAgentSession>;

  isMuted: boolean;
  voiceChatState: VoiceChatState;

  sessionState: SessionState;
  widgetState: WidgetState;
  isStreamReady: boolean;
  connectionQuality: ConnectionQuality;

  isUserTalking: boolean;
  isAvatarTalking: boolean;

  messages: LiveAvatarSessionMessage[];

  // Personalization
  userName: string | null;
  customerData: CustomerData | null;
  flowDiagnostics: ClaraFlowDiagnostics | null;
};

export const LiveAvatarContext = createContext<LiveAvatarContextProps>({
  sessionRef: {
    current: null,
  } as unknown as React.RefObject<ElevenLabsAgentSession>,
  connectionQuality: ConnectionQuality.UNKNOWN,
  isMuted: true,
  voiceChatState: VoiceChatState.INACTIVE,
  sessionState: SessionState.DISCONNECTED,
  widgetState: WidgetState.INACTIVE,
  isStreamReady: false,
  isUserTalking: false,
  isAvatarTalking: false,
  messages: [],
  userName: null,
  customerData: null,
  flowDiagnostics: null,
});

type LiveAvatarContextProviderProps = {
  children: React.ReactNode;
  sessionAccessToken: string;
  userName?: string | null;
  customerData?: CustomerData | null;
  /** Opaque preview-only correlation id returned by session startup. */
  diagnosticTraceId?: string | null;
  /** Monotonic client ticks captured around the actual startup request. */
  diagnosticStartedAt?: number;
  diagnosticTokenReceivedAt?: number;
};

const useSessionState = (
  sessionRef: React.RefObject<ElevenLabsAgentSession>,
) => {
  const [sessionState, setSessionState] = useState<SessionState>(
    sessionRef.current?.state || SessionState.INACTIVE,
  );
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality>(
    sessionRef.current?.connectionQuality || ConnectionQuality.UNKNOWN,
  );
  const [isStreamReady, setIsStreamReady] = useState<boolean>(false);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;

    // Named handlers for proper cleanup
    const handleStateChange = (state: SessionState) => {
      setSessionState(state);
      if (state === SessionState.DISCONNECTED) {
        session.removeAllListeners();
        session.voiceChat.removeAllListeners();
        setIsStreamReady(false);
      }
    };

    const handleStreamReady = () => setIsStreamReady(true);

    session.on(SessionEvent.SESSION_STATE_CHANGED, handleStateChange);
    session.on(SessionEvent.SESSION_STREAM_READY, handleStreamReady);
    session.on(
      SessionEvent.SESSION_CONNECTION_QUALITY_CHANGED,
      setConnectionQuality,
    );

    // Cleanup: remove listeners on unmount
    return () => {
      session.off(SessionEvent.SESSION_STATE_CHANGED, handleStateChange);
      session.off(SessionEvent.SESSION_STREAM_READY, handleStreamReady);
      session.off(
        SessionEvent.SESSION_CONNECTION_QUALITY_CHANGED,
        setConnectionQuality,
      );
    };
  }, [sessionRef]);

  return { sessionState, isStreamReady, connectionQuality };
};

const useVoiceChatState = (
  sessionRef: React.RefObject<ElevenLabsAgentSession>,
) => {
  const [isMuted, setIsMuted] = useState(true);
  const [voiceChatState, setVoiceChatState] = useState<VoiceChatState>(
    sessionRef.current?.voiceChat.state || VoiceChatState.INACTIVE,
  );

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;

    // Named handlers for proper cleanup
    const handleMuted = () => setIsMuted(true);
    const handleUnmuted = () => setIsMuted(false);

    session.voiceChat.on(VoiceChatEvent.MUTED, handleMuted);
    session.voiceChat.on(VoiceChatEvent.UNMUTED, handleUnmuted);
    session.voiceChat.on(VoiceChatEvent.STATE_CHANGED, setVoiceChatState);

    // Cleanup: remove listeners on unmount
    return () => {
      session.voiceChat.off(VoiceChatEvent.MUTED, handleMuted);
      session.voiceChat.off(VoiceChatEvent.UNMUTED, handleUnmuted);
      session.voiceChat.off(VoiceChatEvent.STATE_CHANGED, setVoiceChatState);
    };
  }, [sessionRef]);

  return { isMuted, voiceChatState };
};

const useTalkingState = (
  sessionRef: React.RefObject<ElevenLabsAgentSession>,
  flowDiagnosticsRef: React.RefObject<ClaraFlowDiagnostics | null>,
) => {
  const [isUserTalking, setIsUserTalking] = useState(false);
  const [isAvatarTalking, setIsAvatarTalking] = useState(false);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;

    // Named handlers for proper cleanup
    const handleUserStart = () => {
      setIsUserTalking(true);
      flowDiagnosticsRef.current?.observeAgentEvent(
        ClaraFlowDiagnosticEvent.USER_SPEAK_STARTED,
      );
    };
    const handleUserEnd = () => {
      setIsUserTalking(false);
      flowDiagnosticsRef.current?.observeAgentEvent(
        ClaraFlowDiagnosticEvent.USER_SPEAK_ENDED,
      );
    };
    const handleAvatarStart = () => {
      setIsAvatarTalking(true);
      flowDiagnosticsRef.current?.observeAgentEvent(
        ClaraFlowDiagnosticEvent.AVATAR_SPEAK_STARTED,
      );
    };
    const handleAvatarEnd = () => {
      setIsAvatarTalking(false);
      flowDiagnosticsRef.current?.observeAgentEvent(
        ClaraFlowDiagnosticEvent.AVATAR_SPEAK_ENDED,
      );
    };

    session.on(AgentEventsEnum.USER_SPEAK_STARTED, handleUserStart);
    session.on(AgentEventsEnum.USER_SPEAK_ENDED, handleUserEnd);
    session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, handleAvatarStart);
    session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, handleAvatarEnd);

    // Cleanup: remove listeners on unmount
    return () => {
      session.off(AgentEventsEnum.USER_SPEAK_STARTED, handleUserStart);
      session.off(AgentEventsEnum.USER_SPEAK_ENDED, handleUserEnd);
      session.off(AgentEventsEnum.AVATAR_SPEAK_STARTED, handleAvatarStart);
      session.off(AgentEventsEnum.AVATAR_SPEAK_ENDED, handleAvatarEnd);
    };
  }, [sessionRef, flowDiagnosticsRef]);

  return { isUserTalking, isAvatarTalking };
};

/**
 * Derive widget state from session state
 */
const useWidgetState = (
  sessionState: SessionState,
  isStreamReady: boolean,
): WidgetState => {
  return useMemo(() => {
    if (
      sessionState === SessionState.DISCONNECTED ||
      sessionState === SessionState.INACTIVE
    ) {
      return WidgetState.INACTIVE;
    }
    if (sessionState === SessionState.CONNECTING || !isStreamReady) {
      return WidgetState.CONNECTING;
    }
    if (sessionState === SessionState.CONNECTED && isStreamReady) {
      return WidgetState.CONNECTED;
    }
    return WidgetState.INACTIVE;
  }, [sessionState, isStreamReady]);
};

export const LiveAvatarContextProvider = ({
  children,
  sessionAccessToken,
  userName = null,
  customerData = null,
  diagnosticTraceId = null,
  diagnosticStartedAt,
  diagnosticTokenReceivedAt,
}: LiveAvatarContextProviderProps) => {
  // Keep construction side-effect free during render. The diagnostic callback is
  // registered before a child can call session.start(), but starts no timers
  // until the SDK reports a real LiveKit connection.
  const sessionRef = useRef<ElevenLabsAgentSession>(null!);
  const startupDiagnosticsRef = useRef<ClaraStartupDiagnostics | null>(null);
  const startupDisposeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const flowDiagnosticsRef = useRef<ClaraFlowDiagnostics | null>(null);
  const flowMilestonesReportedRef = useRef(false);
  if (!flowDiagnosticsRef.current && diagnosticTraceId) {
    const flow = new ClaraFlowDiagnostics({
      enabled: shouldEnableClaraStartupDiagnostics(),
      traceId: diagnosticTraceId,
      startedAt: diagnosticStartedAt,
      log: logClaraFlowDiagnostic,
    });
    flowDiagnosticsRef.current = flow;
  }
  if (!startupDiagnosticsRef.current) {
    startupDiagnosticsRef.current = new ClaraStartupDiagnostics({
      enabled: shouldEnableClaraStartupDiagnostics(),
      readVoiceChat: () => {
        const session = sessionRef.current;
        return session
          ? { state: session.voiceChat.state, muted: session.voiceChat.isMuted }
          : null;
      },
      log: logClaraStartupDiagnostic,
    });
  }
  if (!sessionRef.current) {
    sessionRef.current = new ElevenLabsAgentSession(sessionAccessToken, {
      voiceChat: true,
      apiUrl: API_URL,
      onDiagnosticEvent: (entry) => {
        startupDiagnosticsRef.current?.observe(entry);
        flowDiagnosticsRef.current?.observeSdk(entry);
      },
    });
  }

  useEffect(() => {
    if (startupDisposeTimerRef.current !== null) {
      clearTimeout(startupDisposeTimerRef.current);
      startupDisposeTimerRef.current = null;
    }
    startupDiagnosticsRef.current?.resume();
    flowDiagnosticsRef.current?.resume();
    if (flowDiagnosticsRef.current && !flowMilestonesReportedRef.current) {
      flowMilestonesReportedRef.current = true;
      if (Number.isFinite(diagnosticStartedAt)) {
        flowDiagnosticsRef.current.mark(
          ClaraFlowDiagnosticEvent.SESSION_START_REQUESTED,
          diagnosticStartedAt,
        );
      }
      if (Number.isFinite(diagnosticTokenReceivedAt)) {
        flowDiagnosticsRef.current.mark(
          ClaraFlowDiagnosticEvent.SESSION_TOKEN_RECEIVED,
          diagnosticTokenReceivedAt,
        );
      }
    }

    return () => {
      // Strict Mode replays effects once in development. Pause immediately so
      // late promises cannot log, then permit the paired setup to resume.
      startupDiagnosticsRef.current?.suspend();
      flowDiagnosticsRef.current?.suspend();
      startupDisposeTimerRef.current = setTimeout(() => {
        startupDiagnosticsRef.current?.dispose();
        flowDiagnosticsRef.current?.dispose();
        startupDisposeTimerRef.current = null;
      }, 0);
    };
  }, [diagnosticStartedAt, diagnosticTokenReceivedAt]);

  const { sessionState, isStreamReady, connectionQuality } =
    useSessionState(sessionRef);

  const { isMuted, voiceChatState } = useVoiceChatState(sessionRef);
  const { isUserTalking, isAvatarTalking } = useTalkingState(
    sessionRef,
    flowDiagnosticsRef,
  );
  const widgetState = useWidgetState(sessionState, isStreamReady);

  return (
    <LiveAvatarContext.Provider
      value={{
        sessionRef,
        sessionState,
        widgetState,
        isStreamReady,
        connectionQuality,
        isMuted,
        voiceChatState,
        isUserTalking,
        isAvatarTalking,
        messages: [], // TODO - properly implement chat history
        userName,
        customerData,
        flowDiagnostics: flowDiagnosticsRef.current,
      }}
    >
      {children}
    </LiveAvatarContext.Provider>
  );
};

export const useLiveAvatarContext = () => {
  return useContext(LiveAvatarContext);
};
