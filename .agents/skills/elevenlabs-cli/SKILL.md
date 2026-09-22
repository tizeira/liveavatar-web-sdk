---
name: elevenlabs-cli
description: Safely inspect and manage ElevenLabs resources and voice agents from the official CLI, including agents-as-code, branches, tests, tools, configuration pull/push, authentication, and generated command skills. Use whenever work requires the `elevenlabs` command or direct changes to an ElevenLabs agent from this repository.
---

# ElevenLabs CLI

Use the locally installed official CLI. Treat it as a configuration/control plane, not as the runtime voice connector.

## Route to the embedded contract

1. Read `elevenlabs-shared/SKILL.md` for authentication, dry-run and output behavior.
2. Read the generated command-group skill that matches the requested resource.
3. For voice agents, always read `elevenlabs-agents/SKILL.md`.
4. Prefer the current CLI's `--schema` output over remembered flags or older documentation.
5. When the target is Clara, also read `../clara-liveavatar-ops/SKILL.md` and its referenced change-control/CLI procedure.

The generated skills reflect CLI `1.2.0` as installed on 2026-09-11. After upgrading the CLI, refresh them with:

```text
elevenlabs generate-skills --output-dir .agents/skills/elevenlabs-cli
```

## Safety defaults

- Never print, pass inline, or commit credentials.
- Raw agent reads can contain prompts, emails, identifiers, tools, knowledge-base metadata and privacy configuration. Parse in memory and return a redacted summary unless the user explicitly needs a protected artifact.
- Read-only inspection is the default. Remote create/update/push/merge/rebase/delete operations require an explicit target and authorization.
- Use a dedicated branch/version, change one variable, run tests and perform a targeted dry-run before any real push.
- Never use an unscoped push to test connectivity. Never use `agents init --override` on an existing configuration project.
- Preserve an immutable baseline and rollback version.

## Expected output

State the CLI version, credential capability without exposing it, workspace/agent target in truncated form, operation type, branch/version, dry-run result, tests, redacted diff, and rollback. Distinguish local file changes from remote ElevenLabs changes.
