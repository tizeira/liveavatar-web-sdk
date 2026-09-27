import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MAX_OBSERVED_AGE_MS = 24 * 60 * 60 * 1000;

const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const HOST =
  /^(?=.{1,253}$)(?!-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.(?!-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const BRANCH = /^[a-z0-9][a-z0-9._/-]{0,127}$/;
const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const TOOL_PATH = /^\/(?:[a-z0-9._~-]+(?:\/[a-z0-9._~-]+)*)?$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SECRET_URL =
  /(?:https?|wss?):\/\/[^/\s@]*@|[?&](?:access_token|api[_-]?key|password|secret|token)=/i;

const identityKeys = [
  "commitSha",
  "environment",
  "deployment",
  "databaseFingerprint",
  "agent",
  "catalogueTimestamp",
];

function fail(code) {
  throw new Error(`RELEASE_MANIFEST_${code}`);
}

function object(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(`${code}_FIELDS`);
  }
}

function timestamp(value, code) {
  if (
    typeof value !== "string" ||
    !TIMESTAMP.test(value) ||
    Number.isNaN(Date.parse(value))
  )
    fail(code);
  return Date.parse(value);
}

function containsSecretUrl(value) {
  if (typeof value === "string") return SECRET_URL.test(value);
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(containsSecretUrl);
}

function validateIdentity(identity, code) {
  object(identity, identityKeys, code);
  if (typeof identity.commitSha !== "string" || !SHA.test(identity.commitSha))
    fail(`${code}_SHA`);
  if (identity.environment !== "production") fail(`${code}_ENVIRONMENT`);
  object(identity.deployment, ["domain", "id"], `${code}_DEPLOYMENT`);
  if (
    typeof identity.deployment.id !== "string" ||
    !ID.test(identity.deployment.id)
  )
    fail(`${code}_DEPLOYMENT_ID`);
  if (
    typeof identity.deployment.domain !== "string" ||
    !HOST.test(identity.deployment.domain)
  )
    fail(`${code}_DOMAIN`);
  if (
    typeof identity.databaseFingerprint !== "string" ||
    !HASH.test(identity.databaseFingerprint)
  )
    fail(`${code}_DATABASE`);
  object(
    identity.agent,
    ["branch", "tools", "versionFingerprint"],
    `${code}_AGENT`,
  );
  if (
    typeof identity.agent.branch !== "string" ||
    !BRANCH.test(identity.agent.branch)
  )
    fail(`${code}_AGENT_BRANCH`);
  if (
    typeof identity.agent.versionFingerprint !== "string" ||
    !HASH.test(identity.agent.versionFingerprint)
  )
    fail(`${code}_AGENT_VERSION`);
  if (!Array.isArray(identity.agent.tools) || identity.agent.tools.length === 0)
    fail(`${code}_TOOLS`);
  const names = new Set();
  const endpoints = new Set();
  for (const tool of identity.agent.tools) {
    object(tool, ["contractHash", "host", "name", "path"], `${code}_TOOL`);
    if (typeof tool.name !== "string" || !ID.test(tool.name))
      fail(`${code}_TOOL_NAME`);
    if (typeof tool.host !== "string" || !HOST.test(tool.host))
      fail(`${code}_TOOL_HOST`);
    if (typeof tool.path !== "string" || !TOOL_PATH.test(tool.path))
      fail(`${code}_TOOL_PATH`);
    if (typeof tool.contractHash !== "string" || !HASH.test(tool.contractHash))
      fail(`${code}_TOOL_CONTRACT`);
    if (names.has(tool.name) || endpoints.has(`${tool.host}\n${tool.path}`))
      fail(`${code}_TOOL_DUPLICATE`);
    names.add(tool.name);
    endpoints.add(`${tool.host}\n${tool.path}`);
  }
  timestamp(identity.catalogueTimestamp, `${code}_CATALOGUE_TIMESTAMP`);
}

function sameIdentity(expected, observed) {
  const normalize = (identity) => ({
    commitSha: identity.commitSha,
    environment: identity.environment,
    deployment: {
      id: identity.deployment.id,
      domain: identity.deployment.domain,
    },
    databaseFingerprint: identity.databaseFingerprint,
    agent: {
      branch: identity.agent.branch,
      versionFingerprint: identity.agent.versionFingerprint,
      tools: [...identity.agent.tools]
        .map((tool) => ({
          name: tool.name,
          host: tool.host,
          path: tool.path,
          contractHash: tool.contractHash,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    },
    catalogueTimestamp: identity.catalogueTimestamp,
  });
  return (
    JSON.stringify(normalize(expected)) === JSON.stringify(normalize(observed))
  );
}

export function validateReleaseManifest(
  manifest,
  { currentSha, approvedDomain, now = Date.now() } = {},
) {
  object(
    manifest,
    ["expected", "observed", "observedAt", "rollback", "schemaVersion"],
    "ROOT",
  );
  if (manifest.schemaVersion !== 1) fail("SCHEMA_VERSION");
  if (containsSecretUrl(manifest)) fail("SECRET_URL");
  validateIdentity(manifest.expected, "EXPECTED");
  validateIdentity(manifest.observed, "OBSERVED");
  if (
    typeof approvedDomain !== "string" ||
    !HOST.test(approvedDomain) ||
    manifest.expected.deployment.domain !== approvedDomain
  )
    fail("APPROVED_DOMAIN_MISMATCH");
  const observedAt = timestamp(manifest.observedAt, "OBSERVED_AT");
  if (
    observedAt > now + 5 * 60 * 1000 ||
    now - observedAt > MAX_OBSERVED_AGE_MS
  )
    fail("OBSERVED_STALE");
  if (!sameIdentity(manifest.expected, manifest.observed))
    fail("IDENTITY_MISMATCH");
  if (
    typeof currentSha !== "string" ||
    !SHA.test(currentSha) ||
    manifest.expected.commitSha !== currentSha
  )
    fail("CURRENT_SHA_MISMATCH");
  object(
    manifest.rollback,
    ["commitSha", "deploymentId", "domain", "environment"],
    "ROLLBACK",
  );
  if (
    manifest.rollback.environment !== "production" ||
    manifest.rollback.domain !== manifest.expected.deployment.domain
  )
    fail("ROLLBACK_INCOMPATIBLE");
  if (
    typeof manifest.rollback.commitSha !== "string" ||
    !SHA.test(manifest.rollback.commitSha)
  )
    fail("ROLLBACK_SHA");
  if (
    typeof manifest.rollback.deploymentId !== "string" ||
    !ID.test(manifest.rollback.deploymentId)
  )
    fail("ROLLBACK_DEPLOYMENT");
  if (manifest.rollback.deploymentId === manifest.expected.deployment.id)
    fail("ROLLBACK_DEPLOYMENT");
  return manifest;
}

export function readReleaseManifest(path, options) {
  try {
    return validateReleaseManifest(
      JSON.parse(readFileSync(path, "utf8")),
      options,
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("RELEASE_MANIFEST_"))
      throw error;
    fail("INVALID_JSON");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const manifestArg = process.argv.find((value) =>
    value.startsWith("--manifest="),
  );
  const shaArg = process.argv.find((value) => value.startsWith("--sha="));
  const domainArg = process.argv.find((value) =>
    value.startsWith("--approved-domain="),
  );
  try {
    if (!manifestArg || !shaArg || !domainArg) fail("ARGUMENT_REQUIRED");
    readReleaseManifest(manifestArg.slice("--manifest=".length), {
      currentSha: shaArg.slice("--sha=".length),
      approvedDomain: domainArg.slice("--approved-domain=".length),
    });
    console.log("Release manifest is valid.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
