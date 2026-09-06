import { Type, type Static } from "typebox";
import { IsoTimestampSchema, MoneySchema, PaginationMetaSchema, UuidSchema } from "./common.js";
import { OrderStatusSchema, PaymentStatusSchema } from "./orders.js";
import { RefundStatusSchema } from "./returns.js";

export const PromotionTypeSchema = Type.Union([
  Type.Literal("PERCENTAGE"),
  Type.Literal("FIXED_AMOUNT"),
]);
export type PromotionTypeDto = Static<typeof PromotionTypeSchema>;

export const PromotionStatusSchema = Type.Union([
  Type.Literal("DRAFT"),
  Type.Literal("ACTIVE"),
  Type.Literal("PAUSED"),
  Type.Literal("EXPIRED"),
]);
export type PromotionStatusDto = Static<typeof PromotionStatusSchema>;

export const NotificationChannelSchema = Type.Union([
  Type.Literal("EMAIL"),
  Type.Literal("SMS"),
  Type.Literal("IN_APP"),
]);
export type NotificationChannelDto = Static<typeof NotificationChannelSchema>;

export const NotificationStatusSchema = Type.Union([
  Type.Literal("PENDING"),
  Type.Literal("QUEUED"),
  Type.Literal("SENT"),
  Type.Literal("DELIVERED"),
  Type.Literal("FAILED"),
  Type.Literal("CANCELLED"),
]);
export type NotificationStatusDto = Static<typeof NotificationStatusSchema>;

export const TaxRateSchema = Type.Object({
  id: UuidSchema,
  name: Type.String({ minLength: 1, maxLength: 160 }),
  rateBps: Type.Integer({ minimum: 0, maximum: 10000 }),
  active: Type.Boolean(),
  startsAt: IsoTimestampSchema,
  endsAt: Type.Union([IsoTimestampSchema, Type.Null()]),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
}, { additionalProperties: false });
export type TaxRateDto = Static<typeof TaxRateSchema>;

export const CreateTaxRateBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 160 }),
  rateBps: Type.Integer({ minimum: 0, maximum: 10000 }),
  startsAt: Type.Optional(IsoTimestampSchema),
  endsAt: Type.Optional(IsoTimestampSchema),
  active: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export type CreateTaxRateBodyDto = Static<typeof CreateTaxRateBodySchema>;

export const UpdateTaxRateBodySchema = Type.Object({ active: Type.Boolean() }, { additionalProperties: false });
export type UpdateTaxRateBodyDto = Static<typeof UpdateTaxRateBodySchema>;

export const TaxRateListResponseSchema = Type.Object({ items: Type.Array(TaxRateSchema) }, { additionalProperties: false });
export type TaxRateListResponseDto = Static<typeof TaxRateListResponseSchema>;

export const PromotionSchema = Type.Object({
  id: UuidSchema,
  code: Type.String({ minLength: 2, maxLength: 64 }),
  name: Type.String({ minLength: 1, maxLength: 160 }),
  type: PromotionTypeSchema,
  value: Type.String({ pattern: "^(0|[1-9][0-9]*)$" }),
  currency: Type.Union([Type.String({ pattern: "^[A-Z]{3}$" }), Type.Null()]),
  minOrderAmountMinor: Type.Union([Type.String({ pattern: "^(0|[1-9][0-9]*)$" }), Type.Null()]),
  maxRedemptions: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  perUserLimit: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  status: PromotionStatusSchema,
  startsAt: IsoTimestampSchema,
  endsAt: Type.Union([IsoTimestampSchema, Type.Null()]),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
}, { additionalProperties: false });
export type PromotionDto = Static<typeof PromotionSchema>;

export const CreatePromotionBodySchema = Type.Object({
  code: Type.String({ minLength: 2, maxLength: 64, pattern: "^[A-Za-z0-9_-]+$" }),
  name: Type.String({ minLength: 1, maxLength: 160 }),
  type: PromotionTypeSchema,
  value: Type.String({ pattern: "^[1-9][0-9]*$" }),
  currency: Type.Optional(Type.String({ pattern: "^[A-Z]{3}$" })),
  minOrderAmountMinor: Type.Optional(Type.String({ pattern: "^(0|[1-9][0-9]*)$" })),
  maxRedemptions: Type.Optional(Type.Integer({ minimum: 1 })),
  perUserLimit: Type.Optional(Type.Integer({ minimum: 1 })),
  startsAt: IsoTimestampSchema,
  endsAt: Type.Optional(IsoTimestampSchema),
  status: Type.Optional(PromotionStatusSchema),
}, { additionalProperties: false });
export type CreatePromotionBodyDto = Static<typeof CreatePromotionBodySchema>;

export const UpdatePromotionStatusBodySchema = Type.Object({ status: PromotionStatusSchema }, { additionalProperties: false });
export type UpdatePromotionStatusBodyDto = Static<typeof UpdatePromotionStatusBodySchema>;

export const PromotionListResponseSchema = Type.Object({ items: Type.Array(PromotionSchema) }, { additionalProperties: false });
export type PromotionListResponseDto = Static<typeof PromotionListResponseSchema>;

export const AnalyticsRangeQuerySchema = Type.Object({
  from: Type.Optional(IsoTimestampSchema),
  to: Type.Optional(IsoTimestampSchema),
}, { additionalProperties: false });
export type AnalyticsRangeQueryDto = Static<typeof AnalyticsRangeQuerySchema>;

export const PlatformAnalyticsSchema = Type.Object({
  users: Type.Integer({ minimum: 0 }),
  approvedVendors: Type.Integer({ minimum: 0 }),
  activeStores: Type.Integer({ minimum: 0 }),
  activeProducts: Type.Integer({ minimum: 0 }),
  orders: Type.Integer({ minimum: 0 }),
  paidOrders: Type.Integer({ minimum: 0 }),
  grossMerchandiseValue: MoneySchema,
  refundedValue: MoneySchema,
  pendingReturns: Type.Integer({ minimum: 0 }),
  failedNotifications: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });
export type PlatformAnalyticsDto = Static<typeof PlatformAnalyticsSchema>;

export const StoreAnalyticsSchema = Type.Object({
  storeId: UuidSchema,
  orders: Type.Integer({ minimum: 0 }),
  deliveredOrders: Type.Integer({ minimum: 0 }),
  grossSales: MoneySchema,
  discounts: MoneySchema,
  tax: MoneySchema,
  delivery: MoneySchema,
  commission: MoneySchema,
  gatewayFees: MoneySchema,
  refundedValue: MoneySchema,
}, { additionalProperties: false });
export type StoreAnalyticsDto = Static<typeof StoreAnalyticsSchema>;

export const AdminListQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
}, { additionalProperties: false });
export type AdminListQueryDto = Static<typeof AdminListQuerySchema>;

export const AdminUserSummarySchema = Type.Object({
  id: UuidSchema,
  email: Type.Union([Type.String(), Type.Null()]),
  phone: Type.Union([Type.String(), Type.Null()]),
  status: Type.String(),
  platformRole: Type.String(),
  createdAt: IsoTimestampSchema,
}, { additionalProperties: false });
export type AdminUserSummaryDto = Static<typeof AdminUserSummarySchema>;
export const AdminUserListResponseSchema = Type.Object({ items: Type.Array(AdminUserSummarySchema), pagination: PaginationMetaSchema }, { additionalProperties: false });
export type AdminUserListResponseDto = Static<typeof AdminUserListResponseSchema>;

export const AdminOrderSummarySchema = Type.Object({
  id: UuidSchema,
  orderNumber: Type.String(),
  userId: UuidSchema,
  status: OrderStatusSchema,
  paymentStatus: PaymentStatusSchema,
  grandTotal: MoneySchema,
  createdAt: IsoTimestampSchema,
}, { additionalProperties: false });
export type AdminOrderSummaryDto = Static<typeof AdminOrderSummarySchema>;
export const AdminOrderListResponseSchema = Type.Object({ items: Type.Array(AdminOrderSummarySchema), pagination: PaginationMetaSchema }, { additionalProperties: false });
export type AdminOrderListResponseDto = Static<typeof AdminOrderListResponseSchema>;

export const AdminPaymentSummarySchema = Type.Object({
  id: UuidSchema,
  orderId: UuidSchema,
  status: PaymentStatusSchema,
  amount: MoneySchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
}, { additionalProperties: false });
export type AdminPaymentSummaryDto = Static<typeof AdminPaymentSummarySchema>;
export const AdminPaymentListResponseSchema = Type.Object({ items: Type.Array(AdminPaymentSummarySchema), pagination: PaginationMetaSchema }, { additionalProperties: false });
export type AdminPaymentListResponseDto = Static<typeof AdminPaymentListResponseSchema>;

export const AdminRefundSummarySchema = Type.Object({
  id: UuidSchema,
  vendorOrderId: Type.Union([UuidSchema, Type.Null()]),
  provider: Type.String(),
  status: RefundStatusSchema,
  amount: MoneySchema,
  reason: Type.String(),
  createdAt: IsoTimestampSchema,
}, { additionalProperties: false });
export type AdminRefundSummaryDto = Static<typeof AdminRefundSummarySchema>;
export const AdminRefundListResponseSchema = Type.Object({ items: Type.Array(AdminRefundSummarySchema), pagination: PaginationMetaSchema }, { additionalProperties: false });
export type AdminRefundListResponseDto = Static<typeof AdminRefundListResponseSchema>;

export const NotificationSchema = Type.Object({
  id: UuidSchema,
  channel: NotificationChannelSchema,
  templateKey: Type.String({ minLength: 1, maxLength: 160 }),
  status: NotificationStatusSchema,
  payload: Type.Unknown(),
  readAt: Type.Union([IsoTimestampSchema, Type.Null()]),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
}, { additionalProperties: false });
export type NotificationDto = Static<typeof NotificationSchema>;

export const NotificationListQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  unreadOnly: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export type NotificationListQueryDto = Static<typeof NotificationListQuerySchema>;

export const NotificationListResponseSchema = Type.Object({ items: Type.Array(NotificationSchema), pagination: PaginationMetaSchema }, { additionalProperties: false });
export type NotificationListResponseDto = Static<typeof NotificationListResponseSchema>;

export const NotificationIdParamsSchema = Type.Object({ notificationId: UuidSchema }, { additionalProperties: false });

export const NotificationPreferenceSchema = Type.Object({
  channel: NotificationChannelSchema,
  scopeKey: Type.String({ minLength: 1, maxLength: 160 }),
  enabled: Type.Boolean(),
}, { additionalProperties: false });
export type NotificationPreferenceDto = Static<typeof NotificationPreferenceSchema>;

export const NotificationPreferenceListResponseSchema = Type.Object({ items: Type.Array(NotificationPreferenceSchema) }, { additionalProperties: false });
export type NotificationPreferenceListResponseDto = Static<typeof NotificationPreferenceListResponseSchema>;

export const UpdateNotificationPreferenceBodySchema = Type.Object({
  channel: NotificationChannelSchema,
  scopeKey: Type.String({ minLength: 1, maxLength: 160, default: "*" }),
  enabled: Type.Boolean(),
}, { additionalProperties: false });
export type UpdateNotificationPreferenceBodyDto = Static<typeof UpdateNotificationPreferenceBodySchema>;

export const OperationalNotificationSchema = Type.Object({
  id: UuidSchema,
  userId: Type.Union([UuidSchema, Type.Null()]),
  channel: NotificationChannelSchema,
  templateKey: Type.String(),
  recipient: Type.String(),
  status: NotificationStatusSchema,
  provider: Type.Union([Type.String(), Type.Null()]),
  providerRef: Type.Union([Type.String(), Type.Null()]),
  attempts: Type.Integer({ minimum: 0 }),
  nextAttemptAt: Type.Union([IsoTimestampSchema, Type.Null()]),
  lastError: Type.Union([Type.String(), Type.Null()]),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
}, { additionalProperties: false });
export type OperationalNotificationDto = Static<typeof OperationalNotificationSchema>;

export const OperationalNotificationQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  status: Type.Optional(NotificationStatusSchema),
  channel: Type.Optional(NotificationChannelSchema),
}, { additionalProperties: false });
export type OperationalNotificationQueryDto = Static<typeof OperationalNotificationQuerySchema>;

export const OperationalNotificationListResponseSchema = Type.Object({
  items: Type.Array(OperationalNotificationSchema),
  pagination: PaginationMetaSchema,
}, { additionalProperties: false });
export type OperationalNotificationListResponseDto = Static<typeof OperationalNotificationListResponseSchema>;

export const TaxRateIdParamsSchema = Type.Object({ taxRateId: UuidSchema }, { additionalProperties: false });
export const PromotionIdParamsSchema = Type.Object({ promotionId: UuidSchema }, { additionalProperties: false });
export const StoreAnalyticsParamsSchema = Type.Object({ storeId: UuidSchema }, { additionalProperties: false });