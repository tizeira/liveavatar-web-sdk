# Clara architecture and invariants

Last verified: 2026-09-11. Re-read provider contracts and the deployed code before production changes.

## Runtime path

1. Browser calls `/api/start-custom-session`.
2. Server applies rate limiting and authentication.
3. Server requests a LiveAvatar session token with `mode: "LITE"` and inline `elevenlabs_agent_config`.
4. Server currently waits for a database session record before returning.
5. Browser constructs `ElevenLabsAgentSession` with voice chat enabled.
6. LiveAvatar/LiveKit transports microphone input and rendered avatar audio/video.
7. ElevenLabs performs endpointing, ASR, LLM/RAG, and TTS through the connector.

## Current ElevenLabs baseline (2026-09-09)

- Language: Spanish.
- LLM: `qwen36-35b-a3b`.
- Prompt size: 9,120 characters.
- TTS: `eleven_flash_v2_5`.
- Voice: stability 0.65, similarity 0.8, speed 1.05.
- Turn eagerness: normal.
- ASR: `scribe_realtime`, high quality, PCM 16 kHz input.
- Knowledge base: one configured source.
- Tools: none.
- Dynamic-variable placeholders: `customer_name`, `purchase_date`, `purchased_products` are present remotely; runtime delivery from the current app still uses `contextual_update`.

Treat this as a dated snapshot. Re-read the remote agent through the official API before using it as the control in a future experiment. Redact keys, prompt text, transcripts, customer data, and full IDs.

## Connector contract verified 2026-09-11

- ElevenLabs requires a paid plan, API-key scopes `convai_read`, `user_read`, `voices_read`, an Agent ID, and PCM 24 kHz output.
- Inline `elevenlabs_agent_config` accepts optional `voice_id` and `dynamic_variables`.
- Stored `voice_agent` is reusable and dashboard-managed, but per-session `language` and `dynamic_variables` overrides are rejected.
- The connector automatically creates the LiveKit room and uses the FULL event family over LiveKit topics `agent-control` and `agent-response`; standard LITE WebSocket command events do not apply.
- `contextual_update`, `user_message`, `user_activity`, and `client_tool_result` are accepted inbound passthrough commands.
- There is no client interruption command in the connector whitelist; interruptions are observed as events and governed by the agent/transport behavior.

## Known code risks

- Startup awaits the database `createSession` call despite a non-blocking comment.
- Greeting initialization sends context and then `[START]` after a hard-coded 150 ms without acknowledgment.
- The context helper catches send errors internally, so the caller cannot reliably retry.
- UI keepalive runs every 5 minutes exactly.
- SDK keepalive does not await the client promise inside its `try/catch`.
- The diagnostic endpoint tests CUSTOM mode rather than Clara's LITE + ElevenLabs connector path.
- Connector-path telemetry does not decompose a voice turn into ASR, LLM, TTS, network, and avatar-render stages.
- Testers currently logs full transcripts, full identifiers, raw events, text deltas, and high-volume VAD in the browser; this is a production blocker.
- Auth.js returned HTML where JSON was expected before login in the 2026-09-11 browser QA.
- The Shopify purchase-context path was not exercised because QA entered testers directly instead of using the signed redirect.
- User-reported cold-session behavior: audio can lead visible lip movement for the first one to three interactions and then stabilize. The SDK's stream-ready event fires when both tracks are subscribed, before attachment/decoded-frame/playback proof; Clara triggers attachment and greeting from the same state.
- The remote agent has no attached tests or enabled simulation library.
- Remote privacy settings currently record voice and retain audio/transcript without automatic deletion or PII removal; product/legal review is required before production.

## Compatibility invariant

The project uses a fork of `@heygen/liveavatar-web-sdk` 0.0.18 and pins `livekit-client` 2.15.7. Version 0.0.18 was still the public npm release on 2026-09-11. Evaluate upgrades together. Confirm compilation, connection, reconnect, audio playback, permissions, Safari/iOS behavior, cleanup, and long-session keepalive before promotion.

## OpenAI boundary

- LiveAvatar officially documents `openai_realtime_config`; this is a supported alternative connector, not Clara's current route.
- The connector page defaults to `gpt-realtime`; current OpenAI examples use `gpt-realtime-2.1`. Do not assume the bridge accepts a newer model until a contract smoke test passes.
- GPT-Live is different from Realtime: it keeps a full-duplex voice conversation while delegating work to another backend. OpenAI explicitly warns that Realtime integrations are not automatically compatible with GPT-Live.
- GPT-Live's verified partner list includes LiveKit, Twilio, Telnyx, and Daily/Pipecat, not LiveAvatar. Treat any GPT-Live + avatar plan as a separate integration path.
- OpenAI Realtime is not an active implementation priority. GPT-Live remains a future watch item pending a direct LiveAvatar-compatible path or a justified custom architecture.
