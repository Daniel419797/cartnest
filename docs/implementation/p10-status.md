# P10 — Admin, Analytics, Promotions, Tax, and Notifications Status

**Phase:** P10  
**Status:** Backend/domain and frontend/API-integration source baselines implemented; runtime, migration, provider, and CI evidence remain pending  
**Updated:** 6 September 2026

## 1. Scope

P10 closes the marketplace-management and commercial-policy gaps left by earlier phases. The current source baseline covers:

- privileged marketplace administration;
- platform and store analytics;
- platform-wide VAT/tax configuration;
- platform-controlled promotions/coupons;
- promotion redemption concurrency safety;
- checkout tax and discount calculation;
- line/store/order financial allocation consistency;
- customer/vendor notification orchestration;
- in-app notification inbox/read state;
- notification preferences;
- provider-neutral email/SMS queue boundary;
- notification retry/operational queries;
- stable versioned notification-template registry;
- unified admin order/payment/refund/fulfillment case view;
- shared TypeBox/OpenAPI contracts;
- typed browser API clients;
- Next.js admin, customer-notification, and vendor-analytics surfaces.

The dedicated frontend integration evidence is recorded in `docs/implementation/frontend-p10-status.md`.

## 2. Authorization boundaries

Platform administration continues to use the P2 security boundary:

```text
authenticated principal
        ↓
ADMIN or SUPER_ADMIN
        ↓
privileged MFA satisfied
        ↓
admin operation
```

Store analytics is also available to vendor users with server-resolved `analytics:read` access.

No browser-supplied role, vendor ID, store ID, or user ID is accepted as authorization proof.

## 3. Admin operations surface

Implemented API surfaces include:

```text
GET /api/v1/admin/analytics
GET /api/v1/admin/users
GET /api/v1/admin/orders
GET /api/v1/admin/orders/:orderId/operations
GET /api/v1/admin/payment-intents
GET /api/v1/admin/refunds
GET /api/v1/admin/tax-rates
GET /api/v1/admin/promotions
GET /api/v1/admin/notifications
```

The unified order-operations endpoint combines:

```text
Order
├── VendorOrders
│   ├── commission
│   ├── delivery
│   ├── tax
│   ├── gateway fee
│   └── fulfillment state
├── PaymentIntents / PaymentAttempts
├── PaymentAllocations
├── Refunds
├── Shipments
└── ReturnRequests
```

The Next.js `/admin` console now consumes this contract directly, so an administrator can explain an order/payment/refund case without direct database access.

## 4. Analytics

Platform analytics exposes:

- registered users;
- approved vendors;
- active stores;
- active/public products;
- order count;
- paid-order count;
- gross merchandise value;
- refunded value;
- pending returns;
- failed notifications.

Store analytics exposes:

- VendorOrder count;
- delivered order count;
- gross sales;
- discounts;
- tax;
- delivery charges;
- platform commission;
- gateway fees;
- refunded value.

Money remains integer minor-unit money and is returned through shared `Money` DTOs.

The vendor workspace now exposes `/vendor/:vendorId/analytics` when the resolved membership includes `analytics:read`.

## 5. Tax policy

`TaxRate` uses basis points:

```text
7.5% = 750 bps
100% = 10,000 bps
```

Tax is applied to merchandise after promotion discount and currently excludes delivery:

```text
taxable merchandise = item subtotal - discount
Tax = taxable merchandise × rateBps / 10,000
```

Production checkout fails closed when no active tax policy can be resolved. Admin tax changes are audited. The P10 PostgreSQL constraint source includes the partial unique-index requirement that prevents multiple active platform tax policies under concurrent writes.

The `/admin` UI converts human percentage input to basis points and uses the typed tax contracts for create/activation mutations.

## 6. Promotions and financial snapshots

Supported promotion types:

```text
PERCENTAGE
FIXED_AMOUNT
```

Supported controls include code normalization, time windows, minimum-order value, global redemption limits, per-user limits, fixed-amount currency, and percentage basis points.

Checkout locks and revalidates a selected promotion during the order transaction before creating the `PromotionRedemption`, preventing casual global/per-user over-redemption under concurrency.

Store and line financial snapshots preserve these invariants:

```text
VendorOrder.itemSubtotal
- VendorOrder.discount
+ VendorOrder.delivery
+ VendorOrder.tax
= VendorOrder.total

Σ OrderItem discounts = VendorOrder discount
Σ OrderItem taxes     = VendorOrder tax
Σ VendorOrders        = parent Order totals
```

The `/admin` UI now provides promotion creation/status controls while checkout remains authoritative for applicability and redemption safety.

## 7. Notification architecture

P10 remains provider-neutral:

```text
Domain/Outbox event
       ↓
notification policy
       ↓
Notification row
       ↓
IN_APP → delivered internally
EMAIL  → QUEUED for provider adapter
SMS    → QUEUED for provider adapter
```

The current materialization boundary covers:

```text
order.created
payment.succeeded
shipment.delivered
refund.succeeded
return.status_changed
```

Customer and vendor recipients are resolved from trusted database relationships. Required vendor recipient resolution was corrected during FP10 integration so `order:process`, `order:fulfill`, and `refund:request` capabilities receive the same implied order-read treatment used by vendor authorization instead of requiring a literal `order:read` row.

## 8. Notification preferences and operations

Buyer/customer endpoints:

```text
GET  /api/v1/notifications
POST /api/v1/notifications/:notificationId/read
GET  /api/v1/notification-preferences
PUT  /api/v1/notification-preferences
```

The `/notifications` UI now exposes the in-app inbox, read state, unread filtering, and optional channel defaults.

Required service/payment/security notices are not disabled by ordinary preferences. SMS remains opt-in by default for optional notices; in-app/email optional notices default enabled unless overridden.

Admin operations:

```text
GET  /api/v1/admin/notifications
POST /api/v1/admin/notifications/:notificationId/retry
```

Retry actions are audited. The retry write is now compare-and-set against the observed notification `updatedAt`, external channel, and retryable status. A concurrent admin/worker state change returns `NOTIFICATION_RETRY_STATE_CONFLICT` rather than producing duplicate retry audit evidence.

## 9. Shared client and contract integration

New client modules:

```text
packages/api-client/src/admin.ts
packages/api-client/src/notifications.ts
```

The browser instances are created in `apps/web/lib/api.ts`, preserving credentials and centralized CSRF handling.

The P10 contract module was also corrected to export the admin user/order/payment/refund summary and list DTO aliases required by a strict typed client. Query serialization was hardened for strict DTO object types under `exactOptionalPropertyTypes`.

## 10. Database additions

P10 introduces `NotificationReceipt` and `NotificationPreference` through the multi-file Prisma source and reviewed SQL constraint source.

The SQL requirements include:

- NotificationReceipt → Notification FK;
- NotificationReceipt → User FK;
- NotificationPreference → User FK;
- optimized user in-app notification-history index;
- one-active-platform-tax-policy partial unique index.

These remain migration source requirements, not a claim that the production/staging database migration has already executed.

## 11. Exit-gate assessment

The approved P10 source-level exit gate is now represented end-to-end:

> Admin tooling can explain the state of an order/payment/refund without direct database access, and privileged changes generate audit entries.

Source evidence includes:

- `/api/v1/admin/orders/:orderId/operations`;
- payment/refund/shipment/return aggregation;
- typed browser consumption in `/admin`;
- tax/promotion audit entries;
- notification retry audit entries;
- privileged MFA boundaries;
- existing vendor/KYC/refund/review audit behavior from earlier phases.

This is **source-level completion only**. Runtime evidence has not been established by this document.

## 12. Remaining runtime/provider evidence

Still required before P10 can be treated as production-certified:

1. execute lint/typecheck/tests/build in a trusted environment;
2. apply/review the actual P10 Prisma/PostgreSQL migration and SQL constraints;
3. regenerate/review OpenAPI and generated client artifacts;
4. select/configure concrete email and SMS providers;
5. wire external notification dispatch, retry, and dead-letter behavior into the BullMQ/outbox worker runtime;
6. exercise platform/store analytics and financial reconciliation against realistic staging data;
7. browser-test user notification preferences/read state and admin privileged-MFA behavior;
8. exercise tax/promotion creation and promotion redemption under real PostgreSQL concurrency;
9. validate unified admin order operations against realistic paid, refunded, returned, and fulfilled orders.

The repository's previously observed GitHub Actions workflow has failed during GitHub startup before normal jobs were created. The FP10 pull-request run must therefore be inspected directly; no lint/typecheck/test/build command is considered passed until an actual job executes.

## 13. Current phase position

```text
P0–P9   backend/domain source baselines + frontend integration through FP9
P10     backend/domain + frontend/API-integration source baseline implemented

NEXT: FP11 hardening / performance / security / privacy and NDPR integration
```
