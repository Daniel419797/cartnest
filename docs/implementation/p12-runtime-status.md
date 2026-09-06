# P12 Runtime Integration Status

**Phase:** FP12 / P12  
**Branch:** `feat/fp12-staging-uat-recovery-runtime`  
**Status:** Rehearsal/evidence source hardened; runtime exit gate remains unverified  
**Updated:** 6 September 2026

## Implemented in this integration pass

### Immutable release quality gate

`.github/workflows/staging.yml` now installs with:

```bash
pnpm install --frozen-lockfile
```

A staging deployment must therefore use the committed dependency graph rather than mutating the lockfile during the release job.

### Candidate versus last-known-good release state

A release is no longer recorded as `/opt/cartnest/current` before smoke verification.

The staging host now uses:

```text
/opt/cartnest/candidate   -> deployed but not yet smoke-passed
/opt/cartnest/current     -> last smoke-passed release
/opt/cartnest/state/last-good.env
                          -> non-secret SHA/image/release metadata
```

Each deployed release also receives a private-permission `.release.env` containing only:

- exact Git SHA;
- release directory;
- web image tag;
- API image tag;
- worker image tag.

No application/provider/database secrets are written into that release manifest.

After `pnpm p12:smoke` passes, the workflow promotes the candidate to `current` and refreshes `last-good.env`. A failed smoke run does not promote the candidate.

### Rehearsable application rollback

`.github/workflows/staging-rollback.yml` adds an explicit staging-only application rollback workflow.

It requires a full 40-character Git SHA and will only restore a previously deployed release that has its checked-in release composition plus generated `.release.env` metadata on the staging host.

The rollback procedure deliberately does **not** reverse database migrations. It restores web/API/worker images only, consistent with the P12 expand/contract compatibility rule. The rollback target is promoted only after the same staging smoke gate succeeds.

### Stronger staging smoke evidence

`scripts/staging/smoke.mjs` now records sanitized structural response summaries instead of response bodies.

The smoke path covers:

- web home;
- web health;
- sensitive `/account` response;
- API health/readiness;
- system info;
- category/catalog public reads;
- unauthenticated privacy-export boundary.

The evidence now verifies:

- API `nosniff`;
- API anti-framing;
- API restricted referrer policy;
- API HSTS;
- privacy API `no-store`;
- web `nosniff`;
- web anti-framing;
- web referrer policy;
- web HSTS;
- browser CSP presence;
- CSP `frame-ancestors 'none'`;
- sensitive web `no-store` behavior.

Evidence is written under `artifacts/p12/` and contains no cookies, tokens, credentials, or full response payloads.

### Durable preflight evidence

`pnpm p12:preflight` now also writes a sanitized JSON artifact under `artifacts/p12/`.

Preflight source requirements now include:

- release and self-contained staging Compose files;
- normal staging workflow;
- rollback workflow;
- staging Caddy configuration;
- Dockerfiles;
- evidence-gate example;
- smoke runner;
- evidence verifier.

It continues to fail closed when no executable Prisma `migration.sql` history exists.

### Machine-checkable P12 sign-off gate

New command:

```bash
pnpm p12:gate
```

Default gate input:

```text
artifacts/p12/gate.json
```

A non-passing template is committed at:

```text
deploy/staging/p12-gate.example.json
```

The gate requires evidence for:

- CI deployment;
- clean migration;
- upgrade migration;
- rollback;
- backup/restore;
- reservation expiry;
- Paystack lifecycle;
- Flutterwave lifecycle;
- GIGL sandbox/provider constraint;
- R2 lifecycle;
- admin MFA recovery;
- provider outage;
- worker/dead-letter;
- load test;
- buyer UAT;
- vendor UAT;
- admin UAT;
- security/privacy verification.

A `PASS` exercise requires at least one concrete evidence reference.

Only these exercises may be `WAIVED`:

```text
upgrade-migration   # first release where no prior staging release exists
gigl-sandbox        # only when provider contract/sandbox availability is documented
```

A waiver still requires:

- a specific reason;
- an approver;
- evidence references documenting the constraint.

The overall gate also requires:

- exact release SHA;
- no unresolved blockers;
- explicit `decision.exitGate = PASS`;
- `decision.eligibleForP13 = true`;
- at least one named approver;
- a valid approval timestamp.

## Important findings retained as blockers

### 1. Executable Prisma migration history still does not exist

`packages/database/prisma/migrations/` still lacks a real versioned `migration.sql` directory.

This blocks honest evidence for:

- clean migration;
- upgrade migration;
- migration-backed restore verification;
- staging release migration execution.

The migration must be generated from the complete schema in a trusted executable PostgreSQL/Prisma environment, reviewed with the required raw PostgreSQL constraints/indexes, exercised, and then committed. FP12 must not manufacture a hand-written baseline merely to satisfy the gate.

### 2. GitHub Actions still fails before job creation

The repository-wide synthetic `startup_failure` / zero-job problem remains external to the individual source commands.

Until a real runner job starts, there is no CI evidence for:

- install;
- secret/dependency audit;
- lint;
- Prisma validation/generation;
- OpenAPI/client generation;
- typecheck;
- tests;
- build;
- Docker image build;
- staging deployment or rollback workflow execution.

### 3. Worker durable queue/dead-letter runtime remains incomplete

`apps/worker` is still a process/heartbeat foundation. The accepted architecture requires PostgreSQL transactional outbox + Redis + BullMQ consumers, retries, dead-letter visibility, replay, and scheduled maintenance jobs.

This branch does not fake that requirement with an in-memory timer or browser retry loop. `worker-dead-letter` therefore remains a launch-blocking P12 exercise until the durable worker runtime and its lockfile-reviewed dependencies are implemented and exercised.

### 4. Live staging/provider evidence remains environment-dependent

No source commit can prove:

- Paystack test lifecycle;
- Flutterwave test lifecycle;
- GIGL contracted sandbox behavior;
- R2 object lifecycle;
- OAuth staging behavior;
- PostgreSQL restore timing;
- production-like load behavior;
- real accessibility/UAT sessions.

Those remain execution tasks against provisioned staging infrastructure and test-provider credentials.

## Exit-gate position

The repository now has a stronger **evidence contract** and safer release/rollback semantics, but P12 is still **not passed**.

The next valid transition is:

```text
source-prepared FP12
      ↓
real executable migration + real CI/staging host
      ↓
execute rehearsal matrix
      ↓
collect artifacts/p12 evidence
      ↓
pnpm p12:gate
      ↓
PASS only with evidence
      ↓
P13 launch preparation
```
