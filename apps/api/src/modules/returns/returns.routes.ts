import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  AdminReviewListQuerySchema,
  ApiErrorSchema,
  CreateProductReviewBodySchema,
  CreateRefundBodySchema,
  CreateReturnBodySchema,
  CreateStoreReviewBodySchema,
  PaginationQuerySchema,
  ProductReviewParamsSchema,
  RefundHeadersSchema,
  RefundIdParamsSchema,
  RefundListQuerySchema,
  RefundListResponseSchema,
  RefundSchema,
  RestockReturnResponseSchema,
  ReturnIdParamsSchema,
  ReturnListQuerySchema,
  ReturnListResponseSchema,
  ReturnRequestSchema,
  ReviewIdParamsSchema,
  ReviewListResponseSchema,
  ReviewModerationBodySchema,
  ReviewSchema,
  StoreIdParamsSchema,
  StoreReviewParamsSchema,
  UpdateReturnStatusBodySchema,
  VendorOrderRefundParamsSchema,
} from "@repo/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AuthError,
  AuthorizationError,
  requireAccessPrincipal,
  requireCsrfToken,
  requirePlatformRole,
  requirePrivilegedMfa,
  type AuthService,
} from "../auth/auth.public.js";
import { ReturnsError, type ReturnsService } from "./returns.service.js";

export interface ReturnsRoutesOptions {
  readonly service: ReturnsService | undefined;
  readonly authService: AuthService | undefined;
}

const commonErrors = {
  400: ApiErrorSchema,
  401: ApiErrorSchema,
  403: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  502: ApiErrorSchema,
  503: ApiErrorSchema,
};

function errorBody(request: FastifyRequest, code: string, message: string) {
  return { error: { code, message, requestId: request.id } };
}

function serviceOrThrow(service: ReturnsService | undefined): ReturnsService {
  if (!service) {
    throw new ReturnsError(
      "RETURNS_SERVICE_UNAVAILABLE",
      "Returns storage is unavailable.",
      503,
    );
  }
  return service;
}

function authOrThrow(service: AuthService | undefined): AuthService {
  if (!service) throw new AuthError("AUTH_UNAVAILABLE", "Authentication storage is unavailable.", 503);
  return service;
}

function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
) {
  if (
    error instanceof ReturnsError ||
    error instanceof AuthError ||
    error instanceof AuthorizationError
  ) {
    return reply
      .code(error.statusCode)
      .send(errorBody(request, error.code, error.message));
  }
  request.log.warn({ err: error }, "Returns/reviews request failed");
  return reply
    .code(500)
    .send(errorBody(request, "INTERNAL_ERROR", "Returns/reviews request failed."));
}

async function adminPrincipal(request: FastifyRequest, options: ReturnsRoutesOptions) {
  const principal = await requireAccessPrincipal(request, authOrThrow(options.authService));
  requirePlatformRole(principal, ["ADMIN", "SUPER_ADMIN"]);
  requirePrivilegedMfa(principal);
  return principal;
}

export function registerReturnsRoutes(
  app: FastifyInstance,
  options: ReturnsRoutesOptions,
): void {
  const server = app.withTypeProvider<TypeBoxTypeProvider>();

  server.post(
    "/api/v1/returns",
    {
      schema: {
        tags: ["returns"],
        operationId: "createReturnRequest",
        body: CreateReturnBodySchema,
        response: { 201: ReturnRequestSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      try {
        requireCsrfToken(request);
        const principal = await requireAccessPrincipal(
          request,
          authOrThrow(options.authService),
        );
        return reply
          .code(201)
          .send(await serviceOrThrow(options.service).createReturn(principal, request.body));
      } catch (error) {
        return sendError(request, reply, error);
      }
    },
  );

  server.get(
    "/api/v1/returns",
    {
      schema: {
        tags: ["returns"],
        operationId: "listMyReturns",
        querystring: ReturnListQuerySchema,
        response: { 200: ReturnListResponseSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      try {
        const principal = await requireAccessPrincipal(
          request,
          authOrThrow(options.authService),
        );
        return reply.send(
          await serviceOrThrow(options.service).listBuyerReturns(principal, request.query),
        );
      } catch (error) {
        return sendError(request, reply, error);
      }
    },
  );

  server.get(
    "/api/v1/returns/:returnRequestId",
    {
      schema: {
        tags: ["returns"],
        operationId: "getMyReturn",
        params: ReturnIdParamsSchema,
        response: { 200: ReturnRequestSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      try {
        const principal = await requireAccessPrincipal(
          request,
          authOrThrow(options.authService),
        );
        return reply.send(
          await serviceOrThrow(options.service).getBuyerReturn(
            principal,
            request.params.returnRequestId,
          ),
        );
      } catch (error) {
        return sendError(request, reply, error);
      }
    },
  );

  server.post(
    "/api/v1/returns/:returnRequestId/cancel",
    {
      schema: {
        tags: ["returns"],
        operationId: "cancelMyReturn",
        params: ReturnIdParamsSchema,
        response: { 200: ReturnRequestSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      try {
        requireCsrfToken(request);
        const principal = await requireAccessPrincipal(
          request,
          authOrThrow(options.authService),
        );
        return reply.send(
          await serviceOrThrow(options.service).cancelBuyerReturn(
            principal,
            request.params.returnRequestId,
          ),
        );
      } catch (error) {
        return sendError(request, reply, error);
      }
    },
  );

  server.get(
    "/api/v1/stores/:storeId/returns",
    {
      schema: {
        tags: ["returns"],
        operationId: "listStoreReturns",
        params: StoreIdParamsSchema,
        querystring: ReturnListQuerySchema,
        response: { 200: ReturnListResponseSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      try {
        const principal = await requireAccessPrincipal(
          request,
          authOrThrow(options.authService),
        );
        return reply.send(
          await serviceOrThrow(options.service).listStoreReturns(
            principal,
            request.params.storeId,
            request.query,
          ),
        );
      } catch (error) {
        return sendError(request, reply, error);
      }
    },
  );

  server.post(
    "/api/v1/returns/:returnRequestId/status",
    {
      schema: {
        tags: ["returns"],
        operationId: "updateReturnStatus",
        params: ReturnIdParamsSchema,
        body: UpdateReturnStatusBodySchema,
        response: { 200: ReturnRequestSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      try {
        requireCsrfToken(request);
        const principal = await requireAccessPrincipal(
          request,
          authOrThrow(options.authService),
        );
        return reply.send(
          await serviceOrThrow(options.service).updateReturnStatus(
            principal,
            request.params.returnRequestId,
            request.body,
          ),
        );
      } catch (error) {
        return sendError(request, reply, error);
      }
    },
  );

  server.post(
    "/api/v1/returns/:returnRequestId/restock",
    {
      schema: {
        tags: ["returns"],
        operationId: "restockReturnedItems",
        params: ReturnIdParamsSchema,
        response: { 200: RestockReturnResponseSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      try {
        requireCsrfToken(request);
        const principal = await requireAccessPrincipal(
          request,
          authOrThrow(options.authService),
        );
        return reply.send(
          await serviceOrThrow(options.service).restockReturn(
            principal,
            request.params.returnRequestId,
          ),
        );
      } catch (error) {
        return sendError(request, reply, error);
      }
    },
  );

  server.get(
    "/api/v1/vendor-orders/:vendorOrderId/refunds",
    {
      schema: {
        tags: ["refunds"],
        operationId: "listVendorOrderRefunds",
        params: VendorOrderRefundParamsSchema,
        querystring: RefundListQuerySchema,
        response: { 200: RefundListResponseSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      try {
        const principal = await requireAccessPrincipal(
          request,
          authOrThrow(options.authService),
        );
        return reply.send(
          await serviceOrThrow(options.service).listVendorOrderRefunds(
            principal,
            request.params.vendorOrderId,
            request.query,
          ),
        );
      } catch (error) {
        return sendError(request, reply, error);
      }
    },
  );

  server.post(
    "/api/v1/vendor-orders/:vendorOrderId/refunds",
    {
      schema: {
        tags: ["refunds"],
        operationId: "requestVendorRefund",
        params: VendorOrderRefundParamsSchema,
        headers: RefundHeadersSchema,
        body: CreateRefundBodySchema,
        response: { 201: RefundSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      try {
        requireCsrfToken(request);
        const principal = await requireAccessPrincipal(
          request,
          authOrThrow(options.authService),
        );
        return reply.code(201).send(
          await serviceOrThrow(options.service).requestRefund(
            principal,
            request.params.vendorOrderId,
            request.body,
            request.headers["idempotency-key"],
          ),
        );
      } catch (error) {
        return sendError(request, reply, error);
      }
    },
  );

  server.get(
    "/api/v1/admin/refunds",
    {
      schema: {
        tags: ["admin", "refunds"],
        operationId: "listAdminRefunds",
        querystring: RefundListQuerySchema,
        response: { 200: RefundListResponseSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      try {
        await adminPrincipal(request, options);
        return reply.send(
          await serviceOrThrow(options.service).listAdminRefunds(request.query),
        );
      } catch (error) {
        return sendError(request, reply, error);
      }
    },
  );

  server.post(
    "/api/v1/admin/refunds/:refundId/approve",
    {
      schema: {
        tags: ["admin", "refunds"],
        operationId: "approveAndExecuteRefund",
        params: RefundIdParamsSchema,
        response: { 200: RefundSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      try {
        requireCsrfToken(request);
        const principal = await adminPrincipal(request, options);
        return reply.send(
          await serviceOrThrow(options.service).approveAndExecuteRefund(
            principal,
            request.params.refundId,
          ),
        );
      } catch (error) {
        return sendError(request, reply, error);
      }
    },
  );

  server.post(
    "/api/v1/admin/refunds/:refundId/reconcile",
    {
      schema: {
        tags: ["admin", "refunds"],
        operationId: "reconcileRefund",
        params: RefundIdParamsSchema,
        response: { 200: RefundSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      try {
        requireCsrfToken(request);
        const principal = await adminPrincipal(request, options);
        return reply.send(
          await serviceOrThrow(options.service).reconcileRefund(
            request.params.refundId,
            principal,
          ),
        );
      } catch (error) {
        return sendError(request, reply, error);
      }
    },
  );

  server.post(
    "/api/v1/reviews/products",
    {
      schema: {
        tags: ["reviews"],
        operationId: "createProductReview",
        body: CreateProductReviewBodySchema,
        response: { 201: ReviewSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      try {
        requireCsrfToken(request);
        const principal = await requireAccessPrincipal(
          request,
          authOrThrow(options.authService),
        );
        return reply
          .code(201)
          .send(
            await serviceOrThrow(options.service).createProductReview(principal, request.body),
          );
      } catch (error) {
        return sendError(request, reply, error);
      }
    },
  );

  server.post(
    "/api/v1/reviews/stores",
    {
      schema: {
        tags: ["reviews"],
        operationId: "createStoreReview",
        body: CreateStoreReviewBodySchema,
        response: { 201: ReviewSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      try {
        requireCsrfToken(request);
        const principal = await requireAccessPrincipal(
          request,
          authOrThrow(options.authService),
        );
        return reply
          .code(201)
          .send(
            await serviceOrThrow(options.service).createStoreReview(principal, request.body),
          );
      } catch (error) {
        return sendError(request, reply, error);
      }
    },
  );

  server.get(
    "/api/v1/products/:productId/reviews",
    {
      schema: {
        tags: ["reviews"],
        operationId: "listProductReviews",
        params: ProductReviewParamsSchema,
        querystring: PaginationQuerySchema,
        response: { 200: ReviewListResponseSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      try {
        return reply.send(
          await serviceOrThrow(options.service).listProductReviews(
            request.params.productId,
            request.query.page ?? 1,
            request.query.pageSize ?? 20,
          ),
        );
      } catch (error) {
        return sendError(request, reply, error);
      }
    },
  );

  server.get(
    "/api/v1/stores/:storeId/reviews",
    {
      schema: {
        tags: ["reviews"],
        operationId: "listStoreReviews",
        params: StoreReviewParamsSchema,
        querystring: PaginationQuerySchema,
        response: { 200: ReviewListResponseSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      try {
        return reply.send(
          await serviceOrThrow(options.service).listStoreReviews(
            request.params.storeId,
            request.query.page ?? 1,
            request.query.pageSize ?? 20,
          ),
        );
      } catch (error) {
        return sendError(request, reply, error);
      }
    },
  );

  server.get(
    "/api/v1/admin/reviews",
    {
      schema: {
        tags: ["admin", "reviews"],
        operationId: "listAdminReviews",
        querystring: AdminReviewListQuerySchema,
        response: { 200: ReviewListResponseSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      try {
        await adminPrincipal(request, options);
        return reply.send(
          await serviceOrThrow(options.service).listAdminReviews(request.query),
        );
      } catch (error) {
        return sendError(request, reply, error);
      }
    },
  );

  server.post(
    "/api/v1/admin/reviews/:reviewId/moderate",
    {
      schema: {
        tags: ["admin", "reviews"],
        operationId: "moderateReview",
        params: ReviewIdParamsSchema,
        body: ReviewModerationBodySchema,
        response: { 200: ReviewSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      try {
        requireCsrfToken(request);
        const principal = await adminPrincipal(request, options);
        return reply.send(
          await serviceOrThrow(options.service).moderateReview(
            principal,
            request.params.reviewId,
            request.body,
          ),
        );
      } catch (error) {
        return sendError(request, reply, error);
      }
    },
  );
}
