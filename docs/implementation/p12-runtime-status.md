# P12 Runtime Integration Status

**Phase:** FP12 / P12  
**Branch:** `feat/fp12-worker-outbox-runtime`  
**Status:** Rehearsal and worker source hardened; runtime exit gate remains unverified  
**Updated:** 7 September 2026

## 1. Position

P12 remains an evidence phase. Source code can prepare deployment, recovery, worker, and sign-off mechanics, but P12 does not pass until those mechanics are executed against a production-like staging environment and the resulting evidence is accepted.

The staging/recovery harness from PR #8 is already merged into the current FP11 base. This branch adds the first durable worker runtime baseline. Runtime certification is still blocked because GitHub Actions creates zero jobs and the repository lacks both a committed pnpm lockfile and executable Prisma migration history.

## 2. Staging and release hardening already present

The merged FP12 staging baseline provides:

- immutable SHA-tagged web/API/worker images;
- candidate versus last-known-good release semantics;
- promotion to `/opt/cartnest/current` only after staging smoke succeeds;
- a non-secret per-release SHA/image manifest;
- a staging-only application rollback workflow;
- sanitized P12 preflight and smoke artifacts;
- browser/API security-header and `no-store` smoke assertions;
- `pnpm p12:gate` for machine-checkable phase sign-off.

## 3. Durable worker source baseline

`apps/worker` is no longer only a heartbeat process.

```text
PostgreSQL OutboxEvent
        |
        | FOR UPDATE SKIP LOCKED
        v
OutboxDispatcher
        |
        | eventId -> BullMQ jobId
        v
Redis / BullMQ
   |             |
notifications  maintenance
   |             |
materialize    expire HELD reservations
notifications  transactionally
```

### Worker configuration

The worker requires explicit:

```text
DATABASE_URL
REDIS_URL
```

and bounded settings for queue prefix, outbox polling/batch size/max attempts/lease timeout, and maintenance interval.

### Outbox lease and retry model

The dispatcher:

1. selects eligible PENDING/FAILED events whose retry time has arrived;
2. reclaims stale PROCESSING events only while attempts remain;
3. uses `FOR UPDATE SKIP LOCKED` for concurrent dispatchers;
4. counts each stale reclaim as a new dispatch attempt;
5. stamps an exact `lockedAt` lease;
6. includes that lease timestamp in publish/failure compare-and-set transitions;
7. prevents a superseded lease owner from finalizing another dispatcher's work;
8. converts an expired stale lease that has already exhausted the maximum attempts to FAILED/dead-letter instead of leaving it stuck in PROCESSING or reclaiming it indefinitely.

For supported event version 1:

- BullMQ job identity reuses the durable outbox event ID;
- retryable publication failures use bounded backoff;
- exhausted work remains visible as FAILED;
- unsupported event versions fail closed;
- valid domain facts with no active asynchronous subscriber do not become false dead letters;
- crash-after-enqueue recovery reuses the same job ID, while consumer-side business effects remain idempotent.

### Write-side event audit

Critical flows already persist durable outbox facts in the same transaction as business state:

- `order.created`;
- `payment.succeeded`;
- `refund.succeeded`;
- `return.status_changed`;
- shipment status events.

Logistics emits `shipment.status_changed`. A status payload of `DELIVERED` is normalized during dispatch to the notification consumer's `shipment.delivered` event name.

### Notification consumer

The notifications worker materializes CartNest notification rules for order creation, payment success, shipment delivery, refund success, and return status changes.

Notification rows remain idempotent through existing `dedupeKey` uniqueness/upsert behavior. IN_APP rows become delivered immediately. EMAIL/SMS rows remain provider-neutral QUEUED records; real delivery providers remain an open runtime requirement.

### Reservation-expiry maintenance

`inventory.reservations.expire`:

- claims expired HELD reservations with `FOR UPDATE SKIP LOCKED`;
- changes each selected reservation to EXPIRED once;
- aggregates released quantities per variant;
- decrements `InventoryItem.reserved` transactionally;
- increments inventory version;
- fails rather than clamping on reserved-stock invariant mismatch;
- writes a SYSTEM audit record.

PostgreSQL remains authoritative, so a missed timer interval does not lose expiry work.

### Controlled dead-letter replay

The built worker exposes:

```bash
pnpm --filter @cartnest/worker outbox:replay -- <outbox-event-id>
```

Only FAILED events can be reset. Replay uses a compare-and-set update and SYSTEM audit record.

Payment/refund replay is denied unless the operator additionally provides:

```text
WORKER_FINANCIAL_REPLAY_CONFIRM=REVIEWED_FINANCIAL_REPLAY
```

### Graceful shutdown and boundaries

SIGINT/SIGTERM stops new polling/scheduling, drains active BullMQ jobs, closes queue connections, and disconnects PostgreSQL.

The architecture boundary checker now prevents `apps/worker` from importing private `apps/api` or `apps/web` modules; worker behavior uses shared config/database boundaries instead.

## 4. Reproducibility blocker: no pnpm lockfile

The repository currently has no root `pnpm-lock.yaml`.

This is launch-blocking because staging CI and Dockerfiles use `pnpm install --frozen-lockfile`, and BullMQ is now a declared worker dependency.

`pnpm p12:preflight` explicitly checks for the lockfile and fails when it is absent. The lockfile must be generated by pnpm in a trusted network-enabled environment and must not be hand-written.

## 5. Executable Prisma migration history is still missing

`packages/database/prisma/migrations/` still lacks a reviewed versioned `migration.sql` history.

This blocks clean/upgrade migration evidence, migration-backed restore verification, and production-like staging deployment.

## 6. Worker work still open

The source baseline closes the heartbeat-only gap, but production completion still requires:

- generate/review/commit `pnpm-lock.yaml` containing BullMQ 6.3.4 and transitive dependencies;
- execute worker install/lint/typecheck/tests/build;
- real PostgreSQL concurrent-dispatch and reservation-expiry tests;
- Redis/BullMQ crash-after-enqueue and Redis-loss tests;
- real EMAIL/SMS provider delivery workers;
- payment reconciliation worker path;
- refund reconciliation scheduling where required;
- GIGL tracking-sync worker wiring;
- remaining session/idempotency/media maintenance jobs;
- dead-letter/replay staging rehearsal;
- queue latency/failure/oldest-work metrics and alert integration.

Payment/logistics/analytics queue names remain placeholders only; durable events are not routed into a queue until a real processor exists.

## 7. CI/runtime evidence

The exact PR #10 worker head again produced the repository-wide synthetic GitHub Actions `startup_failure` condition with zero jobs.

Therefore no claim is made that dependency install, lint, Prisma generation, typecheck, tests, build, Docker image build, or Redis/PostgreSQL integration execution passed or failed.

## 8. Exit-gate position

```text
FP12 source baseline
      |
      +-- pnpm-lock.yaml
      +-- real Prisma migration
      +-- remaining worker processors/providers
      +-- trusted executable CI/staging path
      v
production-like staging
      v
recovery/provider/load/UAT evidence
      v
pnpm p12:gate
      v
P13 only after evidence-backed PASS
```

FP12 is **not passed** at this checkpoint.
