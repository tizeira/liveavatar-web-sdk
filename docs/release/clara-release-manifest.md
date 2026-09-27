# Clara release identity manifest

`apps/demo/scripts/preflight-production.mjs` requires `--manifest=<path>` in addition to its existing release evidence. The manifest is an offline JSON attestation: it contains no credentials, URLs with credentials, raw prompts, or remote checks. It is not a cryptographic attestation or an automatic remote configuration audit. Populate `observed` from a fresh independent read; copying `expected` is not evidence.

Use hostname-only values for `deployment.domain` and every `agent.tools[].host`; tool paths must be path-only and each tool needs a unique name and endpoint. All fingerprints and contract hashes are lowercase SHA-256 hex. `expected` and `observed` must match semantically (tool order is irrelevant), `observedAt` must be no more than 24 hours old, and `rollback` must name a different production deployment on the same domain. Preflight binds the deployment domain to `clara.betaskintech.com`.

Minimal shape:

```json
{
  "schemaVersion": 1,
  "expected": {
    "commitSha": "<40-char-sha>",
    "environment": "production",
    "deployment": { "id": "dpl_123", "domain": "clara.betaskintech.com" },
    "databaseFingerprint": "<64-char-sha256>",
    "agent": {
      "branch": "release/clara",
      "versionFingerprint": "<64-char-sha256>",
      "tools": [
        {
          "name": "availability",
          "host": "tools.example.com",
          "path": "/v1/availability",
          "contractHash": "<64-char-sha256>"
        }
      ]
    },
    "catalogueTimestamp": "2026-09-26T11:00:00.000Z"
  },
  "observed": "replace with independently verified identity object",
  "observedAt": "2026-09-26T11:30:00.000Z",
  "rollback": {
    "commitSha": "<previous-40-char-sha>",
    "deploymentId": "dpl_previous",
    "domain": "clara.betaskintech.com",
    "environment": "production"
  }
}
```

The template is intentionally incomplete and blocks until replaced with verified non-secret values. Validate without any network call:

```sh
node apps/demo/scripts/release-manifest.mjs --manifest=release-manifest.json --sha=<current-40-char-sha> --approved-domain=clara.betaskintech.com
```
