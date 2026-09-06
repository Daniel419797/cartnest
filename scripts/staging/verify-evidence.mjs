import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const gateFile = resolve(process.env.P12_GATE_FILE ?? "artifacts/p12/gate.json");
const expectedReleaseSha = process.env.RELEASE_SHA ?? process.env.GITHUB_SHA;

const REQUIRED_EXERCISES = Object.freeze([
  "ci-deploy",
  "clean-migration",
  "upgrade-migration",
  "rollback",
  "backup-restore",
  "reservation-expiry",
  "paystack-lifecycle",
  "flutterwave-lifecycle",
  "gigl-sandbox",
  "r2-lifecycle",
  "admin-mfa-recovery",
  "provider-outage",
  "worker-dead-letter",
  "load-test",
  "buyer-uat",
  "vendor-uat",
  "admin-uat",
  "security-privacy",
]);

const WAIVABLE_EXERCISES = new Set(["upgrade-migration", "gigl-sandbox"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function fail(errors, message) {
  errors.push(message);
}

let document;
try {
  document = JSON.parse(await readFile(gateFile, "utf8"));
} catch (error) {
  console.error(JSON.stringify({
    schemaVersion: 1,
    exercise: "p12-evidence-gate",
    passed: false,
    gateFile,
    errors: [`Could not read/parse gate file: ${error instanceof Error ? error.message : String(error)}`],
  }, null, 2));
  process.exit(1);
}

const errors = [];
if (document?.schemaVersion !== 1) fail(errors, "gate schemaVersion must be 1");
if (!isNonEmptyString(document?.releaseSha) || document.releaseSha === "unknown") {
  fail(errors, "releaseSha must identify the exact rehearsed release");
}
if (expectedReleaseSha && document?.releaseSha !== expectedReleaseSha) {
  fail(errors, `releaseSha ${document?.releaseSha ?? "<missing>"} does not match expected ${expectedReleaseSha}`);
}
if (!Array.isArray(document?.blockers)) fail(errors, "blockers must be an array");
else if (document.blockers.length > 0) fail(errors, `${document.blockers.length} unresolved blocker(s) remain`);

const exercises = Array.isArray(document?.exercises) ? document.exercises : [];
if (!Array.isArray(document?.exercises)) fail(errors, "exercises must be an array");

const byId = new Map();
for (const exercise of exercises) {
  if (!isNonEmptyString(exercise?.id)) {
    fail(errors, "every exercise requires a non-empty id");
    continue;
  }
  if (byId.has(exercise.id)) {
    fail(errors, `duplicate exercise id: ${exercise.id}`);
    continue;
  }
  byId.set(exercise.id, exercise);
}

for (const id of REQUIRED_EXERCISES) {
  const exercise = byId.get(id);
  if (!exercise) {
    fail(errors, `missing required exercise: ${id}`);
    continue;
  }

  if (exercise.status === "PASS") {
    if (!Array.isArray(exercise.evidenceRefs) || exercise.evidenceRefs.length === 0 || !exercise.evidenceRefs.every(isNonEmptyString)) {
      fail(errors, `${id}: PASS requires at least one concrete evidenceRefs entry`);
    }
    continue;
  }

  if (exercise.status === "WAIVED") {
    if (!WAIVABLE_EXERCISES.has(id)) {
      fail(errors, `${id}: this launch gate cannot be waived`);
      continue;
    }
    if (!isNonEmptyString(exercise.waiverReason) || exercise.waiverReason.trim().length < 20) {
      fail(errors, `${id}: WAIVED requires a specific waiverReason of at least 20 characters`);
    }
    if (!isNonEmptyString(exercise.waiverApprovedBy)) {
      fail(errors, `${id}: WAIVED requires waiverApprovedBy`);
    }
    if (!Array.isArray(exercise.evidenceRefs) || exercise.evidenceRefs.length === 0 || !exercise.evidenceRefs.every(isNonEmptyString)) {
      fail(errors, `${id}: WAIVED still requires evidenceRefs documenting the provider/first-release constraint`);
    }
    continue;
  }

  fail(errors, `${id}: status must be PASS${WAIVABLE_EXERCISES.has(id) ? " or WAIVED" : ""}, received ${String(exercise.status ?? "<missing>")}`);
}

const decision = document?.decision;
if (decision?.exitGate !== "PASS") fail(errors, "decision.exitGate must be PASS");
if (decision?.eligibleForP13 !== true) fail(errors, "decision.eligibleForP13 must be true");
if (!Array.isArray(decision?.approvedBy) || decision.approvedBy.length === 0 || !decision.approvedBy.every(isNonEmptyString)) {
  fail(errors, "decision.approvedBy must contain at least one approver");
}
if (!isNonEmptyString(decision?.approvedAt) || Number.isNaN(Date.parse(decision.approvedAt))) {
  fail(errors, "decision.approvedAt must be a valid timestamp");
}

const result = {
  schemaVersion: 1,
  exercise: "p12-evidence-gate",
  recordedAt: new Date().toISOString(),
  releaseSha: document?.releaseSha ?? null,
  gateFile,
  requiredExerciseCount: REQUIRED_EXERCISES.length,
  passed: errors.length === 0,
  errors,
};

console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
