import {
  AgentControlCommandKind,
  ElevenLabsAgentResponseKind,
  SessionDiagnosticEntry,
  SessionDiagnosticEvent,
} from "@heygen/liveavatar-web-sdk";
import { VoiceChatState } from "@heygen/liveavatar-web-sdk";

export const STARTUP_METADATA_TIMEOUT_MS = 8_000;
export const STARTUP_GREETING_TIMEOUT_MS = 15_000;
const MAX_STARTUP_DIAGNOSTICS = 32;

export enum ClaraStartupDiagnosticEvent {
  METADATA_MISSING_TIMEOUT = "metadata_missing_timeout",
  GREETING_MISSING_TIMEOUT = "greeting_missing_timeout",
}

type StartupEvent = SessionDiagnosticEvent | ClaraStartupDiagnosticEvent;

type VoiceChatSnapshot = {
  state: VoiceChatState;
  muted: boolean;
};

export type ClaraStartupDiagnosticRecord = {
  event: StartupEvent;
  sequence: number;
  elapsedMs: number;
  commandKind?: AgentControlCommandKind;
  elevenLabsResponseKind?: ElevenLabsAgentResponseKind;
  voiceChatState?: VoiceChatState;
  muted?: boolean;
};

type TimerHandle = ReturnType<typeof setTimeout>;

export type ClaraStartupDiagnosticsOptions = {
  enabled: boolean;
  readVoiceChat?: () => VoiceChatSnapshot | null;
  log?: (record: ClaraStartupDiagnosticRecord) => void;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
};

/**
 * A console-only, privacy-safe observer for the first connector milestones.
 * It never waits, retries, changes microphone state, or treats a local publish
 * settlement as a connector acknowledgement.
 */
export class ClaraStartupDiagnostics {
  private readonly now: () => number;
  private readonly setTimer: (
    callback: () => void,
    delayMs: number,
  ) => TimerHandle;
  private readonly clearTimer: (timer: TimerHandle) => void;
  private readonly startedAt: number;
  private readonly seen = new Set<string>();
  private metadataTimer: TimerHandle | null = null;
  private greetingTimer: TimerHandle | null = null;
  private active = false;
  private disposed = false;
  private suspended = false;
  private seenMetadata = false;
  private seenGreeting = false;
  private roomConnected = false;
  private userMessageAttempted = false;
  private sequence = 0;

  constructor(private readonly options: ClaraStartupDiagnosticsOptions) {
    this.now = options.now ?? Date.now;
    this.setTimer =
      options.setTimer ??
      ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
    this.startedAt = this.now();
  }

  public observe(entry: SessionDiagnosticEntry): void {
    if (!this.options.enabled || this.disposed || this.suspended) return;

    this.record(entry);

    if (entry.event === SessionDiagnosticEvent.ROOM_CONNECTED) {
      this.roomConnected = true;
      this.startMetadataTimeout();
      return;
    }

    if (
      entry.event === SessionDiagnosticEvent.ELEVENLABS_AGENT_EVENT_RECEIVED &&
      entry.elevenLabsResponseKind ===
        ElevenLabsAgentResponseKind.CONVERSATION_INITIATION_METADATA
    ) {
      this.seenMetadata = true;
      this.clearMetadataTimeout();
      return;
    }

    if (entry.event === SessionDiagnosticEvent.AVATAR_SPEAK_STARTED) {
      this.seenGreeting = true;
      this.clearGreetingTimeout();
      return;
    }

    if (
      entry.event === SessionDiagnosticEvent.AGENT_CONTROL_PUBLISH_ATTEMPTED &&
      entry.commandKind === AgentControlCommandKind.USER_MESSAGE
    ) {
      this.userMessageAttempted = true;
      this.startGreetingTimeout();
      return;
    }

    if (
      entry.event === SessionDiagnosticEvent.SESSION_STOPPED ||
      entry.event === SessionDiagnosticEvent.ROOM_DISCONNECTED ||
      entry.event === SessionDiagnosticEvent.SESSION_ENDED
    ) {
      this.dispose();
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.active = false;
    this.clearMetadataTimeout();
    this.clearGreetingTimeout();
  }

  /** Pause during a React development effect replay without retaining timers. */
  public suspend(): void {
    if (this.disposed) return;
    this.suspended = true;
    this.active = false;
    this.clearMetadataTimeout();
    this.clearGreetingTimeout();
  }

  /** Resume an observer that survived React's development effect replay. */
  public resume(): void {
    if (this.disposed || !this.options.enabled) return;
    this.suspended = false;
    if (this.roomConnected) this.startMetadataTimeout();
    if (this.userMessageAttempted) this.startGreetingTimeout();
  }

  private startMetadataTimeout(): void {
    if (this.seenMetadata || this.metadataTimer !== null) return;
    this.active = true;
    this.metadataTimer = this.setTimer(() => {
      if (!this.active || this.disposed || this.seenMetadata) return;
      this.record({
        event: ClaraStartupDiagnosticEvent.METADATA_MISSING_TIMEOUT,
        elapsedMs: this.elapsedMs(),
      });
    }, STARTUP_METADATA_TIMEOUT_MS);
  }

  private startGreetingTimeout(): void {
    if (this.seenGreeting || this.greetingTimer !== null) return;
    this.active = true;
    this.greetingTimer = this.setTimer(() => {
      if (!this.active || this.disposed || this.seenGreeting) return;
      this.record({
        event: ClaraStartupDiagnosticEvent.GREETING_MISSING_TIMEOUT,
        elapsedMs: this.elapsedMs(),
      });
    }, STARTUP_GREETING_TIMEOUT_MS);
  }

  private clearMetadataTimeout(): void {
    if (this.metadataTimer !== null) {
      this.clearTimer(this.metadataTimer);
      this.metadataTimer = null;
    }
  }

  private clearGreetingTimeout(): void {
    if (this.greetingTimer !== null) {
      this.clearTimer(this.greetingTimer);
      this.greetingTimer = null;
    }
  }

  private elapsedMs(): number {
    return Math.max(0, this.now() - this.startedAt);
  }

  private record(record: Omit<ClaraStartupDiagnosticRecord, "sequence">): void {
    if (this.disposed || this.suspended || !isStartupEvent(record.event))
      return;
    const event = record.event;
    const key = [
      event,
      isCommandKind(record.commandKind) ? record.commandKind : "",
      isResponseKind(record.elevenLabsResponseKind)
        ? record.elevenLabsResponseKind
        : "",
    ].join(":");
    const terminal =
      event === SessionDiagnosticEvent.SESSION_STOPPED ||
      event === SessionDiagnosticEvent.ROOM_DISCONNECTED ||
      event === SessionDiagnosticEvent.SESSION_ENDED;
    if (
      (this.seen.size >= MAX_STARTUP_DIAGNOSTICS && !terminal) ||
      this.seen.has(key)
    ) {
      return;
    }
    this.seen.add(key);

    let voiceChat: VoiceChatSnapshot | null = null;
    try {
      voiceChat = this.options.readVoiceChat?.() ?? null;
    } catch {
      // A diagnostic snapshot must never disrupt the session or a timer.
    }
    const safeRecord: ClaraStartupDiagnosticRecord = {
      event,
      sequence: ++this.sequence,
      elapsedMs: Number.isFinite(record.elapsedMs)
        ? Math.max(0, record.elapsedMs)
        : this.elapsedMs(),
      ...(isCommandKind(record.commandKind)
        ? { commandKind: record.commandKind }
        : {}),
      ...(isResponseKind(record.elevenLabsResponseKind)
        ? { elevenLabsResponseKind: record.elevenLabsResponseKind }
        : {}),
      ...(voiceChat
        ? {
            ...(isVoiceChatState(voiceChat.state)
              ? { voiceChatState: voiceChat.state }
              : {}),
            ...(typeof voiceChat.muted === "boolean"
              ? { muted: voiceChat.muted }
              : {}),
          }
        : {}),
    };
    try {
      this.options.log?.(safeRecord);
    } catch {
      // Console/reporting failures are intentionally ignored.
    }
  }
}

export function logClaraStartupDiagnostic(
  record: ClaraStartupDiagnosticRecord,
): void {
  console.info(`[CLARA_STARTUP] ${JSON.stringify(record)}`);
}

export function shouldEnableClaraStartupDiagnostics(input?: {
  nodeEnv?: string;
  hostname?: string;
  vercelEnv?: string;
}): boolean {
  const nodeEnv = input?.nodeEnv ?? process.env.NODE_ENV;
  const vercelEnv = input?.vercelEnv ?? process.env.NEXT_PUBLIC_VERCEL_ENV;
  const hostname =
    input?.hostname ??
    (typeof window === "undefined" ? "" : window.location.hostname);
  if (vercelEnv === "production") return false;
  return (
    vercelEnv === "preview" ||
    nodeEnv !== "production" ||
    hostname === "testers.betaskintech.com"
  );
}

function isStartupEvent(value: unknown): value is StartupEvent {
  return (
    Object.values(SessionDiagnosticEvent).includes(
      value as SessionDiagnosticEvent,
    ) ||
    Object.values(ClaraStartupDiagnosticEvent).includes(
      value as ClaraStartupDiagnosticEvent,
    )
  );
}

function isCommandKind(value: unknown): value is AgentControlCommandKind {
  return Object.values(AgentControlCommandKind).includes(
    value as AgentControlCommandKind,
  );
}

function isResponseKind(value: unknown): value is ElevenLabsAgentResponseKind {
  return Object.values(ElevenLabsAgentResponseKind).includes(
    value as ElevenLabsAgentResponseKind,
  );
}

function isVoiceChatState(value: unknown): value is VoiceChatState {
  return Object.values(VoiceChatState).includes(value as VoiceChatState);
}
