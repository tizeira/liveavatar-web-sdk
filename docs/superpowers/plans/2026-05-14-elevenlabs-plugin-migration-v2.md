# ElevenLabs Plugin Migration — Implementation Plan v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ~500 lines of manual audio piping with HeyGen's native ElevenLabs Plugin + `contextual_update` for customer personalization, so HeyGen handles STT+LLM+TTS server-side while Clara keeps knowing who each customer is.

**Architecture:**

```
BEFORE (manual):
  Mic (44.1kHz) → WebAudio → resample 16kHz → ElevenLabs WS → TTS chunks
  → buffer → gap detect → resample 24kHz → silence pad → repeatAudio() → HeyGen

AFTER (plugin + contextual_update):
  Session starts → contextual_update (customer data) → voiceChat.start()
  Mic → LiveKit → HeyGen server → ElevenLabs (STT+LLM+TTS) → lip-sync
  Events ← LiveKit data channel ← vad_score, transcripts, interruptions
```

**Tech Stack:** Next.js 15 App Router, `@heygen/liveavatar-web-sdk` v0.0.18, HeyGen LiveAvatar API v1, ElevenLabs Conversational AI (server-side), LiveKit data channels, Vercel

**Key documentation consulted:**

- [HeyGen LiveAvatar SDK](https://context7.com/heygen-com/liveavatar-web-sdk) — voiceChat API, AgentEventsEnum, session lifecycle
- [HeyGen ElevenLabs Agent Plugin](https://docs.liveavatar.com/docs/lite-mode/connectors/elevenlabs-agent) — `elevenlabs_agent_command`, passthrough events, whitelisted commands
- [ElevenLabs Conversational AI](https://elevenlabs.io/docs/eleven-agents/customization/events/client-to-server-events) — `contextual_update` format, `dynamic_variables` vs contextual

---

## File Map

| File                                              | Change                                                              | Why                                              |
| ------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
| `packages/js-sdk/package.json`                    | Update SDK: v0.0.9 → v0.0.18                                        | Newer events, bug fixes                          |
| `apps/demo/app/api/secrets.ts`                    | Add `HEYGEN_ELEVENLABS_SECRET_ID`                                   | Plugin requires stored secret                    |
| `apps/demo/app/api/start-custom-session/route.ts` | `mode: "LITE"` + `elevenlabs_agent_config`                          | Switch to plugin mode                            |
| `apps/demo/src/lib/heygen/elevenlabs-commands.ts` | **NEW** — helper to send `elevenlabs_agent_command` via LiveKit     | Encapsulate `(session as any).room` escape hatch |
| `apps/demo/src/components/ClaraVoiceAgent.tsx`    | Remove ~500 lines audio pipeline; add voiceChat + contextual_update | Core migration                                   |
| `apps/demo/.env.local`                            | Add `HEYGEN_ELEVENLABS_SECRET_ID`                                   | Plugin config                                    |

Files that become UNUSED (keep for rollback, delete in separate PR later):

- `apps/demo/src/hooks/useElevenLabsAgent.ts` (946 lines)
- `apps/demo/app/api/elevenlabs-conversation/route.ts`

---

## Critical best practices (from docs)

### HeyGen LiveAvatar SDK

1. **VoiceChat init:** Call `session.voiceChat.start({ defaultMuted: false })` AFTER `SESSION_STREAM_READY`. The SDK creates a `LocalAudioTrack` with echo cancellation, noise suppression, and auto gain control. Calling before connected throws.
2. **Events:** Use `AgentEventsEnum.USER_SPEAK_STARTED/ENDED` and `AVATAR_SPEAK_STARTED/ENDED` for state. Use `USER_TRANSCRIPTION` and `AVATAR_TRANSCRIPTION` for text.
3. **Mute:** `session.voiceChat.mute()` / `unmute()` are async. The context already listens for `VoiceChatEvent.MUTED/UNMUTED`.
4. **Interrupt:** `session.interrupt()` sends `avatar.interrupt` on the `agent-control` LiveKit topic. Works in both FULL and LITE+plugin modes.
5. **Keep-alive:** `session.keepAlive()` — send every 5 minutes. Session auto-terminates after 5min inactivity.
6. **Attach:** `session.attach(videoElement)` after `SESSION_STREAM_READY` — attaches both video and audio tracks.

### ElevenLabs Plugin (HeyGen)

1. **Data channel topics:** Send commands on `agent-control`, receive events on `agent-response`.
2. **Command format:** `{ event_type: "elevenlabs_agent_command", elevenlabs_event_type: "<type>", data: { ... } }`. Do NOT include `type` in `data` — the wrapper's `elevenlabs_event_type` is authoritative.
3. **Whitelisted commands:** `contextual_update`, `user_message`, `user_activity`, `client_tool_result`.
4. **Blocked commands:** `conversation_initiation_client_data` (HeyGen manages session init), `pong` (auto-handled).
5. **Passthrough events received:** `user_transcript`, `agent_response`, `agent_response_correction`, `interruption`, `vad_score`, `client_tool_call`, `contextual_update`, `conversation_initiation_metadata`, `internal_tentative_agent_response`.
6. **Event format received:** `{ event_type: "elevenlabs_agent_event", elevenlabs_event_type: "<type>", data: { ... } }`.

### ElevenLabs contextual_update

1. **Format (native WS):** `{ type: "contextual_update", text: "..." }`.
2. **Format (through HeyGen plugin):** `{ event_type: "elevenlabs_agent_command", elevenlabs_event_type: "contextual_update", data: { text: "..." } }`.
3. **Behavior:** Processed asynchronously. Does NOT generate a response turn. Incorporated as context the agent uses in subsequent replies.
4. **Timing:** Send BEFORE voiceChat starts or before user speaks — the agent needs the context before generating its first message.
5. **Superseding:** Later contextual_updates can supersede earlier ones. ElevenLabs tracks `context_id` and `is_superseded`.

### SDK version gap (v0.0.9 → v0.0.18)

Our installed SDK is v0.0.9. Latest is v0.0.18. The Context7 docs reference `SessionInteractivityMode.CONVERSATIONAL` and `startPushToTalk()` which don't exist in v0.0.9. We MUST update the SDK, but our `VoiceChatConfig` usage (`defaultMuted`, `deviceId`) is compatible. New features are additive.

**IMPORTANT:** The SDK does NOT expose a public method to send `elevenlabs_agent_command`. The `room` property is private. We use `(session as any).room.localParticipant.publishData()` as a documented escape hatch until HeyGen adds a public API for this. This is the SAME mechanism the SDK uses internally (`sendCommandEvent` → `publishData` on `agent-control` topic).

---

## Task 1: Update SDK to latest version

**Files:**

- Modify: `packages/js-sdk/package.json` (version field — this is a monorepo, the SDK is a local package)

**Note:** Since `packages/js-sdk` is a local workspace package in our monorepo, updating it means pulling the latest code. Check if the monorepo uses a pinned version or git submodule.

- [ ] **Step 1: Check how the SDK is managed in the monorepo**

```bash
cd C:/Users/liveavatar/liveavatar-web-sdk
cat pnpm-workspace.yaml
cat package.json | grep -A5 js-sdk
```

Determine if `packages/js-sdk` is a local source package or consumed from npm.

- [ ] **Step 2: If local source — pull latest SDK source**

If `packages/js-sdk` contains source code (not node_modules), we need to update it from the upstream HeyGen repo:

```bash
cd C:/Users/liveavatar/liveavatar-web-sdk
# Check current remote
cd packages/js-sdk && git remote -v 2>/dev/null || echo "Not a git repo"
cd ../..
```

If it's not a separate git repo, check if we can update via npm:

```bash
# Check if apps/demo/package.json references the SDK
cat apps/demo/package.json | grep liveavatar
```

- [ ] **Step 3: Update the SDK package**

Based on Step 2, either:
a) Update the workspace package source to match v0.0.18
b) Or update the npm dependency: `cd apps/demo && pnpm update @heygen/liveavatar-web-sdk@0.0.18`

- [ ] **Step 4: Verify new exports exist**

After update, check:

```bash
cd C:/Users/liveavatar/liveavatar-web-sdk
grep -r "SessionInteractivityMode" packages/js-sdk/src/ || echo "Not in this version yet"
grep -r "USER_TRANSCRIPTION_CHUNK" packages/js-sdk/src/ || echo "Not in this version yet"
```

- [ ] **Step 5: Build and verify no breaking changes**

```bash
cd C:/Users/liveavatar/liveavatar-web-sdk && pnpm build
```

If build fails, check breaking changes between v0.0.9 and v0.0.18. Common issues: renamed exports, changed method signatures.

- [ ] **Step 6: Commit**

```bash
git add packages/js-sdk/ apps/demo/package.json pnpm-lock.yaml
git commit -m "chore: update @heygen/liveavatar-web-sdk to v0.0.18"
```

---

## Task 2: Store ElevenLabs API key in HeyGen + update secrets

**Files:**

- Modify: `apps/demo/app/api/secrets.ts` (add export)
- Modify: `apps/demo/.env.local` (add secret_id)

- [ ] **Step 1: Call HeyGen secrets API**

```bash
curl -X POST https://api.liveavatar.com/v1/secrets \
  -H "X-API-KEY: $(grep HEYGEN_API_KEY apps/demo/.env.local | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{
    "secret_type": "ELEVENLABS_API_KEY",
    "secret_value": "'"$(grep ELEVENLABS_API_KEY apps/demo/.env.local | cut -d= -f2)"'",
    "secret_name": "Clara ElevenLabs Key"
  }'
```

Expected response: `{ "data": { "secret_id": "sec_xxxxxxxx" } }`

Copy `secret_id`.

- [ ] **Step 2: Add to .env.local**

```bash
# apps/demo/.env.local
HEYGEN_ELEVENLABS_SECRET_ID=sec_xxxxxxxx
```

- [ ] **Step 3: Add export to secrets.ts**

In `apps/demo/app/api/secrets.ts`, add after the `ELEVENLABS_AGENT_ID` line:

```typescript
// ELEVENLABS PLUGIN — HeyGen-stored secret (not the raw API key)
export const HEYGEN_ELEVENLABS_SECRET_ID =
  process.env.HEYGEN_ELEVENLABS_SECRET_ID || "";
```

- [ ] **Step 4: Typecheck**

```bash
cd C:/Users/liveavatar/liveavatar-web-sdk && pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/demo/app/api/secrets.ts
git commit -m "feat: add HEYGEN_ELEVENLABS_SECRET_ID for ElevenLabs plugin"
```

---

## Task 3: Change session token payload to LITE + plugin

**Files:**

- Modify: `apps/demo/app/api/start-custom-session/route.ts`

- [ ] **Step 1: Update imports (line 1-8)**

Replace:

```typescript
import {
  API_KEY,
  API_URL,
  AVATAR_ID_MOBILE,
  AVATAR_ID_DESKTOP,
} from "../secrets";
```

With:

```typescript
import {
  API_KEY,
  API_URL,
  AVATAR_ID_MOBILE,
  AVATAR_ID_DESKTOP,
  HEYGEN_ELEVENLABS_SECRET_ID,
  ELEVENLABS_AGENT_ID,
} from "../secrets";
```

- [ ] **Step 2: Add secret_id guard after the API_KEY guard (~line 127)**

After the `if (!API_KEY)` block, add:

```typescript
if (!HEYGEN_ELEVENLABS_SECRET_ID) {
  logger.error("[HEYGEN] HEYGEN_ELEVENLABS_SECRET_ID not configured", null, {
    route: "/api/start-custom-session",
  });
  return new Response(
    JSON.stringify({
      error: "ElevenLabs plugin not configured",
      code: "HEYGEN_ELEVENLABS_SECRET_MISSING",
    }),
    { status: 500, headers: { "Content-Type": "application/json" } },
  );
}
```

- [ ] **Step 3: Replace heygenPayload (lines 140-143)**

Replace:

```typescript
const heygenPayload = {
  mode: "CUSTOM",
  avatar_id: avatarId,
};
```

With:

```typescript
const heygenPayload = {
  mode: "LITE",
  avatar_id: avatarId,
  elevenlabs_agent_config: {
    secret_id: HEYGEN_ELEVENLABS_SECRET_ID,
    agent_id: ELEVENLABS_AGENT_ID,
  },
};
```

- [ ] **Step 4: Update log message (line 128-137)**

Replace:

```typescript
logger.info(
  "[HEYGEN] Starting CUSTOM session",
  {
    avatarId,
    deviceType,
    apiUrl: API_URL,
    hasApiKey: !!API_KEY,
  },
  { route: "/api/start-custom-session" },
);
```

With:

```typescript
logger.info(
  "[HEYGEN] Starting LITE+ElevenLabs Plugin session",
  {
    avatarId,
    deviceType,
    apiUrl: API_URL,
    hasApiKey: !!API_KEY,
    hasSecretId: !!HEYGEN_ELEVENLABS_SECRET_ID,
    agentId: ELEVENLABS_AGENT_ID,
  },
  { route: "/api/start-custom-session" },
);
```

- [ ] **Step 5: Typecheck + commit**

```bash
cd C:/Users/liveavatar/liveavatar-web-sdk && pnpm typecheck
git add apps/demo/app/api/start-custom-session/route.ts
git commit -m "feat: switch session to LITE + ElevenLabs Plugin mode"
```

---

## Task 4: Create ElevenLabs command helper

**Files:**

- Create: `apps/demo/src/lib/heygen/elevenlabs-commands.ts`

This helper encapsulates the LiveKit data channel escape hatch in one place. When HeyGen adds a public SDK method, we update this ONE file.

- [ ] **Step 1: Create the directory**

```bash
mkdir -p C:/Users/liveavatar/liveavatar-web-sdk/apps/demo/src/lib/heygen
```

- [ ] **Step 2: Write the helper**

Create `apps/demo/src/lib/heygen/elevenlabs-commands.ts`:

```typescript
/**
 * ElevenLabs Plugin command helpers for HeyGen LiveAvatar.
 *
 * The HeyGen LiveAvatar SDK (v0.0.9–v0.0.18) does not expose a public method
 * to send `elevenlabs_agent_command` via the LiveKit data channel.
 * This module provides a typed wrapper around the internal
 * `room.localParticipant.publishData()` mechanism — the same one the SDK
 * uses internally in `sendCommandEvent()`.
 *
 * When the SDK adds a public API for plugin commands, replace this module.
 *
 * @see https://docs.liveavatar.com/docs/lite-mode/connectors/elevenlabs-agent
 * @see https://elevenlabs.io/docs/eleven-agents/customization/events/client-to-server-events
 */
import type { LiveAvatarSession } from "@heygen/liveavatar-web-sdk";

/** LiveKit topic for sending commands (same as SDK's LIVEKIT_COMMAND_CHANNEL_TOPIC) */
const AGENT_CONTROL_TOPIC = "agent-control";

/** Whitelisted ElevenLabs command types that HeyGen allows through the plugin */
type ElevenLabsCommandType =
  | "contextual_update"
  | "user_message"
  | "user_activity"
  | "client_tool_result";

/**
 * Send an ElevenLabs agent command through HeyGen's LiveKit data channel.
 *
 * Format per HeyGen docs:
 * {
 *   "event_type": "elevenlabs_agent_command",
 *   "elevenlabs_event_type": "<type>",
 *   "data": { ... }  // Must NOT include "type" field
 * }
 *
 * @throws Error if session room is not connected
 */
function sendElevenLabsCommand(
  session: LiveAvatarSession,
  commandType: ElevenLabsCommandType,
  data: Record<string, unknown>,
): void {
  // Access the internal LiveKit room (private in SDK)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const room = (session as any).room;
  if (!room || room.state !== "connected") {
    console.warn(
      `[EL-CMD] Cannot send ${commandType} — room not connected (state: ${room?.state})`,
    );
    return;
  }

  const payload = {
    event_type: "elevenlabs_agent_command",
    elevenlabs_event_type: commandType,
    data,
  };

  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  room.localParticipant.publishData(encoded, {
    reliable: true,
    topic: AGENT_CONTROL_TOPIC,
  });

  console.log(`[EL-CMD] Sent ${commandType}:`, data);
}

/**
 * Send customer context to ElevenLabs agent via contextual_update.
 *
 * This replaces `dynamic_variables` (which are blocked by the plugin).
 * contextual_update is MORE flexible: free-form text, updatable mid-conversation,
 * and doesn't require template placeholders in the agent prompt.
 *
 * TIMING: Call AFTER SESSION_STREAM_READY but BEFORE voiceChat.start()
 * so the agent has context before the user speaks.
 *
 * @see https://elevenlabs.io/docs/eleven-agents/customization/events/client-to-server-events
 */
export function sendCustomerContext(
  session: LiveAvatarSession,
  context: {
    firstName?: string;
    lastName?: string;
    email?: string;
    skinType?: string;
    skinConcerns?: string[];
    ordersCount?: number;
  },
): void {
  const parts: string[] = [];

  if (context.firstName) {
    parts.push(
      `La cliente se llama ${context.firstName}${context.lastName ? " " + context.lastName : ""}. Salúdala por su nombre.`,
    );
  }

  if (context.skinType) {
    parts.push(`Su tipo de piel es: ${context.skinType}.`);
  }

  if (context.skinConcerns?.length) {
    parts.push(
      `Sus preocupaciones principales son: ${context.skinConcerns.join(", ")}.`,
    );
  }

  if (context.ordersCount !== undefined && context.ordersCount > 0) {
    parts.push(
      `Ha realizado ${context.ordersCount} compra${context.ordersCount > 1 ? "s" : ""} anteriormente. Es cliente recurrente.`,
    );
  }

  if (parts.length === 0) {
    console.log("[EL-CMD] No customer context to send, skipping");
    return;
  }

  const text = parts.join(" ");
  console.log(`[EL-CMD] Sending customer context (${text.length} chars)`);

  sendElevenLabsCommand(session, "contextual_update", { text });
}

/**
 * Inject a text message as if the user said it.
 * Useful for triggering the agent's greeting after sending context.
 */
export function sendUserMessage(
  session: LiveAvatarSession,
  text: string,
): void {
  sendElevenLabsCommand(session, "user_message", { text });
}

/**
 * Send a heartbeat / nudge to elicit a response from the agent.
 */
export function sendUserActivity(session: LiveAvatarSession): void {
  sendElevenLabsCommand(session, "user_activity", {});
}
```

- [ ] **Step 3: Typecheck**

```bash
cd C:/Users/liveavatar/liveavatar-web-sdk && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/demo/src/lib/heygen/elevenlabs-commands.ts
git commit -m "feat: add ElevenLabs plugin command helpers (contextual_update, user_message)"
```

---

## Task 5: Rewrite ClaraVoiceAgent — remove audio pipeline, add plugin integration

This is the core refactor. `ConnectedSession` goes from ~450 lines to ~130 lines.

**Files:**

- Modify: `apps/demo/src/components/ClaraVoiceAgent.tsx`

### What to REMOVE

**Imports to remove:**

- `useElevenLabsAgent` and `VadInfo` from `"../hooks"`

**Constants to delete (lines ~68–179):** All audio pipeline config:

- `MIN_VAD_SCORE_FOR_INTERRUPT`, `SMART_INTERRUPTION_ENABLED`
- `INTERRUPT_BLOCK_WINDOW_MS`
- `AUDIO_FADE_ENABLED`, `AUDIO_FADE_DURATION_MS`
- `MAX_AUDIO_SIZE_BYTES`, `CHUNK_WAIT_TIMEOUT_MS`
- `INTERRUPT_DEBOUNCE_MS`, `AUDIO_SENT_GRACE_PERIOD_MS`, `MIN_GAP_DETECTION_SAMPLES`
- `TARGET_SAMPLE_RATE`
- `AudioConfig` interface, `DESKTOP_CONFIG`, `MOBILE_CONFIG`, `GREETING_SKIP_PHASE1`
- `getMinPhase1Samples()`, `isMobileDevice()` (only used for audio config)

**Refs to delete inside ConnectedSession (lines ~502–534):**

- `audioBufferRef`, `totalChunksReceivedRef`, `lastChunkTimeRef`, `gapCheckIntervalRef`
- `isAfterInterruptRef`, `immediateSendTimeoutRef`, `hassentImmediateRef`, `isFirstAudioRef`
- `lastInterruptTimeRef`, `isSendingAudioRef`, `audioSentTimeRef`, `sourceRateRef`
- `reportAudioSentRef`, `reportAvatarStartedRef`
- `fadeInProgressRef`, `fadeIntervalRef`
- `hasConnectedAgentRef`
- `audioConfig` useMemo

**Functions to delete:**

- `calculateBufferSamples()` useCallback
- `fadeOutAndInterrupt()` useCallback
- `sendAllAudioToAvatar()` useCallback
- `startGapDetection()` useCallback

**The entire `useElevenLabsAgent({...})` block (~lines 1040–1298):**
All callbacks: `onAudioData`, `onAgentResponse`, `onAgentResponseEnd`, `onInterruption`, `onUserTranscript`, `onError`

**Effects to delete:**

- `reportAudioSent/reportAvatarStarted` ref population
- `connectAgent` effect (`isStreamReady && !hasConnectedAgentRef`)
- `AVATAR_SPEAK_STARTED` latency tracking effect
- `AVATAR_SPEAK_ENDED` sending state reset effect

### What to ADD

- [ ] **Step 1: Add imports**

Add at the top of the file:

```typescript
import { sendCustomerContext } from "../lib/heygen/elevenlabs-commands";
```

Remove from hooks import: `useElevenLabsAgent,` and `VadInfo,`

- [ ] **Step 2: Delete all audio pipeline constants**

Delete everything from `// SMART INTERRUPTION CONFIGURATION` (line ~67) through `getMinPhase1Samples()` (line ~179). Also delete the `isMobileDevice()` function (lines ~48–53).

Keep:

- `SESSION_LIMIT_ENABLED`, `SESSION_LIMIT_MINUTES`, `SESSION_WARNING_SECONDS`
- `SessionExpiryWarning` component
- `StatusIndicator` component
- All UI sub-components

- [ ] **Step 3: Rewrite ConnectedSession state**

Replace the state/refs block inside `ConnectedSession`. Remove the local `isMuted` state, the `audioConfig` memo, and all audio refs. Use context for state:

```typescript
const ConnectedSession: React.FC<ConnectedSessionProps> = ({ onEndCall }) => {
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
  const hassentContextRef = useRef(false);
```

- [ ] **Step 4: Add the voiceChat + contextual_update initialization effect**

This is the critical effect. Order matters: context FIRST, then voiceChat.

```typescript
// === PLUGIN INIT: contextual_update → voiceChat.start() ===
// TIMING (per ElevenLabs docs):
// 1. Wait for SESSION_STREAM_READY (LiveKit room connected)
// 2. Send contextual_update with customer data (agent gets context silently)
// 3. Start voiceChat (publishes mic to LiveKit → HeyGen → ElevenLabs)
// The agent will use the customer context in its first response.
useEffect(() => {
  const session = sessionRef.current;
  if (!isStreamReady || !session) return;

  const initPlugin = async () => {
    // Step 1: Send customer context (if available, one-time)
    if (!hassentContextRef.current && customerData) {
      hassentContextRef.current = true;
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

    // Step 2: Start voice chat (publishes mic to LiveKit)
    // Per SDK docs: creates LocalAudioTrack with echoCancellation,
    // noiseSuppression, autoGainControl enabled by default
    try {
      console.log("[PLUGIN] Starting voiceChat (CONVERSATIONAL mode)");
      await session.voiceChat.start({ defaultMuted: false });
      console.log("[PLUGIN] VoiceChat started successfully");
    } catch (err) {
      console.error("[PLUGIN] Failed to start voiceChat:", err);
    }
  };

  initPlugin();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [isStreamReady]);
```

- [ ] **Step 5: Add thinking state effect**

```typescript
// === UI STATE: Derive "thinking" from SDK events ===
// Thinking = between USER_SPEAK_ENDED and AVATAR_SPEAK_STARTED
// Per HeyGen docs: these events come via LiveKit data channel (agent-response topic)
// For the ElevenLabs plugin, ElevenLabs events are also passed through
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
```

- [ ] **Step 6: Replace handleToggleMute**

Per SDK docs: `mute()` and `unmute()` are async. The context tracks `isMuted` via `VoiceChatEvent.MUTED/UNMUTED`.

```typescript
// Mute/unmute: SDK voiceChat handles mic + fires VoiceChatEvent
// Context picks up MUTED/UNMUTED events → updates isMuted
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
```

- [ ] **Step 7: Keep the video attach effect (unchanged)**

```typescript
// Attach video element when stream is ready
useEffect(() => {
  if (isStreamReady && videoRef.current) {
    attachElement(videoRef.current);
  }
}, [isStreamReady, attachElement]);
```

- [ ] **Step 8: Keep the keep-alive effect (unchanged)**

The existing keep-alive interval effect stays exactly as-is. `session.keepAlive()` works the same in plugin mode.

- [ ] **Step 9: Keep the session timer effects (unchanged)**

The `SESSION_LIMIT_ENABLED` countdown timer and expiry handler stay as-is.

- [ ] **Step 10: Simplify cleanup effect**

Replace the large cleanup effect with:

```typescript
// Cleanup on unmount
useEffect(() => {
  return () => {
    sessionRef.current?.voiceChat.stop();
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
```

- [ ] **Step 11: Update JSX bindings**

StatusIndicator — replace `isAgentConnected` and ElevenLabs state with SDK state:

```typescript
<StatusIndicator
  isConnected={isStreamReady}
  isListening={isUserTalking}
  isThinking={isThinking}
  isSpeaking={isAvatarTalking}
  isMuted={isMuted}
  connectionQuality={connectionQuality}
/>
```

VoiceControls:

```typescript
<VoiceControls
  isMuted={isMuted}
  isActive={isStreamReady}
  onToggleMute={handleToggleMute}
/>
```

Remove the `agentError` display div (ElevenLabs errors now surface through session disconnect events, not a local error string).

Remove the `isAgentConnected` spacer div condition — use `isStreamReady` instead.

- [ ] **Step 12: Typecheck**

```bash
cd C:/Users/liveavatar/liveavatar-web-sdk && pnpm typecheck
```

Fix any remaining references to deleted variables. Common ones:

- `isAgentConnected` → `isStreamReady`
- `agentError` → delete the div
- `startListening` / `stopListening` → delete (replaced by voiceChat mute/unmute)
- `connectAgent` / `disconnectAgent` → delete

- [ ] **Step 13: Build**

```bash
cd C:/Users/liveavatar/liveavatar-web-sdk && pnpm build
```

- [ ] **Step 14: Commit**

```bash
git add apps/demo/src/components/ClaraVoiceAgent.tsx
git commit -m "feat: replace 500-line audio pipeline with SDK voiceChat + contextual_update"
```

---

## Task 6: Deploy to staging and QA

- [ ] **Step 1: Set Vercel env vars for preview**

```bash
cd C:/Users/liveavatar/liveavatar-web-sdk
vercel env ls | grep HEYGEN_ELEVENLABS_SECRET_ID || echo "MISSING — add it"
# If missing:
# vercel env add HEYGEN_ELEVENLABS_SECRET_ID preview
```

Also verify `ELEVENLABS_AGENT_ID` is set to `agent_6901kc9x6f16e0gb7gbwhjk4514r` (clara-ai) in preview/develop.

- [ ] **Step 2: Create branch and push**

```bash
git checkout develop && git pull origin develop
git checkout -b feature/elevenlabs-plugin
# If commits are on develop already, just push. If on a different branch:
# git cherry-pick <commit-hashes>
git push -u origin feature/elevenlabs-plugin
```

- [ ] **Step 3: Create PR (do NOT merge)**

```bash
gh pr create \
  --base develop \
  --head feature/elevenlabs-plugin \
  --title "feat: migrate to ElevenLabs Plugin + contextual_update" \
  --body "$(cat <<'EOF'
## Summary

- Replaces ~500 lines of manual audio pipeline with HeyGen's native ElevenLabs Plugin
- Session: `mode: LITE` + `elevenlabs_agent_config` → HeyGen handles STT+LLM+TTS server-side
- Customer personalization: `contextual_update` via LiveKit data channel (replaces `dynamic_variables`)
- Frontend: `session.voiceChat.start()` → mic published via LiveKit
- UI states from SDK: `USER_SPEAK_STARTED/ENDED`, `AVATAR_SPEAK_STARTED/ENDED`
- All ElevenLabs events pass through: `vad_score`, `interruption`, `user_transcript`

## Architecture Change

```

BEFORE: Mic → WebAudio → ElevenLabs WS → buffer → resample → repeatAudio → HeyGen
AFTER: Mic → LiveKit → HeyGen server → ElevenLabs → lip-sync (zero browser audio code)

```

## QA Checklist
- [ ] Desktop Chrome: avatar responds to voice
- [ ] Desktop Chrome: mute/unmute works
- [ ] Desktop Chrome: interrupt works (talk over avatar)
- [ ] Desktop Chrome: status badges correct (listening/thinking/speaking)
- [ ] Desktop Chrome: customer name in greeting (contextual_update)
- [ ] Mobile Chrome: avatar responds to voice
- [ ] Mobile Chrome: NO mid-word audio cuts (the "per-to" bug)
- [ ] Mobile Chrome: session timer counts down
- [ ] Both: "Finalizar" button ends session cleanly
- [ ] Both: no console errors

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: QA — Desktop Chrome**

1. Open preview URL
2. Login / start session
3. Confirm avatar video appears
4. Say "Hola" — confirm avatar responds WITH customer name (if logged in as known customer)
5. Say "Cuál es tu nombre?" — confirm correct response
6. Talk while avatar speaks — confirm interrupt works
7. Click mute → confirm mic goes silent
8. Click unmute → confirm mic restored
9. Click "Finalizar" → confirm clean session end
10. F12 Console → no red errors

- [ ] **Step 5: QA — Mobile Chrome**

Same 10 steps. Extra checks:

- No "per-to" style mid-word cuts
- Response within 3 seconds
- Status badges update correctly

- [ ] **Step 6: QA — contextual_update verification**

With a known Shopify customer (or test account with customer data):

1. Start session
2. Check F12 Console for `[EL-CMD] Sent contextual_update: ...` log
3. Verify Clara uses the customer name in her greeting
4. Ask "¿Qué sabes de mi piel?" — confirm she references the skin type/concerns

Without customer data (anonymous user):

1. Start session
2. Check Console: `[EL-CMD] No customer context to send, skipping`
3. Verify Clara gives a generic but functional greeting

---

## Task 7: Go/No-Go and PR handoff

- [ ] **Step 1: Checklist**

| Criteria                                               | Pass |
| ------------------------------------------------------ | ---- |
| Desktop: avatar responds to voice                      | ☐    |
| Desktop: customer name in greeting (contextual_update) | ☐    |
| Mobile: no mid-word audio cuts                         | ☐    |
| Interrupt works                                        | ☐    |
| Mute/unmute works                                      | ☐    |
| Session ends cleanly                                   | ☐    |
| No TypeScript errors (`pnpm typecheck`)                | ☐    |
| Build passes (`pnpm build`)                            | ☐    |

- [ ] **Step 2: If NO-GO — rollback**

```bash
git revert HEAD~N  # revert the N commits
git push origin feature/elevenlabs-plugin
```

Or close the PR without merging. Old pipeline code is preserved in git history and `useElevenLabsAgent.ts`.

- [ ] **Step 3: Notify user**

"PR creado: [URL]. Tests: Desktop ✓, Mobile ✓, Personalización ✓. Esperando tu aprobación."

**⚠️ STOP — Do NOT merge. User reviews and merges.**

---

## Self-Review

**Spec coverage:**

- ✅ SDK update (v0.0.9 → v0.0.18) — Task 1
- ✅ HeyGen secret storage — Task 2
- ✅ Session token change — Task 3
- ✅ `contextual_update` for personalization — Task 4 + Task 5 Step 4
- ✅ ClaraVoiceAgent rewrite — Task 5
- ✅ Vercel deploy — Task 6
- ✅ QA with contextual_update verification — Task 6 Step 6
- ✅ PR creation (no merge) — Task 6 Step 3
- ✅ Rollback plan — Task 7 Step 2

**Best practices verified against docs:**

- ✅ `voiceChat.start()` called after `SESSION_STREAM_READY` (SDK docs)
- ✅ `contextual_update` sent BEFORE voiceChat starts (ElevenLabs timing)
- ✅ Command format uses `elevenlabs_event_type` wrapper, no `type` in `data` (HeyGen plugin docs)
- ✅ Commands sent on `agent-control` topic (HeyGen plugin docs)
- ✅ `mute()`/`unmute()` are async (SDK docs)
- ✅ Context tracks `isMuted` via `VoiceChatEvent` (SDK React example)
- ✅ `interrupt()` sends `avatar.interrupt` (SDK docs)
- ✅ Keep-alive every 5 minutes (LITE mode docs)

**Type consistency:**

- `sendCustomerContext()` accepts same shape as `CustomerData` from context
- `handleToggleMute` is `async` — React onClick silently ignores returned Promise
- `isStreamReady` replaces both `isStreamReady && isAgentConnected` (plugin mode = no separate agent connection)
