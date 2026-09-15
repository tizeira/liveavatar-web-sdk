# Lip-sync warm-up diagnosis for Clara

Last verified: 2026-09-11.

## Symptom contract

Use this runbook when audio starts before visible mouth movement, especially during the greeting or first one to three turns, then appears synchronized later. Record the report as device/load dependent until a controlled matrix proves otherwise.

Do not classify this as LLM latency. The LLM can answer quickly while video decode, jitter buffering, browser rendering, or canvas composition lags behind audio.

## Current evidence

- **Reported:** the tester perceived audio leading lip movement during the first interactions and alignment around the third turn.
- **Code:** the SDK emits `SESSION_STREAM_READY` when one remote audio track and one remote video track have been added to a `MediaStream`.
- **Code:** Clara reacts to that state by scheduling the greeting and, separately, attaching the media element. It does not wait for `loadeddata`, `playing`, or a presented frame.
- **Code:** if chroma key is enabled, the visible output is a canvas updated with full-frame `getImageData`/per-pixel processing/`putImageData` on `requestAnimationFrame`.
- **Contract:** LiveAvatar says connector audio drives avatar animation in real time, but does not define `SESSION_STREAM_READY` as first-frame readiness.
- **Hypothesis:** video decoder/jitter buffer/compositor warm-up, amplified by main-thread load or chroma key, lets audio become audible before the corresponding mouth frames are presented.

## Required timeline

Use monotonic timestamps and a session/turn correlation suffix. Capture:

1. LiveKit connected;
2. video and audio track subscription individually;
3. media attach call;
4. `loadedmetadata`, `loadeddata`, `canplay`, `playing`, `waiting`, `stalled`;
5. first presented frame and continuing frame cadence via `requestVideoFrameCallback` when supported;
6. `avatar.speak_started` and `avatar.speak_ended`;
7. audible speech onset and visible lip-motion onset from a screen/audio recording for the greeting and first five turns;
8. video `framesDecoded`, `framesDropped`, `jitterBufferDelay / jitterBufferEmittedCount`, packet loss, RTT and inbound bitrate;
9. browser long tasks and whether chroma key is enabled.

Do not log transcript bodies, customer data, full identifiers or raw provider payloads.

## Test matrix

For every device/browser/load cell, start a new cold session and keep script, avatar, agent version, network and application release fixed.

- desktop reference, mobile reference and one low-power device;
- normal load and induced CPU/main-thread load;
- chroma key off and on when the environment supports it;
- at least the greeting plus five identical short turns;
- reconnect as a separate scenario, never mixed with cold start.

Report A/V skew for each turn and the first turn where alignment remains stable. Include sample size and video evidence reference. Do not reduce the result to average voice latency.

## Experiment order

1. Instrument only; reproduce the existing behavior.
2. Gate the greeting on `playing` plus a short stable sequence of presented frames, with a visible/observable maximum wait and fallback.
3. Compare chroma key off vs on. If on is materially worse, move processing off the critical path or replace the per-pixel main-thread loop before changing the agent.
4. Compare RTC/jitter and dropped-frame metrics across affected/unaffected devices.
5. Escalate to LiveAvatar with redacted session suffixes, timestamps and the minimal reproduction if audio/video source skew remains after local playback readiness is proven.

Change one variable per experiment. A longer fixed delay is not a root-cause fix and can hide regressions.

## Acceptance gate

Product owners must ratify a perceptual A/V threshold. Until then, require no clearly perceptible audio lead in the greeting or first five turns across the supported device/browser matrix, no regression in time-to-first-greeting, and no increase in stalled/dropped-frame rate.

## Primary references

- https://docs.liveavatar.com/docs/lite-mode/connectors/elevenlabs-agent
- https://docs.livekit.io/transport/media/subscribe/
- https://docs.livekit.io/robotics/media/performance/stats/
