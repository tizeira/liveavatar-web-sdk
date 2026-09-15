# ElevenLabs CLI operations for Clara

Last verified: 2026-09-11. Installed CLI: `elevenlabs 1.2.0`.

## Boundary

- The LiveAvatar ElevenLabs Agent Connector is the runtime/data plane. It creates the room bridge, transports user audio and uses ElevenLabs audio to drive avatar animation.
- The ElevenLabs CLI is the configuration/control plane. It reads API resources and manages agents-as-code, branches, tools, tests and deployments.
- Installing or using the CLI does not replace the connector and does not by itself improve live latency.

## Read the generated command contract

Before CLI work, read:

- `../../elevenlabs-cli/elevenlabs-shared/SKILL.md` for global behavior;
- `../../elevenlabs-cli/elevenlabs-agents/SKILL.md` for current agent commands.

Prefer `elevenlabs agents --schema` and operation-level `--schema` over remembered flags. Regenerate the embedded skills after every CLI upgrade:

```text
elevenlabs generate-skills --output-dir .agents/skills/elevenlabs-cli
```

## Authentication state and permissions

The local environment has an `ELEVENLABS_API_KEY` that can list/read agents. On 2026-09-11, `elevenlabs user get` failed because the key lacked `user_read`. This local key is not proven to be the same credential stored as the LiveAvatar secret.

Before any write, validate the target workspace and a least-privilege key without printing it. The LiveAvatar connector contract requires `convai_read`, `user_read` and `voices_read`. Agent modifications require the relevant write permission, normally `convai_write`. Prefer a service account for production automation where the ElevenLabs plan supports it; separate testers and production credentials.

Never pass a key inline, echo it, log it, store it in agent JSON, or commit `.env`/credential-store files.

## Safe default: redacted remote read

Raw `agents get` and agents-as-code pull files can include full prompts, workspace member emails, voice/agent/version IDs, knowledge-base metadata, tools, allowlists and retention settings. Parse in memory and report only fields needed for the decision. Truncate identifiers and never display prompt text.

The redacted baseline should include:

- agent and branch/version suffix;
- prompt character count, model and temperature;
- first-message state and dynamic-variable names only;
- ASR, turn and TTS settings including PCM format;
- knowledge-base/tool/test counts;
- monitoring, authentication and privacy/retention flags.

## Agents-as-code workflow

Do not download the raw production agent into a repository until its visibility and the confidentiality of prompts/configuration have been decided.

When the destination is approved:

1. initialize a dedicated directory with `elevenlabs agents init <path>`; never use `--override` on an existing project;
2. dry-run a targeted pull, then pull the exact agent and branch;
3. commit the untouched baseline privately before edits;
4. create or select an ElevenLabs experiment branch;
5. edit one variable and add/update the relevant test;
6. inspect status and run agent tests;
7. run a targeted `agents push --agent <id> --branch <branch> --dry-run`;
8. present the redacted diff, test results, exact target and rollback version;
9. require explicit authorization before the real push;
10. validate in testers before merging/promoting to main.

The official v1 CLI states that workflow push force-overrides main and registered branch configs. Never run an unscoped push merely to check connectivity. Never delete, merge or rebase through the CLI without separately resolving and confirming the exact target.

## Current Clara baseline from a redacted CLI read

- name: `clara-ai`;
- LLM: `qwen36-35b-a3b`, temperature 1.0, prompt 9,120 characters;
- agent: Spanish, empty first message, three dynamic-variable placeholders;
- turn: `turn_v3`, normal eagerness, 15-second timeout, speculative turn enabled;
- ASR: `scribe_realtime`, high quality, PCM 16 kHz input;
- TTS: `eleven_flash_v2_5`, PCM 24 kHz output, streaming optimization 3, stability 0.65, similarity 0.8, speed 1.05;
- one knowledge-base source, zero tools, zero attached tests, simulation library disabled;
- voice recording enabled; indefinite retention/no automatic transcript+PII or audio deletion in the returned config.

Treat this as a dated snapshot and re-read before each experiment.

## Primary references

- https://elevenlabs.io/docs/eleven-agents/operate/cli
- https://github.com/elevenlabs/cli/blob/main/README.md
- https://elevenlabs.io/docs/api-reference/authentication
- https://elevenlabs.io/docs/overview/administration/workspaces/api-keys
- https://docs.liveavatar.com/docs/lite-mode/connectors/elevenlabs-agent
