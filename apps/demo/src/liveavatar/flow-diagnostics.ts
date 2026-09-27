import {
  AgentControlCommandKind,
  ElevenLabsAgentResponseKind,
  SessionDiagnosticEntry,
  SessionDiagnosticEvent,
} from "@heygen/liveavatar-web-sdk";

const MAX_FLOW_DIAGNOSTICS = 48;
const MAX_REPEATED_FLOW_EVENT = 20;

export enum ClaraFlowDiagnosticEvent {
  SESSION_START_REQUESTED = "session_start_requested",
  SESSION_TOKEN_RECEIVED = "session_token_received",
  MEDIA_PLAYING = "media_playing",
  FIRST_FRAME = "first_frame",
  USER_SPEAK_STARTED = "user_speak_started",
  USER_SPEAK_ENDED = "user_speak_ended",
  AVATAR_SPEAK_STARTED = "avatar_speak_started",
  AVATAR_SPEAK_ENDED = "avatar_speak_ended",
}

type FlowEvent = SessionDiagnosticEvent | ClaraFlowDiagnosticEvent;

export type ClaraFlowDiagnosticRecord = {
  traceId: string;
  event: FlowEvent;
  sequence: number;
  elapsedMs: number;
  sdkElapsedMs?: number;
  commandKind?: AgentControlCommandKind;
  elevenLabsResponseKind?: ElevenLabsAgentResponseKind;
};

export type ClaraFlowDiagnosticsOptions = {
  enabled: boolean;
  traceId: string | null | undefined;
  startedAt?: number;
  now?: () => number;
  log?: (record: ClaraFlowDiagnosticRecord) => void;
};

/**
 * Passive, console-only timings for a real LITE call. This observer accepts
 * only SDK lifecycle enums and local milestone enums; it never receives text,
 * tokens, provider identifiers, or error objects.
 */
export class ClaraFlowDiagnostics {
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly seen = new Map<string, number>();
  private disposed = false;
  private suspended = false;
  private sequence = 0;
  private total = 0;

  constructor(private readonly options: ClaraFlowDiagnosticsOptions) {
    this.now = options.now ?? monotonicNow;
    const candidate = options.startedAt;
    this.startedAt = Number.isFinite(candidate) ? candidate! : this.now();
  }

  public mark(event: ClaraFlowDiagnosticEvent, at?: number): void {
    if (!isFlowDiagnosticEvent(event)) return;
    this.record({ event, at });
  }

  /** Records actual SDK speech notifications without retaining their payloads. */
  public observeAgentEvent(event: ClaraFlowDiagnosticEvent): void {
    if (!isAgentFlowEvent(event)) return;
    this.record({ event });
  }

  public observeSdk(entry: SessionDiagnosticEntry): void {
    if (!isSessionDiagnosticEvent(entry.event)) return;
    this.record({
      event: entry.event,
      sdkElapsedMs: entry.elapsedMs,
      commandKind: entry.commandKind,
      elevenLabsResponseKind: entry.elevenLabsResponseKind,
    });
    if (isTerminalEvent(entry.event)) this.dispose();
  }

  public dispose(): void {
    this.disposed = true;
  }

  public suspend(): void {
    if (!this.disposed) this.suspended = true;
  }

  public resume(): void {
    if (!this.disposed) this.suspended = false;
  }

  private record(input: {
    event: FlowEvent;
    at?: number;
    sdkElapsedMs?: unknown;
    commandKind?: unknown;
    elevenLabsResponseKind?: unknown;
  }): void {
    if (
      !this.options.enabled ||
      this.disposed ||
      this.suspended ||
      !isTraceId(this.options.traceId)
    )
      return;
    const key = [
      input.event,
      isCommandKind(input.commandKind) ? input.commandKind : "",
      isResponseKind(input.elevenLabsResponseKind)
        ? input.elevenLabsResponseKind
        : "",
    ].join(":");
    const occurrences = this.seen.get(key) ?? 0;
    const terminal =
      isSessionDiagnosticEvent(input.event) && isTerminalEvent(input.event);
    if (
      (!terminal && this.total >= MAX_FLOW_DIAGNOSTICS) ||
      occurrences >= MAX_REPEATED_FLOW_EVENT
    ) {
      return;
    }
    this.seen.set(key, occurrences + 1);
    this.total += 1;
    const timestamp = Number.isFinite(input.at) ? input.at! : this.now();
    const record: ClaraFlowDiagnosticRecord = {
      traceId: this.options.traceId,
      event: input.event,
      sequence: ++this.sequence,
      elapsedMs: Math.max(0, timestamp - this.startedAt),
      ...(Number.isFinite(input.sdkElapsedMs)
        ? { sdkElapsedMs: Math.max(0, Number(input.sdkElapsedMs)) }
        : {}),
      ...(isCommandKind(input.commandKind)
        ? { commandKind: input.commandKind }
        : {}),
      ...(isResponseKind(input.elevenLabsResponseKind)
        ? { elevenLabsResponseKind: input.elevenLabsResponseKind }
        : {}),
    };
    try {
      this.options.log?.(record);
    } catch {
      // Diagnostics must never affect a live call.
    }
  }
}

export function logClaraFlowDiagnostic(
  record: ClaraFlowDiagnosticRecord,
): void {
  console.info(`[CLARA_FLOW] ${JSON.stringify(record)}`);
}

function monotonicNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function isTraceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
  );
}

function isSessionDiagnosticEvent(
  value: unknown,
): value is SessionDiagnosticEvent {
  return Object.values(SessionDiagnosticEvent).includes(
    value as SessionDiagnosticEvent,
  );
}

function isFlowDiagnosticEvent(
  value: unknown,
): value is ClaraFlowDiagnosticEvent {
  return Object.values(ClaraFlowDiagnosticEvent).includes(
    value as ClaraFlowDiagnosticEvent,
  );
}

function isAgentFlowEvent(value: ClaraFlowDiagnosticEvent): boolean {
  return (
    value === ClaraFlowDiagnosticEvent.USER_SPEAK_STARTED ||
    value === ClaraFlowDiagnosticEvent.USER_SPEAK_ENDED ||
    value === ClaraFlowDiagnosticEvent.AVATAR_SPEAK_STARTED ||
    value === ClaraFlowDiagnosticEvent.AVATAR_SPEAK_ENDED
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

function isTerminalEvent(event: SessionDiagnosticEvent): boolean {
  return (
    event === SessionDiagnosticEvent.SESSION_STOPPED ||
    event === SessionDiagnosticEvent.ROOM_DISCONNECTED ||
    event === SessionDiagnosticEvent.SESSION_ENDED
  );
}
