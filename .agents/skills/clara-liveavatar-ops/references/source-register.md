# Source register

Use dated sources. Re-open web documentation before implementation because provider contracts and model names change.

| Source                                                                  | Verified                         | Authority and use                                                                                                       |
| ----------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `docs/context/CLARA_CURRENT_CONTEXT.md`                                 | 2026-09-11                       | Canonical project context; summarizes current code, QA, provider docs, and decisions.                                   |
| `docs/qa/2026-09-11-testers-browser-console.md`                         | 2026-09-11                       | Live browser evidence from one authenticated testers session; small sample.                                             |
| `docs/research/2026-09-09-clara-liveavatar-elevenlabs-audit.md`         | 2026-09-09, corrected 2026-09-11 | Deep technical audit and remote ElevenLabs snapshot; revalidate remote values.                                          |
| `Reporte_Clara_Beta_Skin_Tech_2026-09-11.docx`                          | reviewed 2026-09-11              | Historical/contextual synthesis supplied by the user; not a runtime specification or live audit.                        |
| https://docs.liveavatar.com/docs/lite-mode/integration-paths            | 2026-09-11                       | Official selection among connector, plugin, custom agent, raw transport, and broadcast.                                 |
| https://docs.liveavatar.com/docs/lite-mode/connectors/elevenlabs-agent  | 2026-09-11                       | Official ElevenLabs requirements, configuration forms, events, commands, and billing boundary.                          |
| https://docs.liveavatar.com/docs/lite-mode/connectors/openai-realtime   | 2026-09-11                       | Official support and payload contract for the OpenAI Realtime connector.                                                |
| https://developers.heygen.com/docs/quick-start                          | 2026-09-11                       | General HeyGen video-generation quick start; not Clara's conversational runtime contract.                               |
| https://developers.heygen.com/live-avatar                               | 2026-09-11                       | Official HeyGen routing page for LiveAvatar FULL/LITE; defers details to LiveAvatar docs.                               |
| https://www.npmjs.com/package/@heygen/liveavatar-web-sdk                | 2026-09-11                       | Public SDK release: 0.0.18.                                                                                             |
| https://developers.openai.com/api/docs/guides/live                      | 2026-09-11                       | Official GPT-Live architecture: full-duplex voice plus delegated backend.                                               |
| https://developers.openai.com/api/docs/guides/realtime                  | 2026-09-11                       | Official speech-to-speech Realtime architecture and current starter model.                                              |
| https://developers.openai.com/api/docs/guides/voice-agents              | 2026-09-11                       | Official comparison of GPT-Live, Realtime, and chained voice pipelines; evaluation guidance.                            |
| https://developers.openai.com/api/docs/guides/live-partner-integrations | 2026-09-11                       | Official GPT-Live partners and warning that Realtime integrations are not automatically compatible.                     |
| https://developers.openai.com/api/docs/pricing                          | 2026-09-11                       | Official GPT-Live per-minute price and Realtime token prices; total scenario cost still requires measurement.           |
| https://elevenlabs.io/docs/eleven-agents/operate/cli                    | 2026-09-11                       | Official agents-as-code workflow, authentication, generated skills, pull/push, dry-run, tests and CI/CD.                |
| https://github.com/elevenlabs/cli/blob/main/README.md                   | 2026-09-11                       | Official CLI v1 command semantics, including branch targeting and warning that push force-overrides registered configs. |
| https://elevenlabs.io/docs/api-reference/authentication                 | 2026-09-11                       | Official API-key scope, quota and IP restriction model.                                                                 |
| https://elevenlabs.io/docs/overview/administration/workspaces/api-keys  | 2026-09-11                       | Official key lifecycle and service-account guidance.                                                                    |
| https://docs.livekit.io/robotics/media/performance/stats/               | 2026-09-11                       | Official RTC measurements for packet loss and video jitter-buffer delay.                                                |

## Conflicts resolved

- “Dynamic variables are blocked by the connector” is too broad. Inline ElevenLabs config supports them; stored voice-agent per-session overrides do not.
- “LiveAvatar compatibility with OpenAI is unknown” is obsolete for Realtime. A direct connector is documented.
- “GPT-Live/Realtime” is not a valid combined provider label. Record which architecture is meant.
- HeyGen's general Quick Start generates completed video files and cannot be used as implementation guidance for Clara's realtime loop.
- “Stream ready” is not evidence of rendered lip-sync readiness in the current fork: code emits it at audio/video track subscription, before attachment and first-frame proof.
- The ElevenLabs CLI manages configuration; it is not the runtime LiveAvatar connector.

## Evidence labels

Label findings as one of:

- **Observed:** reproduced in testers or measured from a live provider API.
- **Reported:** direct tester/user observation that has not yet been independently instrumented.
- **Code:** present in the repository but not necessarily deployed.
- **Contract:** stated in current official documentation.
- **Hypothesis:** requires a controlled test.

Never promote a hypothesis to current state merely because it appears in a plan, conversation, report, code comment, or old skill.
