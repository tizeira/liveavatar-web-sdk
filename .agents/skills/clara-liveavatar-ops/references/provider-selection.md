# Provider and integration-path selection

Last verified: 2026-09-11.

## Current decision

Keep Clara on LiveAvatar LITE with the ElevenLabs Agent Connector and make it production-grade. ElevenLabs configuration-as-code, audiovisual startup, privacy, tests, and reproducibility are the active priorities. OpenAI Realtime is explicitly deprioritized for cost/focus; GPT-Live is watch-list research, not an implementation track.

## Select the path by ownership

| Need                                                                  | Path                                 | Consequence                                                                         |
| --------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| Keep current ElevenLabs voice agent                                   | LiveAvatar connector + ElevenLabs    | Lowest migration effort; current baseline.                                          |
| Reconsider OpenAI speech-to-speech after an explicit product decision | LiveAvatar OpenAI Realtime Connector | Technically supported, currently deprioritized.                                     |
| Monitor lower-cost full-duplex voice architecture                     | GPT-Live                             | Separate architecture and not a direct LiveAvatar connector; research only for now. |
| Keep an existing LiveKit/Pipecat/Agora agent stack                    | LiveAvatar plugin                    | Appropriate only if that stack already exists in production.                        |
| Own agent logic but let LiveAvatar host the room                      | Custom agent in LiveAvatar room      | More control and code; useful when connectors cannot meet requirements.             |
| Own transport and avatar wiring                                       | Raw transport config                 | Highest operational burden; use only for a real infrastructure requirement.         |
| Render one-way output                                                 | No agent / broadcast                 | Not appropriate for Clara's interactive post-sale role.                             |

## Required experiment gates

Before any provider comparison:

1. remove browser transcript/ID/raw-event logging;
2. fix or instrument the context/greeting race and keepalive;
3. define identical scenarios and outcome criteria;
4. record model, prompt/version, transport, device, browser, network, and timestamps;
5. keep the avatar, application release, test audio, and traffic window fixed;
6. provide immediate rollback to the ElevenLabs baseline.

Compare task success, factual grounding, Spanish/Chilean naturalness, audible response latency, endpointing, barge-in, unwanted silence, audio defects, connection failure, cost, observability, security, and maintenance. Natural voice quality alone is not evidence that tools or business actions worked.

## OpenAI-specific guardrails

- `openai_realtime_config` is evidence of Realtime connector support only.
- Validate the exact model string with LiveAvatar. Its connector documentation shows `gpt-realtime`; OpenAI's current starter shows `gpt-realtime-2.1`.
- Do not put an OpenAI API key in the browser. Register it as a LiveAvatar secret for the connector or mint ephemeral client credentials on a trusted server for a direct OpenAI implementation.
- Do not call a Realtime prototype “GPT-Live.” GPT-Live uses delegation and different session behavior.
- If testing GPT-Live, use the OpenAI integration checklist for audio formats, interruptions, session events, backend delegation, and termination; current partner packages must explicitly support `gpt-live-1`.
- Official GPT-Live pricing is USD 0.05 per session minute plus backend model/tool charges. Realtime audio pricing is token-based, so compare measured scenario cost rather than claiming a universal per-minute ratio.

## Primary references

- https://docs.liveavatar.com/docs/lite-mode/integration-paths
- https://docs.liveavatar.com/docs/lite-mode/connectors/elevenlabs-agent
- https://docs.liveavatar.com/docs/lite-mode/connectors/openai-realtime
- https://developers.openai.com/api/docs/guides/live
- https://developers.openai.com/api/docs/guides/realtime
- https://developers.openai.com/api/docs/guides/voice-agents
- https://developers.openai.com/api/docs/guides/live-partner-integrations
- https://developers.openai.com/api/docs/pricing
