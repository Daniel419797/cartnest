# FP11 — Frontend Hardening, Privacy, Security, and Low-Bandwidth Status

**Phase:** FP11  
**Status:** Frontend/source integration implemented; runtime browser, migration, load, security, and recovery evidence pending  
**Updated:** 6 September 2026

## 1. Scope

FP11 integrates the P11 hardening baseline into the user/admin web application rather than leaving privacy and browser security as backend-only capabilities.

Implemented source work now includes:

- authenticated personal-data export UI;
- self-service erasure request/history UI;
- privileged admin erasure review queue;
- typed privacy API client;
- admin privacy response contract that identifies the data subject;
- concurrency-safe erasure request creation;
- concurrency-safe admin reject/anonymize decisions;
- serializable blocker revalidation during destructive anonymization;
- Next.js browser security headers and CSP;
- explicit no-store caching for sensitive web routes;
- provider-neutral low-bandwidth image loading/decoding hints;
- preservation of existing keyboard focus and reduced-motion accessibility controls.

This is a source-complete integration checkpoint, not production certification.

## 2. User privacy center

`/account` now includes a privacy/data-rights section.

Users can:

- request a machine-readable export of their CartNest personal data;
- download the export as JSON on the current device;
- submit an account-erasure request only after explicit acknowledgement;
- view erasure request history and server review notes;
- see when an existing PENDING/REQUIRES_REVIEW request already exists.

The browser does not decide whether erasure is eligible. The API remains authoritative.

## 3. Admin privacy operations

The main `/admin` console now includes a Privacy section.

MFA-satisfied ADMIN/SUPER_ADMIN users can:

- list privacy erasure requests;
- filter by status;
- identify the subject account via `subjectUserId`;
- inspect blocker/review notes;
- record a reviewed rejection reason;
- approve anonymization only after an explicit destructive-action confirmation.

The browser role/MFA checks are UX only. The API service still enforces privileged role and MFA.

## 4. Contract correction

The original admin privacy list reused the user-facing `PrivacyRequestDto`, which intentionally omits user identity. That made the admin queue operationally ambiguous.

FP11 adds a separate privileged response shape:

```text
AdminPrivacyRequestDto
  id
  subjectUserId
  status
  reviewNote
  requestedAt
  processedAt
```

The user-facing privacy response remains identity-minimal.

Contract tests now require `subjectUserId` for admin queue records.

## 5. Erasure concurrency hardening

### Active request creation

The database partial unique index allows only one active PENDING/REQUIRES_REVIEW request per user.

FP11 now handles a concurrent Prisma `P2002` by re-reading and returning the winning active request. Two simultaneous user submissions therefore behave idempotently rather than turning the loser into an internal error.

### Admin decisions

Reject decisions use compare-and-set semantics against the observed active request state.

Anonymization runs in a Prisma interactive transaction with PostgreSQL `Serializable` isolation. Inside that same transaction CartNest:

1. reloads the current request;
2. re-checks erasure blockers;
3. claims the request with compare-and-set semantics;
4. redacts/deletes eligible personal/authentication data;
5. finalizes the PrivacyRequest;
6. writes the audit entry.

Prisma serialization/deadlock conflicts (`P2034`) are mapped to a stable 409 state conflict. A stale admin request cannot silently erase against changed account obligations.

## 6. Browser security baseline

`apps/web/next.config.ts` now emits a web-compatible security baseline:

- Content-Security-Policy;
- `frame-ancestors 'none'`;
- `object-src 'none'`;
- `base-uri 'self'`;
- `form-action 'self'`;
- controlled script/style/connect/image/media/frame sources;
- Paystack/Flutterwave checkout frame allowlist;
- X-Content-Type-Options;
- X-Frame-Options;
- Referrer-Policy;
- Permissions-Policy;
- HSTS in production;
- `poweredByHeader: false`.

The CSP intentionally permits the inline script/style behavior required by the current Next.js application. Moving to a nonce/hash CSP can be evaluated later with browser evidence; FP11 does not apply the API's `default-src 'none'` policy to a hydrated web application.

## 7. Sensitive browser caching

The following route families now receive:

```text
Cache-Control: private, no-store, max-age=0
Pragma: no-cache
```

- `/account/*`
- `/admin/*`
- `/notifications/*`
- `/checkout/*`
- `/orders/*`
- `/returns/*`
- `/vendor/*`

This is defense in depth in addition to API-side no-store controls.

## 8. Low-bandwidth image behavior

CartNest media URLs are provider-managed and may use R2/custom domains, so FP11 does not hard-code an unsafe/brittle Next Image remote-host list.

Instead:

- marketplace product-card images use lazy loading, async decoding, and low fetch priority;
- cart images use lazy loading, async decoding, and low fetch priority;
- wishlist images use lazy loading, async decoding, and low fetch priority;
- product gallery thumbnails use lazy loading/async decoding/low priority;
- the selected product hero stays high fetch priority so LCP is not deliberately degraded.

A future CDN/image-transformation rollout can add responsive derivatives once the production media hostname/transformation contract is fixed and measured.

## 9. Accessibility review

The existing global stylesheet already contains:

- `:focus-visible` keyboard focus indication;
- input/select/textarea focus treatment;
- `prefers-reduced-motion: reduce` handling;
- semantic labels/fieldsets/legends in the inspected commerce surfaces.

FP11 preserves those controls. Browser-level keyboard/screen-reader audit evidence remains a P11/P12 runtime gate.

## 10. Authority boundaries

FP11 does not move sensitive authority into the browser:

- export requires authenticated API access;
- erasure submission remains rate-limited + CSRF-protected server-side;
- admin privacy review remains ADMIN/SUPER_ADMIN + privileged-MFA server-side;
- active order/return/refund/vendor-role blockers remain server-side;
- browser confirmation is only an extra UX guard;
- anonymization transaction/database constraints remain authoritative.

## 11. Source defects corrected during integration

- admin privacy queue could not identify the subject user;
- concurrent reject decisions could duplicate/stale-process a request;
- anonymization eligibility was previously checked outside the destructive transaction;
- concurrent active erasure submissions could surface a unique-index conflict as a server error;
- frontend had no privacy export/erasure workflow;
- frontend had no privileged privacy review surface;
- frontend did not apply browser CSP/security headers;
- authenticated pages did not have an explicit web no-store policy;
- commerce images did not consistently defer non-critical decoding/network work.

## 12. Runtime gates still pending

Do not call FP11 production-certified until there is evidence for:

- a real GitHub Actions runner executing lint/typecheck/tests/build/security audit;
- P11 Prisma migration and raw constraint/index SQL applied to PostgreSQL;
- concurrent erasure request/admin processing tests against PostgreSQL;
- browser verification of CSP with login/OAuth/Paystack/Flutterwave/media flows;
- browser verification that sensitive routes are not cacheable;
- keyboard/screen-reader/accessibility audit;
- low-bandwidth/mobile network performance measurement;
- realistic database `EXPLAIN (ANALYZE, BUFFERS)` evidence;
- load/performance benchmark results against staging;
- dependency/secret scan evidence;
- backup + isolated restore rehearsal;
- retention-period/legal review for Nigerian/NDPR and financial/KYC obligations;
- provider failure/retry resilience exercises.

## 13. Next phase

After FP11 runtime evidence is acceptable, the next implementation phase is:

**FP12 — staging, UAT, migrations, recovery rehearsals, provider sandboxes, and environment-backed evidence.**
