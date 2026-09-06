# FP10 — Admin, Analytics, Promotions, Tax, and Notifications Frontend Status

**Phase:** FP10  
**Status:** Frontend/API-integration source baseline implemented; runtime, migration, provider, and browser evidence still pending  
**Updated:** 6 September 2026

## 1. Scope completed in source

FP10 now integrates the existing P10 backend/domain baseline into the Next.js application and shared typed API client.

Implemented source surfaces:

- typed admin API client;
- typed notification API client;
- platform admin operations console;
- platform analytics overview;
- unified order/payment/refund/shipment/return operations view;
- tax policy creation and activation controls;
- promotion creation and status controls;
- user in-app notification inbox;
- user notification preference controls;
- admin notification operations/retry queue;
- vendor/store analytics workspace;
- global navigation to notifications and the main admin console.

The browser does not make authorization decisions. ADMIN/SUPER_ADMIN role, privileged MFA, vendor ownership, store membership, and `analytics:read` remain server-authoritative.

## 2. Shared typed clients

New client modules:

```text
packages/api-client/src/admin.ts
packages/api-client/src/notifications.ts
```

`apps/web/lib/api.ts` exposes:

```text
adminApi
notificationsApi
```

Both use the existing `ContractRequestClient`, preserving cookie credentials and the centralized CSRF header behavior for mutations.

The P10 contract module was corrected to export DTO aliases for admin user/order/payment/refund list responses rather than forcing frontend-local response shapes.

## 3. Admin console

Route:

```text
/admin
```

The console requires:

```text
authenticated session
        ↓
ADMIN or SUPER_ADMIN
        ↓
privileged MFA satisfied
        ↓
FP10 admin surface
```

It contains four operational views.

### Overview

Displays server-calculated:

- users;
- approved vendors;
- active stores;
- active products;
- orders;
- paid orders;
- gross merchandise value;
- refunded value;
- pending returns;
- failed notifications;
- recent users/orders/payments/refunds.

An optional date range is passed to the existing analytics endpoint. Financial data is always rendered from integer-minor-unit `Money` DTOs.

### Order operations

The admin can select an order and load:

```text
GET /api/v1/admin/orders/:orderId/operations
```

The UI exposes the P10 exit-gate evidence in one view:

- parent order state and financial totals;
- store/vendor order slices;
- commission and gateway-fee snapshots;
- payment intents and provider attempts;
- payment allocations;
- refunds;
- shipments;
- return requests.

No direct database access is required.

### Tax and promotions

Tax creation supports a human percentage input converted to basis points before the typed request is sent. Activation/deactivation remains server-transactional and audited.

Promotion creation supports:

- percentage or fixed amount;
- normalized code handling;
- minimum order value;
- global redemption limit;
- per-user redemption limit;
- start/end time;
- initial status;
- later status changes.

The UI converts Naira amounts to integer minor units and percentages to basis points. Checkout remains authoritative for promotion/tax applicability and concurrent redemption safety.

### Notification operations

The admin view can filter operational notifications by channel/status and queue a retry only for eligible external-channel records.

`IN_APP` delivery cannot be retried through a provider control.

## 4. User notification center

Route:

```text
/notifications
```

Implemented:

- all/unread in-app views;
- read timestamps;
- mark-as-read mutation;
- wildcard optional-channel preferences;
- email/in-app optional notices default enabled when no preference exists;
- SMS optional notices default disabled until opted in.

Required notices remain server-enforced regardless of optional preferences.

## 5. Vendor/store analytics

Route:

```text
/vendor/:vendorId/analytics
```

The route is only exposed when the resolved vendor access contains `analytics:read`.

The selected-store dashboard displays:

- order count;
- delivered order count;
- gross sales;
- refunded value;
- discounts;
- tax;
- delivery charges;
- commission;
- gateway fees.

Optional date filtering is supported. All values are retrieved from the server; the browser does not derive authoritative settlement or accounting state.

## 6. Defects found and fixed during FP10 integration

### 6.1 Missing admin response DTO aliases

Several P10 schemas existed without exported `Static<>` DTO aliases. This blocked a clean shared typed client.

Fixed by exporting summary/list DTOs for:

- admin users;
- admin orders;
- admin payments;
- admin refunds.

### 6.2 Query helper incompatible with strict DTO object types

The initial typed client helper accepted a narrow `Record<string, primitive>` shape. Under the repository's strict TypeScript settings, shared DTO objects are not guaranteed to satisfy an index signature.

Both FP10 query helpers now accept `object` and serialize only runtime string/number/boolean values.

### 6.3 Vendor analytics route inconsistent with existing App Router pattern

The first route used a promised `params`/React `use()` pattern while the current CartNest vendor routes consistently use `useParams()`.

The route was aligned to the repository pattern to avoid unnecessary route-shape divergence.

### 6.4 Required vendor notification recipients did not honor implied order-read access

The notification service originally selected vendor recipients only when staff had an explicit `order:read` permission.

CartNest authorization already treats these capabilities as implying order-read access:

```text
order:process
order:fulfill
refund:request
```

The notification recipient query now includes those permissions so active operations staff are not silently excluded from required vendor notices.

### 6.5 Admin notification retry was not concurrency-safe

The original retry flow performed a read followed by an unconditional update. Concurrent admin requests could both requeue and audit the same logical retry.

The update is now compare-and-set against:

- notification ID;
- the observed `updatedAt` version timestamp;
- external channel;
- retryable status.

If another admin/worker changes the row first, the later request returns `NOTIFICATION_RETRY_STATE_CONFLICT` instead of creating duplicate retry evidence.

## 7. Runtime evidence that is still missing

FP10 is not production-certified by this document.

Still required:

1. execute lint/typecheck/tests/build in a trusted environment;
2. apply/review P10 Prisma/PostgreSQL migration and constraint SQL;
3. regenerate/review OpenAPI and generated client artifacts;
4. exercise platform/store analytics against realistic seeded/staging data and reconcile financial totals;
5. select and configure actual email/SMS provider adapters;
6. wire external notification dispatch/retry/dead-letter behavior into the background worker/BullMQ runtime;
7. exercise notification preferences, read state, admin retry conflict behavior, and MFA gates in a browser/staging environment;
8. verify tax/promotion creation and promotion-redemption concurrency against PostgreSQL;
9. verify the unified order operations view against realistic paid/refunded/returned/fulfilled orders.

The repository's previously observed GitHub Actions startup failure must be rechecked on the FP10 pull request. No quality-gate command is considered passed merely because the source compiles conceptually.

## 8. Phase position

```text
FP0–FP9   integrated source baselines
FP10      admin/analytics/promotions/tax/notifications integrated source baseline

NEXT: FP11 hardening, performance, security, privacy/NDPR UX and operational integration
```
