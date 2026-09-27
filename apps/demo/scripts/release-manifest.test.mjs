import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  MAX_OBSERVED_AGE_MS,
  validateReleaseManifest,
} from "./release-manifest.mjs";

const sha = "a".repeat(40);
const previousSha = "b".repeat(40);
const hash = "c".repeat(64);
const now = Date.parse("2026-09-26T12:00:00.000Z");
const identity = {
  commitSha: sha,
  environment: "production",
  deployment: { id: "dpl_123", domain: "clara.example.com" },
  databaseFingerprint: hash,
  agent: {
    branch: "release/clara",
    versionFingerprint: hash,
    tools: [
      {
        name: "availability",
        host: "tools.example.com",
        path: "/v1/availability",
        contractHash: hash,
      },
    ],
  },
  catalogueTimestamp: "2026-09-26T11:00:00.000Z",
};
const valid = () => ({
  schemaVersion: 1,
  expected: structuredClone(identity),
  observed: structuredClone(identity),
  observedAt: "2026-09-26T11:30:00.000Z",
  rollback: {
    commitSha: previousSha,
    deploymentId: "dpl_previous",
    domain: "clara.example.com",
    environment: "production",
  },
});

const options = { currentSha: sha, approvedDomain: "clara.example.com", now };
test("accepts a complete, matching manifest", () =>
  assert.doesNotThrow(() => validateReleaseManifest(valid(), options)));
test("rejects missing and unknown fields", () => {
  const missing = valid();
  delete missing.expected.databaseFingerprint;
  assert.throws(
    () => validateReleaseManifest(missing, options),
    /EXPECTED_FIELDS/,
  );
  const unknown = valid();
  unknown.apiKey = "not-allowed";
  assert.throws(() => validateReleaseManifest(unknown, options), /ROOT_FIELDS/);
});
test("rejects stale observations and current SHA mismatch", () => {
  const stale = valid();
  stale.observedAt = new Date(now - MAX_OBSERVED_AGE_MS - 1).toISOString();
  assert.throws(
    () => validateReleaseManifest(stale, options),
    /OBSERVED_STALE/,
  );
  assert.throws(
    () =>
      validateReleaseManifest(valid(), { ...options, currentSha: previousSha }),
    /CURRENT_SHA_MISMATCH/,
  );
});
test("rejects domain, database, tool-host, and expected-observed mismatches", () => {
  for (const mutate of [
    (manifest) => {
      manifest.expected.deployment.domain = "https://clara.example.com";
    },
    (manifest) => {
      manifest.expected.databaseFingerprint = "not-a-fingerprint";
    },
    (manifest) => {
      manifest.expected.agent.tools[0].host = "https://tools.example.com";
    },
    (manifest) => {
      manifest.observed.deployment.id = "dpl_other";
    },
  ]) {
    const manifest = valid();
    mutate(manifest);
    assert.throws(
      () => validateReleaseManifest(manifest, options),
      /RELEASE_MANIFEST_/,
    );
  }
});
test("rejects secret-bearing URLs", () => {
  const manifest = valid();
  manifest.expected.agent.branch = "https://user:password@tools.example.com";
  assert.throws(() => validateReleaseManifest(manifest, options), /SECRET_URL/);
});
test("compares identities independent of object and tool order", () => {
  const manifest = valid();
  manifest.expected.agent.tools.push({
    name: "products",
    host: "tools.example.com",
    path: "/v1/products",
    contractHash: "d".repeat(64),
  });
  manifest.observed.agent.tools = [...manifest.expected.agent.tools].reverse();
  assert.doesNotThrow(() => validateReleaseManifest(manifest, options));
});
test("rejects unapproved domains, duplicate tools, and unsafe tool paths", () => {
  assert.throws(
    () =>
      validateReleaseManifest(valid(), {
        ...options,
        approvedDomain: "testers.betaskintech.com",
      }),
    /APPROVED_DOMAIN_MISMATCH/,
  );
  const duplicate = valid();
  duplicate.expected.agent.tools.push({
    ...duplicate.expected.agent.tools[0],
    path: "/v1/other",
  });
  assert.throws(
    () => validateReleaseManifest(duplicate, options),
    /TOOL_DUPLICATE/,
  );
  const unsafe = valid();
  unsafe.expected.agent.tools[0].path = "/v1/availability?token=secret";
  assert.throws(() => validateReleaseManifest(unsafe, options), /SECRET_URL/);
});
test("allows a same-SHA prior redeploy but rejects its current deployment", () => {
  const redeploy = valid();
  redeploy.rollback.commitSha = sha;
  assert.doesNotThrow(() => validateReleaseManifest(redeploy, options));
  const sameDeployment = valid();
  sameDeployment.rollback.deploymentId = sameDeployment.expected.deployment.id;
  assert.throws(
    () => validateReleaseManifest(sameDeployment, options),
    /ROLLBACK_DEPLOYMENT/,
  );
});
test("CLI fails closed when its required manifest argument is absent", () =>
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          fileURLToPath(new URL("./release-manifest.mjs", import.meta.url)),
          `--sha=${sha}`,
        ],
        { stdio: "pipe" },
      ),
    /Command failed/,
  ));
test("production preflight rejects a missing manifest before remote inspection", () => {
  let error;
  try {
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL("./preflight-production.mjs", import.meta.url))],
      { cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "pipe" },
    );
  } catch (caught) {
    error = caught;
  }
  assert.ok(error);
  assert.match(
    error.stderr.toString(),
    /Pass --manifest=<release-manifest\.json>\./,
  );
  assert.doesNotMatch(
    error.stderr.toString(),
    /Could not read the Production environment variable names/,
  );
});
