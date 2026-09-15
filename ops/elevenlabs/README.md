# Clara ElevenLabs agents-as-code workspace

Initialized with the official ElevenLabs CLI 1.2.0 on 2026-09-11. This directory is intentionally empty: no production agent config has been pulled and no remote change has been published.

## Security gate before the first pull

An agent config round-trips raw provider JSON and can contain the full system prompt, workspace member details, resource IDs, allowlists, tools, knowledge-base metadata and privacy settings. Confirm that this Git repository and its collaborators are approved to hold that information before downloading it here.

Use `.env` only for local credentials; it is ignored. Never put an API key in a command, committed file, log or review output.

## Clara workflow

1. Read `.agents/skills/clara-liveavatar-ops/references/elevenlabs-cli-ops.md`.
2. Confirm the target workspace, agent and branch with a redacted read.
3. Dry-run a pull for the exact agent/branch, then import the baseline.
4. Commit the untouched baseline in an approved private history.
5. Create/select an ElevenLabs experiment branch and edit one variable.
6. Add or update tests and run them.
7. Run a targeted push dry-run.
8. Review the redacted diff, target and rollback; require explicit authorization for the real push.
9. Validate the candidate in testers before promotion.

Never use `agents init --override`, an unscoped push, or a remote delete/merge/rebase as a setup or connectivity check.

## Redacted agent and conversation analysis

Run the read-only analyzer from this directory:

```powershell
.\analyze-clara.ps1
```

It resolves the exact `clara-ai` agent, reads its current configuration and the
latest completed conversation, and prints a redacted JSON report. The report
contains configuration signals, role order, response lengths, interruptions,
RAG usage and provider latency metrics. It never includes the system prompt,
transcript text, customer values, credentials or full provider identifiers.

To analyze a known conversation without printing its full identifier:

```powershell
.\analyze-clara.ps1 -ConversationId $conversationId
```

Keep `$conversationId` in the current shell or a secure local secret store. Do
not paste it into committed scripts, logs or documentation.

## Current local credential limitation

The available environment key can read agents but, on 2026-09-11, lacked `user_read`. Its write capability is not proven. This does not establish the permissions of the separate ElevenLabs secret stored by LiveAvatar.
