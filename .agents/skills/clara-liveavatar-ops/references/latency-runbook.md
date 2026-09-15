# Clara latency and artifact runbook

## 1. Collect a safe incident record

Record:

- UTC timestamp and environment;
- truncated LiveAvatar session and ElevenLabs conversation IDs;
- agent branch/version;
- browser/version, OS, device class, headset/speaker, and network type;
- symptom category and exact turn number;
- whether the issue reproduced after reconnect or in another network.

Do not store transcript text, prompt content, credentials, access tokens, or customer fields in ordinary logs.

## 2. Measure the timeline

Use a monotonic browser clock for client events and a server clock for server spans. Carry a correlation ID.

| Timestamp | Meaning                                                           |
| --------- | ----------------------------------------------------------------- |
| t0        | session request begins                                            |
| t1        | session token response received                                   |
| t2        | LiveKit connected                                                 |
| t3        | avatar audio and video tracks subscribed (`SESSION_STREAM_READY`) |
| t3a       | media element reports `playing`                                   |
| t3b       | first video frame is presented                                    |
| t4        | user speech starts                                                |
| t5        | user speech ends                                                  |
| t6        | final user transcription arrives                                  |
| t7        | first tentative/final agent response text arrives                 |
| t8        | avatar speech starts                                              |
| t9        | avatar speech ends                                                |

Derive startup API `t1-t0`, track startup `t3-t1`, playback startup `t3a-t3`, first-frame startup `t3b-t3`, endpointing/ASR `t6-t5`, LLM first response `t7-t6`, synthesis/network/render `t8-t7`, and perceived turn latency `t8-t5`.

If an event is unavailable, report it as missing; do not silently substitute a broader interval.

## 3. Map symptoms to evidence

| Symptom                                             | First checks                                                                                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session fails before avatar                         | HTTP status, provider error body redacted, billing/quota, rate limit, auth, DB span                                                                                  |
| Slow first load only                                | t1-t0 vs t3-t1, DB time, cold start, LiveKit connect                                                                                                                 |
| Slow every reply                                    | t6-t5, t7-t6, t8-t7, ElevenLabs p50/p90/p99                                                                                                                          |
| Agent cuts user off                                 | turn eagerness, interruptions, endpointing, background noise                                                                                                         |
| Long silence after user                             | final transcript time, LLM first text, RAG, prompt/model                                                                                                             |
| Robotic/clicking audio                              | RTC packet loss/jitter/RTT, CPU, output device, format path                                                                                                          |
| Double voice/echo                                   | duplicate playback, open tabs, local monitoring, acoustic echo                                                                                                       |
| Random disconnect                                   | LiveKit reconnect events, WebSocket close code, keepalive result                                                                                                     |
| Wrong/incoherent content                            | agent version, prompt/RAG, dynamic context ordering; not audio latency                                                                                               |
| Audio starts before lip movement during first turns | first-frame timing, video jitter-buffer delay, decoded/dropped frames, long tasks, device load, chroma key, and whether greeting starts before `playing`/first frame |

## 4. RTC and session telemetry

Subscribe to LiveKit reconnecting/reconnected/disconnected, connection-quality and playback-status events supported by the pinned SDK. Sample RTC stats during an incident rather than on every frame. Track packet loss, jitter, RTT, bitrate, decoded/dropped frames, jitter-buffer delay and device changes. Use `requestVideoFrameCallback` when supported to timestamp presented video frames; keep a documented fallback for unsupported browsers.

Send keepalive every 120 seconds with mutual exclusion. Await the provider promise, log duration/status, and apply bounded backoff. Never log the token.

## 5. Baseline protocol

- At least 30 sessions and 100 turns per candidate.
- Repeat the same Spanish scripts across variants.
- Include short answers, long answers, silence, interruptions, numbers/names, and noisy audio.
- Separate desktop/mobile and Wi-Fi/mobile network results.
- Report p50, p90, p99, failure rate, reconnect rate, and artifact rate.
- A two-session success streak is not evidence of production reliability.

Suggested starting targets: startup p90 <= 6 s, perceived turn p50 <= 1.2 s, perceived turn p90 <= 2.0 s, session success >= 99%, and audio-artifact turns < 1%. Product owners must ratify these targets.
