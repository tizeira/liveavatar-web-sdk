import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REQUIRED_PRODUCTION_ENV = [
  "BETA_ACCESS_PASSWORD_HASH",
  "BETA_ACCESS_SECRET",
  "CLARA_AGENT_TOOL_SECRET",
  "CRON_SECRET",
  "ELEVENLABS_AGENT_ID",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_WEBHOOK_SECRET",
  "HEYGEN_API_KEY",
  "HEYGEN_ELEVENLABS_SECRET_ID",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
  "SHOPIFY_ADMIN_ACCESS_TOKEN",
  "SHOPIFY_HMAC_SECRET",
  "SHOPIFY_STORE_DOMAIN",
];

const REQUIRED_RUNBOOK_SECTIONS = [
  "## Snapshot de Neon",
  "## Migración Prisma",
  "## Orden de despliegue",
  "## Rollback",
];

const REQUIRED_RELEASE_GATES = [
  "databaseIsolation",
  "providerProductionRouting",
  "shopifyThemeBackup",
  "shopifyProductionRouteReviewed",
  "qaRecovery",
  "neonSnapshot",
  "prismaMigration",
  "previousVercelDeployment",
  "pullRequestChecks",
  "shopifyAccessQa",
  "voicePostCallQa",
  "mobileDesktopQa",
];

function productionEnvironmentNames() {
  const command =
    process.platform === "win32"
      ? [
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            "vercel env ls production --json --no-color",
          ],
        ]
      : ["vercel", ["env", "ls", "production", "--json", "--no-color"]];
  const output = execFileSync(
    command[0],
    command[1],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const jsonLine = output.match(/(?:^|\r?\n)\s*([\[{])/);
  if (jsonLine?.index === undefined) throw new Error("Vercel returned no JSON");
  const jsonStart = jsonLine.index + jsonLine[0].lastIndexOf(jsonLine[1]);
  const parsed = JSON.parse(output.slice(jsonStart));
  const records = Array.isArray(parsed) ? parsed : parsed.envs || [];
  return new Set(
    records
      .map((record) => record.key || record.name)
      .filter((name) => typeof name === "string"),
  );
}

function runbook() {
  return readFileSync(
    fileURLToPath(new URL("../../../docs/release/clara-production-runbook.md", import.meta.url)),
    "utf8",
  );
}

function currentCommitSha() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function releaseEvidence() {
  const argument = process.argv.find((value) => value.startsWith("--evidence="));
  if (!argument) {
    return { errors: ["Pass --evidence=<release-evidence.json>."] };
  }

  try {
    const evidence = JSON.parse(readFileSync(argument.slice("--evidence=".length), "utf8"));
    const errors = [];
    const sha = currentCommitSha();

    if (evidence.commitSha !== sha) {
      errors.push("Release evidence does not match the current commit SHA.");
    }
    if (!evidence.verifiedAt || Number.isNaN(Date.parse(evidence.verifiedAt))) {
      errors.push("Release evidence needs a valid verifiedAt timestamp.");
    }

    const missingGates = REQUIRED_RELEASE_GATES.filter(
      (gate) => evidence.gates?.[gate] !== true,
    );
    if (missingGates.length) {
      errors.push(`Release evidence has pending gates: ${missingGates.join(", ")}`);
    }

    return { errors };
  } catch {
    return { errors: ["Could not read valid JSON release evidence."] };
  }
}

let names;
try {
  names = productionEnvironmentNames();
} catch {
  console.error("Could not read the Production environment variable names.");
  process.exit(1);
}

const missing = REQUIRED_PRODUCTION_ENV.filter((name) => !names.has(name));
if (missing.length) {
  console.error(`Missing Production variables: ${missing.join(", ")}`);
} else {
  console.log("Required Production variable names are present.");
}

const plan = runbook();
const missingSections = REQUIRED_RUNBOOK_SECTIONS.filter(
  (section) => !plan.includes(section),
);
if (missingSections.length) {
  console.error(`Missing runbook sections: ${missingSections.join(", ")}`);
} else {
  console.log("Snapshot, migration, deployment, and rollback plan is documented.");
}

const evidence = releaseEvidence();
if (evidence.errors.length) {
  for (const error of evidence.errors) console.error(error);
} else {
  console.log("Release evidence matches this commit and all required gates are approved.");
}

if (missing.length || missingSections.length || evidence.errors.length) {
  process.exitCode = 1;
}
