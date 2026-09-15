# ElevenLabs change control for Clara

## Before a change

1. Read the current agent via the official Get Agent API without printing secrets, prompt text, transcripts, or full IDs.
2. Capture a redacted snapshot: branch/version, LLM, temperature, max tokens, prompt character count, ASR, turn settings, TTS model, voice numeric settings, output format, knowledge-base count, tool count, and dynamic-variable count.
3. Confirm account billing/quota is healthy.
4. Establish the existing version's p50/p90/p99 and failure/artifact rates.
5. Create a version branch; never experiment directly on the production version.
6. Read `elevenlabs-cli-ops.md`; use a redacted CLI read and verify the exact remote branch/version before editing.

## Experiment design

Change one independent variable:

- shorter/specialized prompt;
- RAG/knowledge-base scope;
- LLM model;
- turn eagerness/timeout;
- voice stability/similarity/speed;
- initialization via inline-config dynamic variables, or a separately tested stored voice-agent path.

Keep LiveAvatar, app deployment, device mix, scripts, traffic window, and all other agent settings fixed. Run automated simulations plus real audio/browser trials. For stochastic tests, repeat each case.

Use a small A/B allocation, typically 5-10%, only after offline tests pass. Do not interpret fewer than 30 sessions or 100 turns as a stable result.

## Current optimization hypotheses

1. `eleven_flash_v2_5` is already latency-oriented; replacing it is not the first lever.
2. The 9,120-character prompt may increase LLM time and response variance.
3. One active knowledge base may add retrieval latency; ElevenLabs documents approximately 250 ms for RAG.
4. Temperature 1.0 may increase behavioral variance more than latency.
5. Clara's current inline `elevenlabs_agent_config` supports dynamic variables and may remove the race between `contextual_update` and the 150 ms greeting trigger. A stored `voice_agent` cannot receive per-session dynamic-variable overrides, so changing to that path is a separate experiment rather than a drop-in optimization.
6. The active remote agent already defines three dynamic-variable placeholders, but the application still injects personalization through `contextual_update`. Supplying inline values is a candidate experiment, not an assumed fix.
7. The reported early-turn lip-sync warm-up belongs first to media readiness/render diagnostics; do not tune LLM/TTS settings until `lipsync-warmup.md` isolates the layer.

Test these hypotheses separately. A faster aggregate result does not prove causality if multiple settings changed.

## Promotion and rollback

Promote only when the candidate meets latency, success, quality, safety, and Spanish-language criteria. Record the immutable version ID and deployment commit. Preserve the previous version for immediate rollback. After promotion, monitor termination reason, error rate, p50/p90/p99 and artifact reports by version.

Before any real CLI push, run a targeted dry-run and show the redacted diff, tests, destination branch/version and rollback. The CLI's agents-as-code push force-overrides the registered configuration; an unscoped push is never a connectivity check.

## Primary references

- https://docs.liveavatar.com/docs/lite-mode/connectors/elevenlabs-agent
- https://elevenlabs.io/docs/eleven-agents/operate/cli
- https://github.com/elevenlabs/cli/blob/main/README.md
- https://elevenlabs.io/docs/eleven-agents/operate/versioning
- https://elevenlabs.io/docs/eleven-agents/operate/experiments
- https://elevenlabs.io/docs/eleven-agents/customization/agent-testing
- https://elevenlabs.io/docs/eleven-agents/customization/personalization
- https://elevenlabs.io/docs/eleven-agents/customization/knowledge-base/rag
- https://elevenlabs.io/docs/eleven-agents/dashboard
