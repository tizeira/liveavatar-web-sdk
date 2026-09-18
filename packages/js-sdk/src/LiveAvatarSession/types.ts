import { VoiceChatConfig } from "../VoiceChat";

export enum SessionMode {
  FULL = "FULL",
  LITE = "LITE",
}

export enum AgentType {
  FULL = "FULL",
  OPENAI_REALTIME = "OPENAI_REALTIME",
  ELEVENLABS_AGENT = "ELEVENLABS_AGENT",
  GEMINI_REALTIME = "GEMINI_REALTIME",
  UNKNOWN = "UNKNOWN",
}

export enum SessionState {
  INACTIVE = "INACTIVE",
  CONNECTING = "CONNECTING",
  CONNECTED = "CONNECTED",
  DISCONNECTING = "DISCONNECTING",
  DISCONNECTED = "DISCONNECTED",
}

export enum SessionDisconnectReason {
  UNKNOWN_REASON = "UNKNOWN_REASON",
  CLIENT_INITIATED = "CLIENT_INITIATED",
  SESSION_START_FAILED = "SESSION_START_FAILED",
  SERVER_INITIATED = "SERVER_INITIATED",
}

/**
 * Opt-in, payload-free lifecycle signals for diagnosing session startup.
 * These signals describe transport activity only. They deliberately exclude
 * tokens, identifiers, transcript text, command payloads, and error details.
 */
export enum SessionDiagnosticEvent {
  ROOM_CONNECTED = "room_connected",
  AGENT_CONTROL_PUBLISH_ATTEMPTED = "agent_control_publish_attempted",
  AGENT_CONTROL_PUBLISH_SETTLED = "agent_control_publish_settled",
  AGENT_CONTROL_PUBLISH_REJECTED = "agent_control_publish_rejected",
  ELEVENLABS_AGENT_EVENT_RECEIVED = "elevenlabs_agent_event_received",
  AVATAR_SPEAK_STARTED = "avatar_speak_started",
  AVATAR_SPEAK_ENDED = "avatar_speak_ended",
  SESSION_STOPPED = "session_stopped",
  ROOM_DISCONNECTED = "room_disconnected",
  SESSION_ENDED = "session_ended",
}

export enum AgentControlCommandKind {
  CONTEXTUAL_UPDATE = "contextual_update",
  USER_MESSAGE = "user_message",
  OTHER = "other",
}

export enum ElevenLabsAgentResponseKind {
  CONVERSATION_INITIATION_METADATA = "conversation_initiation_metadata",
  CONTEXTUAL_UPDATE = "contextual_update",
  AGENT_RESPONSE = "agent_response",
  OTHER = "other",
}

export type SessionDiagnosticEntry = {
  event: SessionDiagnosticEvent;
  elapsedMs: number;
  commandKind?: AgentControlCommandKind;
  elevenLabsResponseKind?: ElevenLabsAgentResponseKind;
};

export interface SessionConfig {
  voiceChat?: VoiceChatConfig | boolean;
  apiUrl?: string;
  /**
   * Optional passive observer. Exceptions from this callback are ignored so
   * diagnostics can never affect a live session.
   */
  onDiagnosticEvent?: (entry: SessionDiagnosticEntry) => void;
}

export interface SessionInfo {
  session_id: string;
  max_session_duration: number | null;
  // For FULL mode will always be present
  // For LITE mode, may be null
  livekit_url?: string;
  livekit_client_token?: string;
  // For LITE mode with WebSocket support
  ws_url?: string;
}

export enum Language {
  af = "af",
  sq = "sq",
  am = "am",
  ar = "ar",
  hy = "hy",
  as = "as",
  ast = "ast",
  az = "az",
  ba = "ba",
  eu = "eu",
  be = "be",
  bn = "bn",
  bs = "bs",
  br = "br",
  bg = "bg",
  my = "my",
  ca = "ca",
  ceb = "ceb",
  zh = "zh",
  hr = "hr",
  cs = "cs",
  da = "da",
  nl = "nl",
  en = "en",
  et = "et",
  fo = "fo",
  fi = "fi",
  fr = "fr",
  fy = "fy",
  ff = "ff",
  gd = "gd",
  gl = "gl",
  lg = "lg",
  ka = "ka",
  de = "de",
  el = "el",
  gu = "gu",
  ht = "ht",
  ha = "ha",
  haw = "haw",
  he = "he",
  hi = "hi",
  hu = "hu",
  is = "is",
  ig = "ig",
  ilo = "ilo",
  id = "id",
  ga = "ga",
  it = "it",
  ja = "ja",
  jv = "jv",
  kn = "kn",
  kk = "kk",
  km = "km",
  ko = "ko",
  lo = "lo",
  la = "la",
  lv = "lv",
  lb = "lb",
  ln = "ln",
  lt = "lt",
  mk = "mk",
  mg = "mg",
  ms = "ms",
  ml = "ml",
  mt = "mt",
  mi = "mi",
  mr = "mr",
  mo = "mo",
  mn = "mn",
  ne = "ne",
  no = "no",
  nn = "nn",
  oc = "oc",
  or = "or",
  pa = "pa",
  ps = "ps",
  fa = "fa",
  pl = "pl",
  pt = "pt",
  ro = "ro",
  ru = "ru",
  sa = "sa",
  sr = "sr",
  sn = "sn",
  sd = "sd",
  si = "si",
  sk = "sk",
  sl = "sl",
  so = "so",
  es = "es",
  su = "su",
  sw = "sw",
  ss = "ss",
  sv = "sv",
  tl = "tl",
  tg = "tg",
  ta = "ta",
  tt = "tt",
  te = "te",
  th = "th",
  bo = "bo",
  tn = "tn",
  tr = "tr",
  tk = "tk",
  uk = "uk",
  ur = "ur",
  uz = "uz",
  vi = "vi",
  cy = "cy",
  wo = "wo",
  xh = "xh",
  yi = "yi",
  yo = "yo",
  zu = "zu",
}
