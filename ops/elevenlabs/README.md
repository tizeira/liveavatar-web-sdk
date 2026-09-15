# Clara ElevenLabs agents-as-code workspace

Initialized with the official ElevenLabs CLI 1.2.0 on 2026-09-11. Raw agent configuration is intentionally not committed: prompts, transcripts, secrets and full provider identifiers stay outside Git.

## QA state verified on 2026-09-15

- `clara-ai-qa` is the agent used only by Vercel Preview/testers.
- Branch `qa-recap-routine-fix-2026-09-15` receives 100% of that QA agent's traffic. Its Main, `qa-routine-tools-2026-09-14` and the older experiment receive 0%.
- The active branch fixes Spanish user-facing summaries, confirmation-plus-farewell routine saves and Shopify-grounded usage claims. Its matching Vercel Preview is deployed at `testers.betaskintech.com`.
- The three targeted branch tests pass: affirmative closure saves, while rejection and ambiguity do not.
- The active QA revision has two server tools, no inherited knowledge base and the compact ordered-consultation prompt validated with synthetic tests.
- `Clara QA post-call` sends JSON transcripts, without audio, to the signed testers endpoint. Delivery retries are enabled.
- The production `clara-ai` agent remains on Main at 100%; its older experiment remains at 0% and it is not associated with the QA webhook.
- The public tool and post-call endpoints reject unsigned/unauthenticated requests with `401`.

Rollback is limited to the QA agent: route 100% back to `qa-routine-tools-2026-09-14` and set `qa-recap-routine-fix-2026-09-15` to 0%. Do not merge branches or change the production agent as part of rollback.

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

## Credential handling

The local CLI session can perform the required scoped QA reads and writes. Its credential remains local and must never be copied into commands, Git, logs or documentation. This does not establish or change the permissions of the separate ElevenLabs secret stored by LiveAvatar.
