import { Type, type Static } from "typebox";
import { IsoTimestampSchema, MoneySchema, PaginationMetaSchema, UuidSchema } from "./common.js";
import { PaymentProviderSchema } from "./vendor.js";

export const ReturnStatusSchema = Type.Union([
  Type.Literal("REQUESTED"),
  Type.Literal("APPROVED"),
  Type.Literal("REJECTED"),
  Type.Literal("AWAITING_RETURN"),
  Type.Literal("IN_TRANSIT"),
  Type.Literal("RECEIVED"),
  Type.Literal("INSPECTING"),
  Type.Literal("REFUND_PENDING"),
  Type.Literal("COMPLETED"),
  Type.Literal("CANCELLED"),
]);
export type ReturnStatusDto = Static<typeof ReturnStatusSchema>;

export const ReturnItemConditionSchema = Type.Union([
  Type.Literal("UNOPENED"),
  Type.Literal("OPENED"),
  Type.Literal("DAMAGED"),
  Type.Literal("DEFECTIVE"),
  Type.Literal("WRONG_ITEM"),
  Type.Literal("OTHER"),
]);
export type ReturnItemConditionDto = Static<typeof ReturnItemConditionSchema>;

export const RefundStatusSchema = Type.Union([
  Type.Literal("REQUESTED"),
  Type.Literal("APPROVED"),
  Type.Literal("PROCESSING"),
  Type.Literal("SUCCEEDED"),
  Type.Literal("FAILED"),
  Type.Literal("CANCELLED"),
]);
export type RefundStatusDto = Static<typeof RefundStatusSchema>;

export const ReviewStatusSchema = Type.Union([
  Type.Literal("PENDING"),
  Type.Literal("APPROVED"),
  Type.Literal("REJECTED"),
  Type.Literal("REMOVED"),
]);
export type ReviewStatusDto = Static<typeof ReviewStatusSchema>;

export const ReviewTargetTypeSchema = Type.Union([
  Type.Literal("PRODUCT"),
  Type.Literal("STORE"),
]);
export type ReviewTargetTypeDto = Static<typeof ReviewTargetTypeSchema>;

export const CreateReturnBodySchema = Type.Object(
  {
    vendorOrderId: UuidSchema,
    reason: Type.String({ minLength: 3, maxLength: 1000 }),
    items: Type.Array(
      Type.Object(
        {
          orderItemId: UuidSchema,
          quantity: Type.Integer({ minimum: 1 }),
          condition: Type.Optional(ReturnItemConditionSchema),
          reason: Type.Optional(Type.String({ minLength: 2, maxLength: 500 })),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 100 },
    ),
  },
  { additionalProperties: false },
);
export type CreateReturnBodyDto = Static<typeof CreateReturnBodySchema>;

export const UpdateReturnStatusBodySchema = Type.Object(
  {
    status: ReturnStatusSchema,
    note: Type.Optional(Type.String({ minLength: 2, maxLength: 1000 })),
  },
  { additionalProperties: false },
);
export type UpdateReturnStatusBodyDto = Static<typeof UpdateReturnStatusBodySchema>;

export const ReturnItemSchema = Type.Object(
  {
    id: UuidSchema,
    orderItemId: UuidSchema,
    quantity: Type.Integer({ minimum: 1 }),
    condition: Type.Union([ReturnItemConditionSchema, Type.Null()]),
    reason: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type ReturnItemDto = Static<typeof ReturnItemSchema>;

export const RefundSchema = Type.Object(
  {
    id: UuidSchema,
    paymentIntentId: UuidSchema,
    vendorOrderId: Type.Union([UuidSchema, Type.Null()]),
    orderItemId: Type.Union([UuidSchema, Type.Null()]),
    returnRequestId: Type.Union([UuidSchema, Type.Null()]),
    provider: PaymentProviderSchema,
    providerRefundReference: Type.Union([Type.String({ maxLength: 255 }), Type.Null()]),
    amount: MoneySchema,
    reason: Type.String({ minLength: 1, maxLength: 1000 }),
    status: RefundStatusSchema,
    createdAt: IsoTimestampSchema,
    completedAt: Type.Union([IsoTimestampSchema, Type.Null()]),
    updatedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
);
export type RefundDto = Static<typeof RefundSchema>;

export const ReturnRequestSchema = Type.Object(
  {
    id: UuidSchema,
    vendorOrderId: UuidSchema,
    status: ReturnStatusSchema,
    reason: Type.String({ minLength: 1, maxLength: 1000 }),
    items: Type.Array(ReturnItemSchema),
    refunds: Type.Array(RefundSchema),
    requestedAt: IsoTimestampSchema,
    approvedAt: Type.Union([IsoTimestampSchema, Type.Null()]),
    receivedAt: Type.Union([IsoTimestampSchema, Type.Null()]),
    completedAt: Type.Union([IsoTimestampSchema, Type.Null()]),
    updatedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
);
export type ReturnRequestDto = Static<typeof ReturnRequestSchema>;

export const ReturnListResponseSchema = Type.Object(
  { items: Type.Array(ReturnRequestSchema), pagination: PaginationMetaSchema },
  { additionalProperties: false },
);
export type ReturnListResponseDto = Static<typeof ReturnListResponseSchema>;

export const ReturnListQuerySchema = Type.Object(
  {
    status: Type.Optional(ReturnStatusSchema),
    vendorOrderId: Type.Optional(UuidSchema),
    page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  },
  { additionalProperties: false },
);
export type ReturnListQueryDto = Static<typeof ReturnListQuerySchema>;

export const CreateRefundBodySchema = Type.Object(
  {
    amountMinor: Type.String({ pattern: "^[1-9][0-9]*$" }),
    reason: Type.String({ minLength: 3, maxLength: 1000 }),
    orderItemId: Type.Optional(UuidSchema),
    returnRequestId: Type.Optional(UuidSchema),
  },
  { additionalProperties: false },
);
export type CreateRefundBodyDto = Static<typeof CreateRefundBodySchema>;

export const RefundHeadersSchema = Type.Object(
  { "idempotency-key": Type.String({ minLength: 8, maxLength: 200 }) },
  { additionalProperties: true },
);
export type RefundHeadersDto = Static<typeof RefundHeadersSchema>;

export const RefundListResponseSchema = Type.Object(
  { items: Type.Array(RefundSchema), pagination: PaginationMetaSchema },
  { additionalProperties: false },
);
export type RefundListResponseDto = Static<typeof RefundListResponseSchema>;

export const RefundListQuerySchema = Type.Object(
  {
    status: Type.Optional(RefundStatusSchema),
    page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  },
  { additionalProperties: false },
);
export type RefundListQueryDto = Static<typeof RefundListQuerySchema>;

export const CreateProductReviewBodySchema = Type.Object(
  {
    orderItemId: UuidSchema,
    rating: Type.Integer({ minimum: 1, maximum: 5 }),
    text: Type.Optional(Type.String({ minLength: 2, maxLength: 4000 })),
  },
  { additionalProperties: false },
);
export type CreateProductReviewBodyDto = Static<typeof CreateProductReviewBodySchema>;

export const CreateStoreReviewBodySchema = Type.Object(
  {
    vendorOrderId: UuidSchema,
    rating: Type.Integer({ minimum: 1, maximum: 5 }),
    text: Type.Optional(Type.String({ minLength: 2, maxLength: 4000 })),
  },
  { additionalProperties: false },
);
export type CreateStoreReviewBodyDto = Static<typeof CreateStoreReviewBodySchema>;

export const ReviewSchema = Type.Object(
  {
    id: UuidSchema,
    targetType: ReviewTargetTypeSchema,
    targetId: UuidSchema,
    rating: Type.Integer({ minimum: 1, maximum: 5 }),
    text: Type.Union([Type.String({ maxLength: 4000 }), Type.Null()]),
    status: ReviewStatusSchema,
    verifiedPurchase: Type.Literal(true),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  },
  { additionalProperties: false },
);
export type ReviewDto = Static<typeof ReviewSchema>;

export const ReviewListResponseSchema = Type.Object(
  { items: Type.Array(ReviewSchema), pagination: PaginationMetaSchema },
  { additionalProperties: false },
);
export type ReviewListResponseDto = Static<typeof ReviewListResponseSchema>;

export const AdminReviewListQuerySchema = Type.Object(
  {
    status: Type.Optional(ReviewStatusSchema),
    targetType: Type.Optional(ReviewTargetTypeSchema),
    page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  },
  { additionalProperties: false },
);
export type AdminReviewListQueryDto = Static<typeof AdminReviewListQuerySchema>;

export const ReviewModerationBodySchema = Type.Object(
  {
    status: Type.Union([Type.Literal("APPROVED"), Type.Literal("REJECTED"), Type.Literal("REMOVED")]),
    reason: Type.Optional(Type.String({ minLength: 2, maxLength: 1000 })),
  },
  { additionalProperties: false },
);
export type ReviewModerationBodyDto = Static<typeof ReviewModerationBodySchema>;

export const RestockReturnResponseSchema = Type.Object(
  { adjustedItems: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);
export type RestockReturnResponseDto = Static<typeof RestockReturnResponseSchema>;

export const ReturnIdParamsSchema = Type.Object({ returnRequestId: UuidSchema }, { additionalProperties: false });
export const RefundIdParamsSchema = Type.Object({ refundId: UuidSchema }, { additionalProperties: false });
export const ReviewIdParamsSchema = Type.Object({ reviewId: UuidSchema }, { additionalProperties: false });
export const VendorOrderRefundParamsSchema = Type.Object({ vendorOrderId: UuidSchema }, { additionalProperties: false });
export const ProductReviewParamsSchema = Type.Object({ productId: UuidSchema }, { additionalProperties: false });
export const StoreReviewParamsSchema = Type.Object({ storeId: UuidSchema }, { additionalProperties: false });
