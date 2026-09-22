---
name: clara-liveavatar-ops
description: Diagnose, benchmark, and safely evolve Clara on testers.betaskintech.com or production when working with LiveAvatar LITE, the ElevenLabs Agent Connector, LiveKit, voice latency, audio artifacts, session failures, greeting/context initialization, agent configuration, releases, or tester reports. Use this project-specific skill before changing Clara's voice stack or ElevenLabs settings.
---

# Clara LiveAvatar Operations

Use Clara's actual pipeline as the default: Next.js -> LiveAvatar LITE -> ElevenLabs Agent Connector -> LiveKit/WebRTC. Do not recommend a platform migration until measurements isolate a persistent provider limitation.

## Start every investigation

1. Read `references/architecture.md` and `references/source-register.md`.
2. Read `references/provider-selection.md` before proposing OpenAI, FULL mode, a plugin, a custom agent, or a transport change.
3. Classify the symptom as startup, endpointing/ASR, LLM, TTS, avatar render, transport, billing/quota, or product output.
4. Ask for or locate the session/conversation ID, timestamp, browser, device, network type, agent version, and the exact turn. Avoid transcript bodies and customer PII.
5. Read `references/latency-runbook.md` for intermittent performance or audio artifacts.
6. Read `references/elevenlabs-change-control.md` before changing the remote agent.
7. Read `references/lipsync-warmup.md` when audio leads mouth movement, the first turns behave worse than later turns, or results vary by device/load.
8. Read `references/elevenlabs-cli-ops.md` before using the CLI, pulling raw agent configuration, or publishing an agent change. For exact current commands, also read `../elevenlabs-cli/elevenlabs-shared/SKILL.md` and `../elevenlabs-cli/elevenlabs-agents/SKILL.md`.

## Hard rules

- Treat billing/quota failures separately from latency and quality.
- Measure t0-t9 before tuning models. Never infer provider latency from total turn time alone.
- Do not change production agent settings, secrets, billing, traffic, or deployment without explicit authorization.
- Use ElevenLabs version branches for experiments. Change one variable at a time and preserve a baseline.
- Treat the ElevenLabs CLI as the configuration/control plane and the LiveAvatar ElevenLabs Connector as the runtime/data plane. The CLI does not replace the connector or directly reduce call latency.
- Never print or commit a raw `agents get`/`agents pull` result without reviewing it: it can contain the full prompt, member emails, identifiers, retention settings, tools, and knowledge-base metadata. Emit a redacted summary by default.
- Run a directed dry-run and review the target branch/version before every push. Never use `agents init --override`, delete, merge, rebase, or a main-branch push as a routine setup step.
- Choose the ElevenLabs configuration form deliberately. Inline `elevenlabs_agent_config` supports `dynamic_variables`; stored `voice_agent` rejects per-session `language` and `dynamic_variables` overrides. Never claim that both behaviors apply to the same path.
- Do not use GPT-Live and OpenAI Realtime as synonyms. LiveAvatar documents a Realtime connector; GPT-Live is a separate full-duplex/delegated-backend architecture and requires its own compatibility proof.
- Current product priority is ElevenLabs hardening. Do not propose or implement OpenAI Realtime unless the user explicitly reopens that decision; keep GPT-Live as a monitored future option.
- Treat HeyGen's general video-generation Quick Start as out of scope for Clara's conversational runtime; use the dedicated LiveAvatar documentation.
- Do not depend on an arbitrary timer between `contextual_update` and the greeting trigger. Prefer initialization data in the token request when the selected connector path supports it, or wait for verifiable delivery and retry idempotently.
- Never log API keys, full agent/voice/customer IDs, prompts, transcripts, tokens, or customer attributes.
- Keep the LiveAvatar SDK and pinned LiveKit client compatible as a unit; do not upgrade LiveKit independently without contract and browser tests.
- Distinguish audio artifacts from AI-response artifacts and repository-generated files.
- Keepalive must be awaited, observable, idempotent, and scheduled with margin before provider expiry.
- `SESSION_STREAM_READY` proves track subscription, not that a video frame was decoded or presented. Do not trigger the first audible greeting solely from this event.

## Expected output

Report evidence, source verification date, root-cause confidence, affected layer, missing measurements, a minimal reproduction, and the smallest reversible next experiment. Include p50/p90/p99 when enough samples exist; explicitly label small samples. State whether each claim comes from current code, live QA, a provider contract, or an unverified hypothesis.
