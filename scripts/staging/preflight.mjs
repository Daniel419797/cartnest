import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const checks = [];
function record(name, passed, detail) {
  checks.push({ name, passed, detail });
}

async function fileExists(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

const requiredFiles = [
  "pnpm-lock.yaml",
  ".github/workflows/staging.yml",
  ".github/workflows/staging-rollback.yml",
  "deploy/staging/compose.yaml",
  "deploy/staging/compose.release.yaml",
  "deploy/staging/Caddyfile",
  "deploy/staging/staging.env.example",
  "deploy/staging/p12-gate.example.json",
  "deploy/docker/Dockerfile.web",
  "deploy/docker/Dockerfile.api",
  "deploy/docker/Dockerfile.worker",
  "scripts/staging/smoke.mjs",
  "scripts/staging/verify-evidence.mjs",
];
for (const path of requiredFiles) {
  const exists = await fileExists(resolve(path));
  record(
    `file:${path}`,
    exists,
    path === "pnpm-lock.yaml" && !exists
      ? "pnpm-lock.yaml is required because CI and Docker use --frozen-lockfile"
      : "required staging source artifact",
  );
}

for (const command of ["docker", "node", "pnpm", "pg_dump", "pg_restore"]) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  record(
    `command:${command}`,
    result.status === 0,
    result.status === 0 ? (result.stdout || result.stderr).trim().split("\n")[0] : "not executable",
  );
}

const migrationsRoot = resolve("packages/database/prisma/migrations");
const migrationSqlFiles = [];
try {
  const entries = await readdir(migrationsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const migrationSql = resolve(migrationsRoot, entry.name, "migration.sql");
    if (await fileExists(migrationSql)) migrationSqlFiles.push(migrationSql);
  }
} catch {
  // recorded below
}
record(
  "prisma:migration-history",
  migrationSqlFiles.length > 0,
  migrationSqlFiles.length > 0
    ? `${migrationSqlFiles.length} migration SQL file(s) found`
    : "no executable Prisma migration exists yet; P12 clean-migration rehearsal is blocked",
);

const compose = spawnSync(
  "docker",
  ["compose", "-f", "deploy/staging/compose.yaml", "config", "--quiet"],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      STAGING_ENV_FILE: "staging.env.example",
      POSTGRES_PASSWORD: "preflight-only-not-a-secret",
    },
  },
);
record(
  "docker:compose-config",
  compose.status === 0,
  compose.status === 0 ? "staging compose parses" : (compose.stderr || compose.stdout).trim(),
);

const result = {
  schemaVersion: 2,
  exercise: "p12-staging-preflight",
  recordedAt: new Date().toISOString(),
  releaseSha: process.env.RELEASE_SHA ?? process.env.GITHUB_SHA ?? "unknown",
  passed: checks.every((check) => check.passed),
  checks,
};

const evidenceDir = resolve(process.env.P12_EVIDENCE_DIR ?? "artifacts/p12");
await mkdir(evidenceDir, { recursive: true });
const evidenceFile = resolve(evidenceDir, `preflight-${Date.now()}.json`);
await writeFile(evidenceFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log(JSON.stringify(result, null, 2));
console.log(`P12 preflight evidence written to ${evidenceFile}`);
if (!result.passed) process.exitCode = 1;
