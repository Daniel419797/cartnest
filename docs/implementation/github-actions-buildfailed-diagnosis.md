# GitHub Actions `BuildFailed` / `startup_failure` Diagnosis

**Updated:** 6 September 2026

## Observed repository behavior

CartNest Actions events currently generate synthetic workflow runs with this signature:

```text
name: ""
path: BuildFailed
display_title: (Unknown event)
conclusion: startup_failure
jobs: 0
workflow_id: 350634709
```

The behavior occurs on normal pushes and pull-request events. The latest FP10 observations reproduced the same result after changing the committed CI workflow, which means no normal workflow job reached runner allocation.

This is materially different from a command failure inside CI:

```text
workflow parsed
  ↓
job created
  ↓
runner starts
  ↓
install/lint/test/build command fails
```

CartNest currently stops before the `job created` stage.

## Repository-side issue fixed

The real `.github/workflows/ci.yml` previously contained:

```yaml
pull_request:
  branches: [main]
```

That excludes phase-stacked pull requests such as FP9 → FP8 and FP10 → FP9.

The workflow now uses:

```yaml
pull_request:
```

so every pull request is eligible for the real quality workflow once GitHub can dispatch it normally. The same content was propagated through the active FP8, FP9, and FP10 branches so the stacked review chain does not intentionally disable CI.

## Why the remaining blocker is not currently attributed to `ci.yml`

The committed CI workflow has a normal name (`CI`) and path (`.github/workflows/ci.yml`). The failing run metadata instead identifies an empty workflow name and the synthetic path `BuildFailed`.

The failing runs also report zero jobs, so action versions, pnpm installation, Node setup, dependency audit, lint, Prisma, OpenAPI generation, typecheck, tests, and build have not started.

Contemporary GitHub Community reports in 2026 describe the same `BuildFailed` + empty-name + `startup_failure` + zero-job signature for orphaned/deleted workflow registrations or account/repository Actions-side faults. That external evidence is diagnostic context, not proof of the exact GitHub backend state for this private repository.

## Required platform-side follow-up

The remaining Actions blocker should be handled as a GitHub Actions registration/account/repository issue unless GitHub exposes contrary run diagnostics. Useful evidence for GitHub Support includes:

- repository: `Daniel419797/cartnest`;
- synthetic workflow ID: `350634709`;
- run path: `BuildFailed`;
- empty workflow name;
- `startup_failure` conclusion;
- zero jobs/logical runner work;
- reproducible on both push and pull-request events;
- valid committed workflow files remain present under `.github/workflows/`.

Until this is resolved, CartNest must not treat the red Actions status as evidence that any repository quality command failed, and it must not treat the absence of command failures as evidence that those commands passed.
