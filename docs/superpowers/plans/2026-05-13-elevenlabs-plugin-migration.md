# ElevenLabs Plugin Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ~500 lines of manual audio piping in `ClaraVoiceAgent.tsx` with HeyGen's native ElevenLabs Plugin, so HeyGen handles STT+LLM+TTS server-side instead of the browser.

**Architecture:** Currently, the browser captures mic audio → sends to ElevenLabs WebSocket → receives TTS PCM chunks → resamples 16kHz→24kHz → sends to HeyGen `repeatAudio()`. After migration, HeyGen creates a LiveKit room, the browser publishes its mic track via LiveKit (one SDK call), and HeyGen handles the full ElevenLabs pipeline server-side. Events arrive via FULL Mode LiveKit data channels.

**Tech Stack:** Next.js 15 App Router, `@heygen/liveavatar-web-sdk` (VoiceChat API), HeyGen LiveAvatar API v1, ElevenLabs Conversational AI (server-side via plugin), Vercel

---

## File Map

| File                                              | Change                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `apps/demo/app/api/secrets.ts`                    | Add `HEYGEN_ELEVENLABS_SECRET_ID` export                                                   |
| `apps/demo/app/api/start-custom-session/route.ts` | Change payload: `mode: "LITE"` + `elevenlabs_agent_config`                                 |
| `apps/demo/src/components/ClaraVoiceAgent.tsx`    | Remove ~500 lines of audio pipeline; replace with `session.voiceChat.start()` + SDK events |
| `apps/demo/.env.local`                            | Add `HEYGEN_ELEVENLABS_SECRET_ID=<value>`                                                  |

Files that become UNUSED (keep, don't delete yet):

- `apps/demo/src/hooks/useElevenLabsAgent.ts` — entire hook becomes unused; keep for rollback reference
- `apps/demo/app/api/elevenlabs-conversation/route.ts` — proxied ElevenLabs WS endpoint; keep for rollback

---

## Known Limitation

**Customer personalization (dynamic variables)** is lost in v1. The current `useElevenLabsAgent` passes `firstName`, `skinType`, etc. to ElevenLabs. The HeyGen plugin creates the ElevenLabs session without a way to inject per-user variables. This is a known trade-off. The ElevenLabs agent `agent_6901kc9x6f16e0gb7gbwhjk4514r` (clara-ai) should have a generic greeting prompt as fallback.

---

## Task 1: Store ElevenLabs API key as HeyGen secret (one-time setup)

**Files:**

- No code files — curl command only
- Modify: `apps/demo/app/api/secrets.ts`
- Modify: `apps/demo/.env.local` (add the returned secret_id)

- [ ] **Step 1: Call HeyGen secrets API to store ElevenLabs key**

Run this curl from any terminal (requires `HEYGEN_API_KEY` from `.env.local`):

```bash
curl -X POST https://api.liveavatar.com/v1/secrets \
  -H "X-API-KEY: 5caae602-d44f-11f0-a99e-066a7fa2e369" \
  -H "Content-Type: application/json" \
  -d '{
    "secret_type": "ELEVENLABS_API_KEY",
    "secret_value": "sk_5ab459e3383072a30f37d924e79ea1c0eddbb6ec693ea187",
    "secret_name": "Clara ElevenLabs Key"
  }'
```

Expected response:

```json
{ "data": { "secret_id": "sec_xxxxxxxxxxxxxxxx" } }
```

Copy the `secret_id` value — you'll need it in the next steps.

- [ ] **Step 2: Add secret_id to .env.local**

Add this line to `apps/demo/.env.local`:

```bash
HEYGEN_ELEVENLABS_SECRET_ID=sec_xxxxxxxxxxxxxxxx   # replace with actual value from Step 1
```

- [ ] **Step 3: Add export to secrets.ts**

In `apps/demo/app/api/secrets.ts`, add after line 28:

```typescript
// ELEVENLABS PLUGIN - Secret ID stored in HeyGen vault (not the raw API key)
export const HEYGEN_ELEVENLABS_SECRET_ID =
  process.env.HEYGEN_ELEVENLABS_SECRET_ID || "";
```

- [ ] **Step 4: Verify the export compiles**

```bash
cd C:/Users/liveavatar/liveavatar-web-sdk && pnpm typecheck
```

Expected: No errors about `secrets.ts`.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/liveavatar/liveavatar-web-sdk
git add apps/demo/app/api/secrets.ts apps/demo/.env.local
git commit -m "feat: add HEYGEN_ELEVENLABS_SECRET_ID for plugin migration"
```

---

## Task 2: Change session token payload to use ElevenLabs Plugin

**Files:**

- Modify: `apps/demo/app/api/start-custom-session/route.ts` (lines 128–143)

- [ ] **Step 1: Update the import in route.ts**

In `apps/demo/app/api/start-custom-session/route.ts`, add `HEYGEN_ELEVENLABS_SECRET_ID` and `ELEVENLABS_AGENT_ID` to the import:

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

- [ ] **Step 2: Change heygenPayload (lines 139–143)**

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

- [ ] **Step 3: Update the log message (line 129) for clarity**

```typescript
logger.info(
  "[HEYGEN] Starting LITE+ElevenLabs session",
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

- [ ] **Step 4: Add guard: fail fast if secret_id missing**

After the existing `if (!API_KEY)` check, add:

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

- [ ] **Step 5: Typecheck**

```bash
cd C:/Users/liveavatar/liveavatar-web-sdk && pnpm typecheck
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/demo/app/api/start-custom-session/route.ts
git commit -m "feat: switch HeyGen session to LITE+ElevenLabs plugin mode"
```

---

## Task 3: Simplify ClaraVoiceAgent — remove audio pipeline, wire SDK events

This is the main refactor. The `ConnectedSession` component goes from ~450 lines to ~150 lines.

**Files:**

- Modify: `apps/demo/src/components/ClaraVoiceAgent.tsx`

### What to REMOVE from ConnectedSession:

All audio pipeline code — these refs, constants, and functions exist only to support the manual audio piping:

**Constants to remove (top of file, lines ~95–179):**

- `MAX_AUDIO_SIZE_BYTES`, `CHUNK_WAIT_TIMEOUT_MS`
- `INTERRUPT_DEBOUNCE_MS`, `AUDIO_SENT_GRACE_PERIOD_MS`, `MIN_GAP_DETECTION_SAMPLES`
- `INTERRUPT_BLOCK_WINDOW_MS`
- `AUDIO_FADE_ENABLED`, `AUDIO_FADE_DURATION_MS`
- `AudioConfig` interface, `DESKTOP_CONFIG`, `MOBILE_CONFIG`, `GREETING_SKIP_PHASE1`
- `getMinPhase1Samples()` function
- `MIN_VAD_SCORE_FOR_INTERRUPT`, `SMART_INTERRUPTION_ENABLED`

**Refs to remove inside ConnectedSession:**

- `audioBufferRef`, `totalChunksReceivedRef`, `lastChunkTimeRef`, `gapCheckIntervalRef`
- `isAfterInterruptRef`, `immediateSendTimeoutRef`, `hassentImmediateRef`, `isFirstAudioRef`
- `lastInterruptTimeRef`, `isSendingAudioRef`, `audioSentTimeRef`, `sourceRateRef`
- `reportAudioSentRef`, `reportAvatarStartedRef`
- `fadeInProgressRef`, `fadeIntervalRef`
- `audioConfig` useMemo

**Functions to remove:**

- `calculateBufferSamples()`
- `fadeOutAndInterrupt()`
- `sendAllAudioToAvatar()`
- `startGapDetection()`
- All of `useElevenLabsAgent({...})` call and its callbacks (`onAudioData`, `onAgentResponse`, `onAgentResponseEnd`, `onInterruption`, `onUserTranscript`)
- `reportAudioSent`, `reportAvatarStarted` refs population effect

**Imports to remove:**

- `useElevenLabsAgent, VadInfo` from `"../hooks"`
- The `isMobileDevice()` function (only used for audio config)

### What to ADD:

**State for thinking:**

```typescript
const [isThinking, setIsThinking] = useState(false);
```

**Context state (already available via useLiveAvatarContext):**

```typescript
const { sessionRef, customerData, isMuted, isUserTalking, isAvatarTalking } =
  useLiveAvatarContext();
```

**voiceChat.start() on stream ready:**

```typescript
// Start voice chat (mic → LiveKit → HeyGen → ElevenLabs) when stream is ready
useEffect(() => {
  if (isStreamReady && sessionRef.current) {
    console.log("[VOICECHAT] Starting voice chat (ElevenLabs Plugin)");
    sessionRef.current.voiceChat
      .start({ defaultMuted: false })
      .then(() => {
        console.log("[VOICECHAT] Voice chat started successfully");
      })
      .catch((err) => {
        console.error("[VOICECHAT] Failed to start voice chat:", err);
      });
  }
}, [isStreamReady, sessionRef]);
```

**Thinking state via SDK events:**

```typescript
// Derive "thinking" state: between USER_SPEAK_ENDED and AVATAR_SPEAK_STARTED
useEffect(() => {
  const session = sessionRef.current;
  if (!session) return;

  const handleUserSpeakEnded = () => {
    console.log("[STATE] User stopped speaking → thinking");
    setIsThinking(true);
  };
  const handleAvatarSpeakStarted = () => {
    console.log("[STATE] Avatar speaking → not thinking");
    setIsThinking(false);
  };
  const handleAvatarSpeakEnded = () => {
    console.log("[STATE] Avatar finished speaking");
    setIsThinking(false);
  };

  session.on(AgentEventsEnum.USER_SPEAK_ENDED, handleUserSpeakEnded);
  session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, handleAvatarSpeakStarted);
  session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, handleAvatarSpeakEnded);

  return () => {
    session.off(AgentEventsEnum.USER_SPEAK_ENDED, handleUserSpeakEnded);
    session.off(AgentEventsEnum.AVATAR_SPEAK_STARTED, handleAvatarSpeakStarted);
    session.off(AgentEventsEnum.AVATAR_SPEAK_ENDED, handleAvatarSpeakEnded);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

**Mute toggle:**

```typescript
const handleToggleMute = useCallback(async () => {
  const session = sessionRef.current;
  if (!session) return;
  if (isMuted) {
    await session.voiceChat.unmute();
    console.log("[VOICECHAT] Unmuted");
  } else {
    await session.voiceChat.mute();
    console.log("[VOICECHAT] Muted");
  }
}, [sessionRef, isMuted]);
```

**Cleanup on unmount (simplified):**

```typescript
useEffect(() => {
  return () => {
    sessionRef.current?.voiceChat.stop();
    if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
    if (keepAliveIntervalRef.current)
      clearInterval(keepAliveIntervalRef.current);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

**StatusIndicator binding (update):**

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

**VoiceControls binding (update):**

```typescript
<VoiceControls
  isMuted={isMuted}
  isActive={isStreamReady}
  onToggleMute={handleToggleMute}
/>
```

- [ ] **Step 1: Remove unused imports**

In `ClaraVoiceAgent.tsx`, find line 19:

```typescript
  useElevenLabsAgent,
  VadInfo,
```

Remove `useElevenLabsAgent,` and `VadInfo,` from the hooks import.

Remove the `isMobileDevice` function (lines ~48–53) since it's only used for audio config selection.

- [ ] **Step 2: Remove audio pipeline constants (top of file)**

Delete all constants from line ~82 down to `getMinPhase1Samples` (line ~179):

- `MIN_VAD_SCORE_FOR_INTERRUPT`, `SMART_INTERRUPTION_ENABLED`
- `INTERRUPT_BLOCK_WINDOW_MS`
- `AUDIO_FADE_ENABLED`, `AUDIO_FADE_DURATION_MS`
- `MAX_AUDIO_SIZE_BYTES`, `CHUNK_WAIT_TIMEOUT_MS`
- `INTERRUPT_DEBOUNCE_MS`, `AUDIO_SENT_GRACE_PERIOD_MS`, `MIN_GAP_DETECTION_SAMPLES`
- `TARGET_SAMPLE_RATE`
- `AudioConfig` interface, `DESKTOP_CONFIG`, `MOBILE_CONFIG`, `GREETING_SKIP_PHASE1`
- `getMinPhase1Samples()`

- [ ] **Step 3: Add `isThinking` state and update context destructure inside ConnectedSession**

Find the existing context line (around line ~496):

```typescript
const { sessionRef, customerData } = useLiveAvatarContext();
```

Replace with:

```typescript
const { sessionRef, customerData, isMuted, isUserTalking, isAvatarTalking } =
  useLiveAvatarContext();
const [isThinking, setIsThinking] = useState(false);
```

Remove the separate local `isMuted` state declaration (`const [isMuted, setIsMuted] = useState(false);`).

Remove the `audioConfig` useMemo block.

- [ ] **Step 4: Remove all audio refs**

Delete these useRef declarations from ConnectedSession:

```typescript
// DELETE all of these:
const audioBufferRef = useRef<string[]>([]);
const totalChunksReceivedRef = useRef(0);
const lastChunkTimeRef = useRef<number>(0);
const gapCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
const isAfterInterruptRef = useRef(false);
const immediateSendTimeoutRef = useRef<NodeJS.Timeout | null>(null);
const hassentImmediateRef = useRef(false);
const isFirstAudioRef = useRef(true);
const lastInterruptTimeRef = useRef<number>(0);
const isSendingAudioRef = useRef(false);
const audioSentTimeRef = useRef<number>(0);
const sourceRateRef = useRef<number>(16000);
const reportAudioSentRef = useRef<(() => void) | null>(null);
const reportAvatarStartedRef = useRef<(() => void) | null>(null);
const fadeInProgressRef = useRef(false);
const fadeIntervalRef = useRef<NodeJS.Timeout | null>(null);
const hasConnectedAgentRef = useRef(false);
```

Keep:

```typescript
const sessionTimerRef = useRef<NodeJS.Timeout | null>(null);
const keepAliveIntervalRef = useRef<NodeJS.Timeout | null>(null);
const videoRef = useRef<HTMLVideoElement>(null);
```

- [ ] **Step 5: Remove audio functions**

Delete these entire functions:

- `calculateBufferSamples` (useCallback)
- `fadeOutAndInterrupt` (useCallback)
- `sendAllAudioToAvatar` (useCallback)
- `startGapDetection` (useCallback)

- [ ] **Step 6: Remove useElevenLabsAgent call and all its callbacks**

Delete the entire block:

```typescript
const {
  isConnected,
  isListening,
  isThinking,
  isSpeaking,
  ...
} = useElevenLabsAgent({
  customerData: ...,
  onAudioData: (...) => { ... },
  onAgentResponse: () => { ... },
  onAgentResponseEnd: () => { ... },
  onInterruption: (...) => { ... },
  onUserTranscript: (...) => { ... },
  onError: (...) => { ... },
});
```

Also delete the `reportAudioSent/reportAvatarStarted` refs population effect:

```typescript
useEffect(() => {
  reportAudioSentRef.current = reportAudioSent;
  reportAvatarStartedRef.current = reportAvatarStarted;
}, [reportAudioSent, reportAvatarStarted]);
```

- [ ] **Step 7: Add voiceChat.start() useEffect**

After the video attach effect (the one calling `attachElement(videoRef.current)`), add:

```typescript
// Start voice chat: publishes mic to LiveKit so HeyGen can receive it
useEffect(() => {
  if (isStreamReady && sessionRef.current) {
    console.log("[VOICECHAT] Starting voice chat (ElevenLabs Plugin)");
    sessionRef.current.voiceChat
      .start({ defaultMuted: false })
      .then(() => {
        console.log("[VOICECHAT] Voice chat started successfully");
      })
      .catch((err: unknown) => {
        console.error("[VOICECHAT] Failed to start voice chat:", err);
      });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [isStreamReady]);
```

- [ ] **Step 8: Replace the three old SDK event effects with a single thinking state effect**

Remove:

- The `AVATAR_SPEAK_STARTED` latency tracking effect (`reportAvatarStartedRef.current?.()`)
- The `AVATAR_SPEAK_ENDED` sending state reset effect (`isSendingAudioRef.current = false`)
- The `connectAgent` effect (the one calling `connectAgent()` when `isStreamReady`)

Add this single effect:

```typescript
// Derive UI state from SDK events (ElevenLabs Plugin emits these via FULL Mode data channel)
useEffect(() => {
  const session = sessionRef.current;
  if (!session) return;

  const handleUserSpeakEnded = () => {
    console.log("[STATE] User stopped speaking → thinking");
    setIsThinking(true);
  };
  const handleAvatarSpeakStarted = () => {
    console.log("[STATE] Avatar speaking → not thinking");
    setIsThinking(false);
  };
  const handleAvatarSpeakEnded = () => {
    console.log("[STATE] Avatar finished speaking");
    setIsThinking(false);
  };

  session.on(AgentEventsEnum.USER_SPEAK_ENDED, handleUserSpeakEnded);
  session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, handleAvatarSpeakStarted);
  session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, handleAvatarSpeakEnded);

  return () => {
    session.off(AgentEventsEnum.USER_SPEAK_ENDED, handleUserSpeakEnded);
    session.off(AgentEventsEnum.AVATAR_SPEAK_STARTED, handleAvatarSpeakStarted);
    session.off(AgentEventsEnum.AVATAR_SPEAK_ENDED, handleAvatarSpeakEnded);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

- [ ] **Step 9: Replace handleToggleMute**

Remove:

```typescript
const handleToggleMute = useCallback(() => {
  if (isMuted) {
    startListening();
    setIsMuted(false);
  } else {
    stopListening();
    setIsMuted(true);
  }
}, [isMuted, startListening, stopListening]);
```

Add:

```typescript
const handleToggleMute = useCallback(async () => {
  const session = sessionRef.current;
  if (!session) return;
  if (isMuted) {
    await session.voiceChat.unmute();
    console.log("[VOICECHAT] Unmuted");
  } else {
    await session.voiceChat.mute();
    console.log("[VOICECHAT] Muted");
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [isMuted]);
```

- [ ] **Step 10: Update the cleanup useEffect**

Replace the large cleanup effect (the one with `audioBufferRef.current = []`) with:

```typescript
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

- [ ] **Step 11: Update StatusIndicator and VoiceControls in JSX**

Find:

```typescript
<StatusIndicator
  isConnected={isStreamReady && isAgentConnected}
  isListening={isListening}
  isThinking={isThinking}
  isSpeaking={isSpeaking}
  isMuted={isMuted}
  connectionQuality={connectionQuality}
/>
```

Replace with:

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

Find:

```typescript
<VoiceControls
  isMuted={isMuted}
  isActive={isAgentConnected}
  onToggleMute={handleToggleMute}
/>
```

Replace with:

```typescript
<VoiceControls
  isMuted={isMuted}
  isActive={isStreamReady}
  onToggleMute={handleToggleMute}
/>
```

Find and remove the error display (it referenced `agentError` from the EL hook):

```typescript
{agentError && (
  <div className="absolute top-4 left-4 right-4 z-50 bg-red-100 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm">
    {agentError}
  </div>
)}
```

- [ ] **Step 12: Typecheck**

```bash
cd C:/Users/liveavatar/liveavatar-web-sdk && pnpm typecheck
```

Expected: No errors. If you see "Property X does not exist on type ConnectedSession" or similar unused variable errors, remove the variable references from the JSX and state.

- [ ] **Step 13: Build**

```bash
cd C:/Users/liveavatar/liveavatar-web-sdk && pnpm build
```

Expected: Build succeeds.

- [ ] **Step 14: Commit**

```bash
git add apps/demo/src/components/ClaraVoiceAgent.tsx
git commit -m "feat: replace audio pipeline with SDK voiceChat for ElevenLabs Plugin"
```

---

## Task 4: Deploy to staging and QA

**Files:**

- No code changes — deploy and test

- [ ] **Step 1: Verify Vercel env var is set for preview**

Check that `HEYGEN_ELEVENLABS_SECRET_ID` is in Vercel environment variables for the `develop` branch (preview deploys).

Run:

```bash
cd C:/Users/liveavatar/liveavatar-web-sdk && vercel env ls
```

Look for `HEYGEN_ELEVENLABS_SECRET_ID`. If missing:

```bash
vercel env add HEYGEN_ELEVENLABS_SECRET_ID preview
# Enter the secret_id value when prompted
```

- [ ] **Step 2: Create feature branch and push**

```bash
git checkout develop
git pull origin develop
git checkout -b feature/elevenlabs-plugin
# Cherry-pick or rebase the commits from Tasks 1–3 onto this branch, or if you've been working on develop,
# just push the current state:
git push -u origin feature/elevenlabs-plugin
```

- [ ] **Step 3: Create PR (do NOT merge)**

```bash
gh pr create \
  --base develop \
  --head feature/elevenlabs-plugin \
  --title "feat: migrate to HeyGen ElevenLabs Plugin (remove manual audio pipeline)" \
  --body "$(cat <<'EOF'
## Summary

- Replaces ~500 lines of manual audio pipeline (mic capture → ElevenLabs WebSocket → resample → repeatAudio) with HeyGen's native ElevenLabs Plugin
- Session token now uses `mode: LITE` + `elevenlabs_agent_config` — HeyGen handles STT+LLM+TTS server-side
- Frontend: single `session.voiceChat.start()` call publishes mic via LiveKit to HeyGen
- UI states now driven by SDK events: `USER_SPEAK_STARTED/ENDED`, `AVATAR_SPEAK_STARTED/ENDED`
- ElevenLabs agent: `agent_6901kc9x6f16e0gb7gbwhjk4514r` (clara-ai)

## Known Limitations
- Customer personalization (dynamic variables: firstName, skinType) not supported by plugin in v1

## QA Checklist
- [ ] Avatar video loads on desktop
- [ ] Avatar video loads on mobile
- [ ] Mic permission prompt appears on first use
- [ ] Avatar responds to voice
- [ ] Listening/thinking/speaking status badges show correctly
- [ ] Mute/unmute button works
- [ ] Session timer counts down
- [ ] Finalizar button ends session cleanly
- [ ] No browser console errors

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Wait for Vercel preview deploy**

Vercel auto-deploys preview for every PR. Check the PR for the preview URL (typically `https://liveavatar-web-sdk-demo-git-feature-elevenlabs-plugin-*.vercel.app` or `https://testers.betaskintech.com` if develop auto-deploys).

- [ ] **Step 5: QA on desktop Chrome**

Open the preview URL in Chrome on desktop.

1. Click "Iniciar"
2. Allow microphone permission
3. Confirm avatar video appears
4. Say "Hola" — confirm avatar responds with voice and lip-sync
5. Say "Cuál es tu nombre?" — confirm correct response
6. Say something while avatar is speaking — confirm interrupt works
7. Click mute — confirm mic goes silent (avatar should stop detecting voice)
8. Click unmute — confirm mic restored
9. Click "Finalizar" — confirm session ends cleanly
10. Check browser DevTools console for errors (F12 → Console)

Pass criteria: All 10 steps complete without errors.

- [ ] **Step 6: QA on mobile (Android/iPhone Chrome)**

Same steps as desktop. Specific mobile checks:

1. No "per-to" style word cuts (was the main bug with old pipeline)
2. Avatar responds within 3 seconds of user finishing speech
3. Status badge changes correctly (Escuchando → Pensando → Respondiendo)

Pass criteria: Same 10 steps complete on mobile.

- [ ] **Step 7: Confirm pass → update feature list**

Update `.claude/tracking/feature_list.json` to mark this feature complete:

```json
"elevenlabs-plugin-migration": {
  "passes": true,
  "tested": "2026-05-13",
  "environment": "testers.betaskintech.com",
  "notes": "Desktop + mobile QA passed. Plugin replaces manual audio pipeline."
}
```

---

## Task 5: Go/No-Go decision and PR handoff

- [ ] **Step 1: Go/No-Go criteria check**

| Criteria                                 | Pass |
| ---------------------------------------- | ---- |
| Desktop: avatar responds to voice        | ☐    |
| Mobile: no mid-word audio cuts           | ☐    |
| Interrupt works (user talks over avatar) | ☐    |
| Mute/unmute works                        | ☐    |
| Session ends cleanly                     | ☐    |
| No TypeScript errors                     | ☐    |
| Build passes                             | ☐    |

If all pass → PR is ready for user approval. If any fail → document in `docs/TROUBLESHOOTING.md` and investigate before proceeding.

- [ ] **Step 2: If NO-GO — rollback plan**

The old pipeline code is preserved in `useElevenLabsAgent.ts` and the git history. To rollback:

```bash
git revert HEAD~3  # revert the 3 commits from this migration
git push origin feature/elevenlabs-plugin
```

Or simply close the PR without merging.

- [ ] **Step 3: Notify user**

After completing QA, tell the user:

- "PR creado: [URL]"
- "Tests realizados en Desktop Chrome ✓ + Mobile Chrome ✓"
- "Esperando tu aprobación para mergear a develop"

**⚠️ STOP HERE — Do NOT merge. User must approve and merge.**

---

## Self-Review

**Spec coverage:**

1. ✅ Branch `feature/elevenlabs-plugin` — Task 4 Step 2
2. ✅ HeyGen secret storage — Task 1
3. ✅ Session token payload change — Task 2
4. ✅ ClaraVoiceAgent simplification — Task 3
5. ✅ Vercel env var — Task 4 Step 1
6. ✅ QA checklist — Task 4 Steps 5–6
7. ✅ PR creation (no merge) — Task 4 Step 3
8. ✅ Go/No-Go criteria — Task 5
9. ✅ Rollback plan — Task 5 Step 2

**Potential issues:**

- `session.voiceChat.start()` requires an active LiveKit connection. It MUST be called after `isStreamReady` is true — this is handled in Task 3 Step 7.
- `isMuted` comes from `useLiveAvatarContext()` after this change. The context tracks it via `VoiceChatEvent.MUTED/UNMUTED` which the SDK emits when `voiceChat.mute()` / `voiceChat.unmute()` are called. This is already wired in the existing `context.tsx` — no changes needed there.
- The `VoiceControls` component receives `handleToggleMute` which is now `async`. The onClick handler in VoiceControls needs to accept Promise — but since onClick returns void normally, React silently ignores the returned Promise. This is fine.
- `agentError` is removed. If HeyGen session fails to start, the error will propagate via the session state transition to `DISCONNECTED`, which already shows the `ConnectingScreen` or resets the UI via `SessionWrapper`.
