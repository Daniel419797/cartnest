import { Type, type Static } from "typebox";
import { IsoTimestampSchema, PaginationMetaSchema, UuidSchema } from "./common.js";

export const PrivacyRequestStatusSchema = Type.Union([
  Type.Literal("PENDING"),
  Type.Literal("REQUIRES_REVIEW"),
  Type.Literal("COMPLETED"),
  Type.Literal("REJECTED"),
]);
export type PrivacyRequestStatusDto = Static<typeof PrivacyRequestStatusSchema>;

export const PrivacyRequestSchema = Type.Object(
  {
    id: UuidSchema,
    status: PrivacyRequestStatusSchema,
    reviewNote: Type.Union([Type.String(), Type.Null()]),
    requestedAt: IsoTimestampSchema,
    processedAt: Type.Union([IsoTimestampSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type PrivacyRequestDto = Static<typeof PrivacyRequestSchema>;

export const AdminPrivacyRequestSchema = Type.Object(
  {
    id: UuidSchema,
    subjectUserId: UuidSchema,
    status: PrivacyRequestStatusSchema,
    reviewNote: Type.Union([Type.String(), Type.Null()]),
    requestedAt: IsoTimestampSchema,
    processedAt: Type.Union([IsoTimestampSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type AdminPrivacyRequestDto = Static<typeof AdminPrivacyRequestSchema>;

export const PrivacyRequestListQuerySchema = Type.Object(
  {
    page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
    status: Type.Optional(PrivacyRequestStatusSchema),
  },
  { additionalProperties: false },
);
export type PrivacyRequestListQueryDto = Static<typeof PrivacyRequestListQuerySchema>;

export const PrivacyRequestListResponseSchema = Type.Object(
  {
    items: Type.Array(PrivacyRequestSchema),
    pagination: PaginationMetaSchema,
  },
  { additionalProperties: false },
);
export type PrivacyRequestListResponseDto = Static<typeof PrivacyRequestListResponseSchema>;

export const AdminPrivacyRequestListResponseSchema = Type.Object(
  {
    items: Type.Array(AdminPrivacyRequestSchema),
    pagination: PaginationMetaSchema,
  },
  { additionalProperties: false },
);
export type AdminPrivacyRequestListResponseDto = Static<typeof AdminPrivacyRequestListResponseSchema>;

export const PrivacyRequestIdParamsSchema = Type.Object(
  { privacyRequestId: UuidSchema },
  { additionalProperties: false },
);

export const ProcessPrivacyRequestBodySchema = Type.Object(
  {
    decision: Type.Union([Type.Literal("ANONYMIZE"), Type.Literal("REJECT")]),
    reason: Type.String({ minLength: 10, maxLength: 1000 }),
  },
  { additionalProperties: false },
);
export type ProcessPrivacyRequestBodyDto = Static<typeof ProcessPrivacyRequestBodySchema>;

export const PrivacyExportSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    generatedAt: IsoTimestampSchema,
    subjectId: UuidSchema,
    data: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);
export type PrivacyExportDto = Static<typeof PrivacyExportSchema>;
