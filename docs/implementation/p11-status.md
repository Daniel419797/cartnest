# P11 — Hardening, Performance, Security, and NDPR Status

**Phase:** P11  
**Status:** Backend/operations + frontend integration source baselines implemented; runtime security, migration, load, accessibility, provider, and recovery evidence remain pending  
**Updated:** 6 September 2026

## 1. Scope

P11 hardens the P0–P10 marketplace before staging/UAT. Source work now covers both API/operations and browser integration:

- restrictive API security headers;
- web-compatible Next.js CSP/security headers;
- no-store handling for sensitive API and web routes;
- generic unexpected-error redaction;
- privacy/data-subject export;
- account-erasure request/history workflow;
- privileged MFA-gated erasure review/anonymization;
- concurrency-safe privacy processing;
- NDPR-oriented retention/erasure standard;
- privacy-request persistence and PostgreSQL constraints;
- performance/read-path candidate indexes;
- configurable HTTP benchmark harness;
- repository secret scanning and dependency audit gates;
- PostgreSQL backup/restore automation;
- low-bandwidth commerce-image loading hints;
- preservation of keyboard focus/reduced-motion accessibility controls;
- P11 contract/API security coverage.

Detailed frontend evidence is recorded in `docs/implementation/frontend-p11-status.md`.

## 2. API hardening

Production API composition uses `buildHardenedApp`, which applies:

```text
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'
Strict-Transport-Security: max-age=31536000; includeSubDomains   # production only
```

Sensitive `/api/v1/auth`, `/api/v1/privacy`, and `/api/v1/admin` responses receive no-store handling.

Unexpected errors are reduced to bounded classification metadata in logs and generic client envelopes; request bodies, cookies, provider payloads, and nested exception data are not intentionally exposed by the P11 handler.

## 3. Browser hardening

The Next.js application now adds:

- Content-Security-Policy compatible with current Next hydration;
- anti-framing and object restrictions;
- Referrer-Policy;
- X-Content-Type-Options;
- X-Frame-Options;
- Permissions-Policy;
- production HSTS;
- `poweredByHeader: false`;
- Paystack/Flutterwave frame allowances;
- configured API-origin connectivity.

Authenticated/sensitive web route families receive:

```text
Cache-Control: private, no-store, max-age=0
Pragma: no-cache
```

for account, admin, notifications, checkout, orders, returns, and vendor workspaces.

This source policy still requires staging browser verification against OAuth, payment, media, and API traffic before production.

## 4. Secret, dependency, and abuse controls

Root commands include:

```bash
pnpm security:scan
pnpm security:audit
```

The CI definition places secret scanning and high/critical dependency auditing before the normal lint/Prisma/codegen/typecheck/test/build gates.

Existing route-specific authentication abuse controls remain in place, including login/register/reset/verification/TOTP rate limits, CSRF validation, CORS/origin validation, HttpOnly sessions, refresh rotation, and privileged MFA.

A single indiscriminate global rate limit is intentionally not used for every marketplace/provider/webhook route. Staging traffic evidence should determine endpoint/provider tuning.

## 5. Data-subject export

Authenticated users can use:

```text
GET /api/v1/privacy/export
```

The export is no-store and excludes password hashes, session hashes, MFA secrets, provider credentials, and other users' private data.

The source package includes relevant account/contact data, addresses, vendor memberships/permissions, orders/commercial snapshots, reviews, returns, and notification preferences.

The Account workspace now exposes this capability as a downloadable JSON export.

## 6. Account erasure workflow

User endpoints:

```text
POST /api/v1/privacy/erasure-requests
GET  /api/v1/privacy/erasure-requests
```

Admin endpoints:

```text
GET  /api/v1/admin/privacy/erasure-requests
POST /api/v1/admin/privacy/erasure-requests/:privacyRequestId/process
```

The web application now provides:

- user request/history controls under `/account`;
- explicit acknowledgement before erasure submission;
- admin privacy review under `/admin`;
- subject identity on privileged queue records;
- explicit reviewed reason for ANONYMIZE/REJECT;
- destructive-action confirmation before anonymization.

Server role/MFA/blocker checks remain authoritative.

## 7. Erasure safety and concurrency

Anonymization is blocked for:

```text
privileged platform role
active vendor ownership
open orders
open returns
open refunds initiated by the subject
```

Concurrency hardening now includes:

- database partial unique index: one active PENDING/REQUIRES_REVIEW request per user;
- concurrent create conflict (`P2002`) re-read/return behavior rather than a 500;
- compare-and-set admin reject decisions;
- serializable anonymization transaction;
- blocker revalidation inside the destructive transaction;
- compare-and-set anonymization claim;
- Prisma serialization conflict (`P2034`) mapped to 409 state conflict.

This prevents stale admin eligibility from silently erasing against newly changed account obligations.

## 8. Approved anonymization effect

An approved eligible request removes/redacts ordinary identity and authentication material while retaining opaque/pseudonymous commercial references required for integrity.

The transaction removes or redacts:

- AuthIdentity/AuthSession/MFA factors;
- saved addresses;
- wishlist/cart data;
- notification receipts/preferences and recipient/payload data;
- review free text;
- return free-text reasons;
- historical delivery-address snapshots;
- active non-owner staff membership use;
- email/phone/normalized identifiers/password hash/verification timestamps.

The User UUID remains where financial/order/audit relational integrity requires a pseudonymous key. The account is disabled, the request is finalized, and an audit entry is written.

## 9. Retention policy

See:

`docs/security/data-retention-and-erasure-standard.md`

P11 intentionally does not invent statutory retention periods. Before production, Nigerian legal/business review must approve concrete schedules for financial records, KYC, provider events, disputes/refunds, security logs, notifications, backups, and ephemeral data.

## 10. Persistence and query/index review

P11 introduces `PrivacyRequest` persistence plus reviewed raw PostgreSQL source for:

- PrivacyRequest → User FK;
- processedBy → User FK;
- one-active-request partial unique index;
- Order(createdAt DESC);
- VendorOrder(storeId, createdAt DESC);
- Refund(createdAt DESC);
- PaymentIntent(status, createdAt DESC).

These are source candidates until the migration is applied and query plans are measured with realistic staging data.

## 11. Performance and low-bandwidth source work

Root benchmark command:

```bash
pnpm perf:benchmark
```

The harness supports configurable URL/path/method/request count/concurrency/headers/body/idempotency/P95/error budgets.

Frontend low-bandwidth improvements now include lazy loading, async decoding, and low fetch priority for non-critical product/cart/wishlist/gallery images. The active product hero retains high fetch priority for LCP.

The production media CDN/transformation contract is not yet fixed, so FP11 does not hard-code a fragile Next Image remote-host list. Responsive CDN derivatives remain a staging/media-infrastructure optimization once the production hostname/transformation behavior is known.

## 12. Accessibility source review

The existing web baseline already includes:

- global `:focus-visible` treatment;
- form-control focus indication;
- semantic fieldsets/legends on inspected option selectors;
- `prefers-reduced-motion: reduce` handling.

Source review is not equivalent to an accessibility audit. Keyboard, screen-reader, zoom, contrast, and reduced-motion behavior must still be exercised in a real browser.

## 13. Backup and restore automation

Root commands:

```bash
pnpm db:backup
pnpm db:restore
```

Backup uses `pg_dump` custom format without owner/ACL metadata; restore requires `CONFIRM_RESTORE=YES`, uses clean/if-exists/no-owner/no-acl, one transaction, and exits on error.

The scripts are not disaster-recovery evidence. P12 must execute an isolated backup/restore rehearsal and verify business invariants afterward.

## 14. P11 tests/source evidence

Source coverage includes:

- API security headers;
- privacy/auth no-store behavior;
- unexpected-error redaction;
- privacy/OpenAPI route registration;
- authentication before data export;
- privacy pagination/decision contracts;
- privileged admin queue subject identity contract;
- earlier-phase CSRF/session/payment/inventory/refund/provider integrity tests.

No test is claimed executed on this branch while GitHub Actions is still producing synthetic `BuildFailed`/`startup_failure` runs with zero jobs.

## 15. Exit-gate assessment

The plan's P11 gate is:

> No known critical security issue, financial invariant failure, or unrecoverable backup gap remains.

That gate is **not runtime verified** yet because:

- GitHub Actions still creates zero real jobs;
- security/dependency/lint/typecheck/test/build commands therefore lack trusted CI evidence;
- P11 migration/constraint/index SQL has not been exercised against PostgreSQL;
- privacy concurrency behavior lacks real PostgreSQL execution evidence;
- CSP/no-store/payment/OAuth/media behavior lacks browser evidence;
- accessibility and low-bandwidth audits are pending;
- load/query-plan evidence is pending;
- backup/restore rehearsal is pending;
- provider resilience exercises are pending;
- legal retention schedules remain unapproved.

Correct status: **P11 backend + frontend source integration implemented; execution gate pending.**

## 16. Current phase position

```text
P0–P10  feature/source baselines              implemented
P11     hardening/security/performance/NDPR   backend + frontend source integrated

NEXT: P12 staging / UAT / recovery rehearsals
```

P12 must convert source assumptions into environment-backed evidence: migrations, provider sandboxes, security checks, load tests, accessibility/browser QA, backup/restore, runbooks, and UAT.
