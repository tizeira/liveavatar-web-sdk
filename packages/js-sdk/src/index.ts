// classes
export { LiveAvatarSession } from "./LiveAvatarSession";
export {
  ElevenLabsAgentSession,
  ElevenLabsAgentSessionError,
} from "./LiveAvatarSession";
export { parseAgentTypeFromToken } from "./LiveAvatarSession";

// types
export type {
  SessionConfig,
  SessionInfo,
  SessionApiError,
} from "./LiveAvatarSession";
export type { VoiceChat, VoiceChatConfig } from "./VoiceChat";

// enums
export { ConnectionQuality } from "./QualityIndicator";
export {
  SessionEvent,
  SessionState,
  SessionMode,
  AgentType,
  AgentControlCommandKind,
  ElevenLabsAgentResponseKind,
  Language,
  SessionDisconnectReason,
  SessionDiagnosticEvent,
  AgentEventsEnum,
  AgentEvent,
  CommandEventsEnum,
  ElevenLabsAgentCommandType,
} from "./LiveAvatarSession";
export type {
  ElevenLabsAgentEventPayload,
  ElevenLabsAgentCommandPayload,
  ElevenLabsAgentCommandEvent,
  SessionDiagnosticEntry,
} from "./LiveAvatarSession";
export {
  VoiceChatState,
  VoiceChatEvent,
  SessionInteractivityMode,
} from "./VoiceChat";
