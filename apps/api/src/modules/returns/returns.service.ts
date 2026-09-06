import type {
  AdminReviewListQueryDto,
  CreateProductReviewBodyDto,
  CreateRefundBodyDto,
  CreateReturnBodyDto,
  CreateStoreReviewBodyDto,
  RefundDto,
  RefundListQueryDto,
  RefundListResponseDto,
  ReturnListQueryDto,
  ReturnListResponseDto,
  ReturnRequestDto,
  ReturnStatusDto,
  ReviewDto,
  ReviewListResponseDto,
  ReviewModerationBodyDto,
  UpdateReturnStatusBodyDto,
} from "@repo/contracts";
import { writeAuditEntry, type DatabaseClient } from "@repo/database";
import type { AccessPrincipal } from "../auth/auth.public.js";
import type { PaymentProviderAdapter } from "../payments/payment.provider.js";
import type { VendorOwnershipBoundary } from "../vendors/vendor.public.js";
import {
  PrismaReturnsRepository,
  type RefundRecord,
  type ReturnRecord,
} from "./returns.repository.js";

export class ReturnsError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: number) {
    super(message);
    this.name = "ReturnsError";
  }
}

const allowedReturnTransitions: Readonly<Record<ReturnStatusDto, readonly ReturnStatusDto[]>> = {
  REQUESTED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["AWAITING_RETURN", "REFUND_PENDING"],
  REJECTED: [],
  AWAITING_RETURN: ["IN_TRANSIT", "RECEIVED", "CANCELLED"],
  IN_TRANSIT: ["RECEIVED"],
  RECEIVED: ["INSPECTING", "REFUND_PENDING"],
  INSPECTING: ["REFUND_PENDING", "REJECTED"],
  REFUND_PENDING: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

function money(amountMinor: bigint, currency: string) {
  return { amountMinor: amountMinor.toString(), currency };
}

type RefundMapRecord = Pick<
  RefundRecord,
  | "id"
  | "paymentIntentId"
  | "vendorOrderId"
  | "orderItemId"
  | "returnRequestId"
  | "provider"
  | "providerRefundReference"
  | "amountMinor"
  | "currency"
  | "reason"
  | "status"
  | "createdAt"
  | "completedAt"
  | "updatedAt"
>;

function mapRefund(record: RefundMapRecord | ReturnRecord["refunds"][number]): RefundDto {
  return {
    id: record.id,
    paymentIntentId: record.paymentIntentId,
    vendorOrderId: record.vendorOrderId,
    orderItemId: record.orderItemId,
    returnRequestId: record.returnRequestId,
    provider: record.provider,
    providerRefundReference: record.providerRefundReference,
    amount: money(record.amountMinor, record.currency),
    reason: record.reason,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapReturn(record: ReturnRecord): ReturnRequestDto {
  return {
    id: record.id,
    vendorOrderId: record.vendorOrderId,
    status: record.status,
    reason: record.reason,
    items: record.items.map((item) => ({
      id: item.id,
      orderItemId: item.orderItemId,
      quantity: item.quantity,
      condition: item.condition,
      reason: item.reason,
    })),
    refunds: record.refunds.map(mapRefund),
    requestedAt: record.requestedAt.toISOString(),
    approvedAt: record.approvedAt?.toISOString() ?? null,
    receivedAt: record.receivedAt?.toISOString() ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapReview(
  type: "PRODUCT" | "STORE",
  record: {
    id: string;
    productId?: string;
    storeId?: string;
    rating: number;
    text: string | null;
    status: ReviewDto["status"];
    createdAt: Date;
    updatedAt: Date;
  },
): ReviewDto {
  const targetId = type === "PRODUCT" ? record.productId : record.storeId;
  if (!targetId) throw new Error("Review target is missing.");
  return {
    id: record.id,
    targetType: type,
    targetId,
    rating: record.rating,
    text: record.text,
    status: record.status,
    verifiedPurchase: true,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function pagination(page: number, pageSize: number, totalItems: number) {
  return {
    page,
    pageSize,
    totalItems,
    totalPages: totalItems ? Math.ceil(totalItems / pageSize) : 0,
  };
}

function domainError(error: unknown): never {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  switch (code) {
    case "VENDOR_ORDER_NOT_FOUND":
      throw new ReturnsError(code, "Vendor order was not found.", 404);
    case "RETURN_REQUIRES_DELIVERY":
      throw new ReturnsError(
        code,
        "Returns begin after delivery; use cancellation before shipment/delivery.",
        409,
      );
    case "RETURN_DUPLICATE_ITEM":
      throw new ReturnsError(code, "A return request cannot contain the same order item twice.", 400);
    case "RETURN_ITEM_NOT_IN_ORDER":
      throw new ReturnsError(code, "A return item does not belong to this vendor order.", 400);
    case "RETURN_QUANTITY_EXCEEDED":
      throw new ReturnsError(
        code,
        "Requested return quantity exceeds the remaining returnable quantity.",
        409,
      );
    case "RETURN_NOT_RESTOCKABLE":
      throw new ReturnsError(
        code,
        "Returned inventory is not yet eligible for explicit restocking.",
        409,
      );
    case "REVIEW_REQUIRES_DELIVERED_PURCHASE":
      throw new ReturnsError(code, "Only a delivered purchaser can submit this review.", 403);
    case "REVIEW_ALREADY_EXISTS":
      throw new ReturnsError(code, "A verified review already exists for this purchase.", 409);
    default:
      throw error;
  }
}

export class ReturnsService {
  private readonly adapters = new Map<string, PaymentProviderAdapter>();

  constructor(
    private readonly database: DatabaseClient,
    private readonly repository: PrismaReturnsRepository,
    private readonly vendorBoundary: VendorOwnershipBoundary,
    adapters: readonly PaymentProviderAdapter[],
  ) {
    for (const adapter of adapters) this.adapters.set(adapter.provider, adapter);
  }

  async createReturn(
    principal: AccessPrincipal,
    body: CreateReturnBodyDto,
  ): Promise<ReturnRequestDto> {
    try {
      return mapReturn(await this.repository.createReturn(principal.userId, body));
    } catch (error) {
      return domainError(error);
    }
  }

  async getBuyerReturn(
    principal: AccessPrincipal,
    returnRequestId: string,
  ): Promise<ReturnRequestDto> {
    const request = await this.repository.findBuyerReturn(principal.userId, returnRequestId);
    if (!request) throw new ReturnsError("RETURN_NOT_FOUND", "Return request was not found.", 404);
    return mapReturn(request);
  }

  async listBuyerReturns(
    principal: AccessPrincipal,
    query: ReturnListQueryDto,
  ): Promise<ReturnListResponseDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      userId: principal.userId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.vendorOrderId ? { vendorOrderId: query.vendorOrderId } : {}),
    };
    const [items, totalItems] = await Promise.all([
      this.database.returnRequest.findMany({
        where,
        include: {
          items: { orderBy: { createdAt: "asc" } },
          refunds: { orderBy: { createdAt: "asc" } },
        },
        orderBy: { requestedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.returnRequest.count({ where }),
    ]);
    return {
      items: items.map(mapReturn),
      pagination: pagination(page, pageSize, totalItems),
    };
  }

  async cancelBuyerReturn(
    principal: AccessPrincipal,
    returnRequestId: string,
  ): Promise<ReturnRequestDto> {
    const current = await this.repository.findBuyerReturn(principal.userId, returnRequestId);
    if (!current) throw new ReturnsError("RETURN_NOT_FOUND", "Return request was not found.", 404);
    if (current.status !== "REQUESTED") {
      throw new ReturnsError(
        "RETURN_NOT_CANCELLABLE",
        "Only a newly requested return can be cancelled by the buyer.",
        409,
      );
    }
    const changed = await this.repository.transitionReturn({
      returnRequestId,
      from: current.status,
      to: "CANCELLED",
      actorUserId: principal.userId,
      now: new Date(),
    });
    if (!changed) {
      throw new ReturnsError(
        "RETURN_STATE_CONFLICT",
        "Return state changed; refresh and try again.",
        409,
      );
    }
    return mapReturn(changed);
  }

  async listStoreReturns(
    principal: AccessPrincipal,
    storeId: string,
    query: ReturnListQueryDto,
  ): Promise<ReturnListResponseDto> {
    await this.vendorBoundary.requireStorePermission(principal, storeId, "order:read");
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      vendorOrder: { storeId },
      ...(query.status ? { status: query.status } : {}),
      ...(query.vendorOrderId ? { vendorOrderId: query.vendorOrderId } : {}),
    };
    const [items, totalItems] = await Promise.all([
      this.database.returnRequest.findMany({
        where,
        include: {
          items: { orderBy: { createdAt: "asc" } },
          refunds: { orderBy: { createdAt: "asc" } },
        },
        orderBy: { requestedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.returnRequest.count({ where }),
    ]);
    return {
      items: items.map(mapReturn),
      pagination: pagination(page, pageSize, totalItems),
    };
  }

  async updateReturnStatus(
    principal: AccessPrincipal,
    returnRequestId: string,
    body: UpdateReturnStatusBodyDto,
  ): Promise<ReturnRequestDto> {
    const current = await this.repository.findReturnWithStore(returnRequestId);
    if (!current) throw new ReturnsError("RETURN_NOT_FOUND", "Return request was not found.", 404);
    await this.vendorBoundary.requireStorePermission(
      principal,
      current.vendorOrder.storeId,
      "order:process",
    );
    if (!allowedReturnTransitions[current.status].includes(body.status)) {
      throw new ReturnsError(
        "INVALID_RETURN_TRANSITION",
        `Cannot move return from ${current.status} to ${body.status}.`,
        409,
      );
    }
    const changed = await this.repository.transitionReturn({
      returnRequestId,
      from: current.status,
      to: body.status,
      actorUserId: principal.userId,
      ...(body.note ? { note: body.note } : {}),
      now: new Date(),
    });
    if (!changed) {
      throw new ReturnsError(
        "RETURN_STATE_CONFLICT",
        "Return state changed; refresh and try again.",
        409,
      );
    }
    return mapReturn(changed);
  }

  async restockReturn(
    principal: AccessPrincipal,
    returnRequestId: string,
  ): Promise<{ adjustedItems: number }> {
    const current = await this.repository.findReturnWithStore(returnRequestId);
    if (!current) throw new ReturnsError("RETURN_NOT_FOUND", "Return request was not found.", 404);
    await this.vendorBoundary.requireStorePermission(
      principal,
      current.vendorOrder.storeId,
      "inventory:adjust",
    );
    try {
      return {
        adjustedItems: await this.repository.restockReturn(returnRequestId, principal.userId),
      };
    } catch (error) {
      return domainError(error);
    }
  }

  async requestRefund(
    principal: AccessPrincipal,
    vendorOrderId: string,
    body: CreateRefundBodyDto,
    idempotencyKey: string,
  ): Promise<RefundDto> {
    const vendorOrder = await this.database.vendorOrder.findUnique({
      where: { id: vendorOrderId },
      select: { storeId: true },
    });
    if (!vendorOrder) {
      throw new ReturnsError("VENDOR_ORDER_NOT_FOUND", "Vendor order was not found.", 404);
    }
    await this.vendorBoundary.requireStorePermission(principal, vendorOrder.storeId, "refund:request");
    const result = await this.repository.createRefundRequest({
      actorUserId: principal.userId,
      vendorOrderId,
      amountMinor: BigInt(body.amountMinor),
      reason: body.reason,
      ...(body.orderItemId ? { orderItemId: body.orderItemId } : {}),
      ...(body.returnRequestId ? { returnRequestId: body.returnRequestId } : {}),
      idempotencyKey,
    });
    if (result.kind === "created" || result.kind === "replayed") return mapRefund(result.refund);
    if (result.kind === "conflict") {
      throw new ReturnsError(
        "IDEMPOTENCY_KEY_REUSED",
        "This idempotency key was used with a different refund request.",
        409,
      );
    }
    if (result.kind === "in_progress") {
      throw new ReturnsError(
        "REFUND_REQUEST_IN_PROGRESS",
        "This refund request is already being processed.",
        409,
      );
    }
    if (result.kind === "amount_exceeded") {
      throw new ReturnsError(
        "REFUND_AMOUNT_EXCEEDED",
        "Refund exceeds the remaining refundable value for this vendor order.",
        409,
      );
    }
    if (result.kind === "payment_unavailable") {
      throw new ReturnsError(
        "REFUND_PAYMENT_SOURCE_UNAVAILABLE",
        "No verified captured payment is available for this refund.",
        409,
      );
    }
    throw new ReturnsError("REFUND_SCOPE_INVALID", "Refund scope could not be resolved.", 404);
  }

  async listVendorOrderRefunds(
    principal: AccessPrincipal,
    vendorOrderId: string,
    query: RefundListQueryDto,
  ): Promise<RefundListResponseDto> {
    const vendorOrder = await this.database.vendorOrder.findUnique({
      where: { id: vendorOrderId },
      select: { storeId: true },
    });
    if (!vendorOrder) {
      throw new ReturnsError("VENDOR_ORDER_NOT_FOUND", "Vendor order was not found.", 404);
    }
    await this.vendorBoundary.requireStorePermission(principal, vendorOrder.storeId, "order:read");
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      vendorOrderId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, totalItems] = await Promise.all([
      this.database.refund.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.refund.count({ where }),
    ]);
    return {
      items: items.map(mapRefund),
      pagination: pagination(page, pageSize, totalItems),
    };
  }

  async listAdminRefunds(query: RefundListQueryDto): Promise<RefundListResponseDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = query.status ? { status: query.status } : {};
    const [items, totalItems] = await Promise.all([
      this.database.refund.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.refund.count({ where }),
    ]);
    return {
      items: items.map(mapRefund),
      pagination: pagination(page, pageSize, totalItems),
    };
  }

  async approveAndExecuteRefund(
    principal: AccessPrincipal,
    refundId: string,
  ): Promise<RefundDto> {
    const existing = await this.repository.findRefund(refundId);
    if (!existing) throw new ReturnsError("REFUND_NOT_FOUND", "Refund was not found.", 404);
    if (existing.status === "SUCCEEDED" || existing.status === "PROCESSING") {
      return mapRefund(existing);
    }
    if (existing.status !== "REQUESTED" && existing.status !== "APPROVED") {
      throw new ReturnsError(
        "REFUND_NOT_EXECUTABLE",
        "Refund cannot be executed in its current state.",
        409,
      );
    }

    const claimed = await this.database.refund.updateMany({
      where: { id: refundId, status: { in: ["REQUESTED", "APPROVED"] } },
      data: { status: "PROCESSING" },
    });
    if (claimed.count !== 1) {
      const current = await this.repository.findRefund(refundId);
      if (!current) throw new ReturnsError("REFUND_NOT_FOUND", "Refund was not found.", 404);
      return mapRefund(current);
    }

    await writeAuditEntry(this.database, {
      actorType: "USER",
      actorUserId: principal.userId,
      action: "refund.execution_started",
      entityType: "Refund",
      entityId: refundId,
      metadata: { previousStatus: existing.status },
    });

    const refund = await this.repository.findRefund(refundId);
    if (!refund) throw new ReturnsError("REFUND_NOT_FOUND", "Refund was not found.", 404);
    const source = this.repository.successfulPaymentSource(refund);
    const adapter = this.adapters.get(refund.provider);
    if (!source || !adapter) {
      await this.repository.markRefundFailure(refundId);
      throw new ReturnsError(
        "REFUND_PROVIDER_UNAVAILABLE",
        "Refund provider/source is unavailable.",
        503,
      );
    }

    const result = await adapter.refund({
      providerTransactionId: source.providerTransactionId,
      amountMinor: refund.amountMinor,
      currency: refund.currency,
      reason: refund.reason,
    });
    if (result.kind === "definite_failure") {
      await this.repository.markRefundFailure(refundId);
      throw new ReturnsError("REFUND_PROVIDER_REJECTED", result.message, 502);
    }
    if (result.kind === "ambiguous") {
      throw new ReturnsError(
        "REFUND_OUTCOME_UNKNOWN",
        "The provider refund outcome is unknown. CartNest will reconcile before another refund is allowed.",
        409,
      );
    }
    return mapRefund(
      await this.repository.markRefundSubmitted({
        refundId,
        providerRefundReference: result.providerRefundReference,
        succeeded: result.status === "SUCCEEDED",
      }),
    );
  }

  async reconcileRefund(
    refundId: string,
    actor?: AccessPrincipal,
  ): Promise<RefundDto> {
    const refund = await this.repository.findRefund(refundId);
    if (!refund) throw new ReturnsError("REFUND_NOT_FOUND", "Refund was not found.", 404);
    if (refund.status !== "PROCESSING" || !refund.providerRefundReference) return mapRefund(refund);

    const adapter = this.adapters.get(refund.provider);
    if (!adapter) {
      throw new ReturnsError("REFUND_PROVIDER_UNAVAILABLE", "Refund provider is unavailable.", 503);
    }
    const verification = await adapter.verifyRefund(refund.providerRefundReference);
    if (
      verification.amountMinor !== undefined &&
      verification.amountMinor !== refund.amountMinor
    ) {
      throw new ReturnsError(
        "REFUND_VERIFICATION_MISMATCH",
        "Provider refund amount does not match CartNest.",
        409,
      );
    }
    const status =
      verification.status === "SUCCEEDED"
        ? "SUCCEEDED"
        : verification.status === "FAILED"
          ? "FAILED"
          : "PROCESSING";
    const changed = await this.repository.updateRefundVerification(refund.id, status);
    if (actor) {
      await writeAuditEntry(this.database, {
        actorType: "USER",
        actorUserId: actor.userId,
        action: "refund.reconciled",
        entityType: "Refund",
        entityId: refund.id,
        metadata: {
          previousStatus: refund.status,
          status: changed.status,
          providerRefundReference: refund.providerRefundReference,
        },
      });
    }
    return mapRefund(changed);
  }

  async reconcilePendingRefunds(limit = 100): Promise<number> {
    let changed = 0;
    for (const refund of await this.repository.listRefundReconciliationCandidates(limit)) {
      const before = refund.status;
      try {
        const after = await this.reconcileRefund(refund.id);
        if (after.status !== before) changed += 1;
      } catch {
        // Provider outage or verification mismatch remains observable/retryable.
      }
    }
    return changed;
  }

  async createProductReview(
    principal: AccessPrincipal,
    body: CreateProductReviewBodyDto,
  ): Promise<ReviewDto> {
    try {
      const row = await this.repository.createProductReview(principal.userId, body);
      return mapReview("PRODUCT", row);
    } catch (error) {
      return domainError(error);
    }
  }

  async createStoreReview(
    principal: AccessPrincipal,
    body: CreateStoreReviewBodyDto,
  ): Promise<ReviewDto> {
    try {
      const row = await this.repository.createStoreReview(principal.userId, body);
      return mapReview("STORE", row);
    } catch (error) {
      return domainError(error);
    }
  }

  async listProductReviews(
    productId: string,
    page = 1,
    pageSize = 20,
  ): Promise<ReviewListResponseDto> {
    const result = await this.repository.listProductReviews(productId, page, pageSize);
    return {
      items: result.items.map((row) => mapReview("PRODUCT", row)),
      pagination: pagination(page, pageSize, result.totalItems),
    };
  }

  async listStoreReviews(
    storeId: string,
    page = 1,
    pageSize = 20,
  ): Promise<ReviewListResponseDto> {
    const result = await this.repository.listStoreReviews(storeId, page, pageSize);
    return {
      items: result.items.map((row) => mapReview("STORE", row)),
      pagination: pagination(page, pageSize, result.totalItems),
    };
  }

  async listAdminReviews(query: AdminReviewListQueryDto): Promise<ReviewListResponseDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const takePerType = page * pageSize;
    const productWhere = { ...(query.status ? { status: query.status } : {}) };
    const storeWhere = { ...(query.status ? { status: query.status } : {}) };
    const includeProducts = !query.targetType || query.targetType === "PRODUCT";
    const includeStores = !query.targetType || query.targetType === "STORE";

    const [products, stores, productCount, storeCount] = await Promise.all([
      includeProducts
        ? this.database.productReview.findMany({
            where: productWhere,
            orderBy: { createdAt: "desc" },
            take: takePerType,
          })
        : Promise.resolve([]),
      includeStores
        ? this.database.storeReview.findMany({
            where: storeWhere,
            orderBy: { createdAt: "desc" },
            take: takePerType,
          })
        : Promise.resolve([]),
      includeProducts
        ? this.database.productReview.count({ where: productWhere })
        : Promise.resolve(0),
      includeStores
        ? this.database.storeReview.count({ where: storeWhere })
        : Promise.resolve(0),
    ]);

    const items = [
      ...products.map((row) => mapReview("PRODUCT", row)),
      ...stores.map((row) => mapReview("STORE", row)),
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice((page - 1) * pageSize, page * pageSize);
    const totalItems = productCount + storeCount;
    return { items, pagination: pagination(page, pageSize, totalItems) };
  }

  async moderateReview(
    principal: AccessPrincipal,
    reviewId: string,
    body: ReviewModerationBodyDto,
  ): Promise<ReviewDto> {
    const result = await this.repository.moderateReview({
      reviewId,
      status: body.status,
      actorUserId: principal.userId,
      ...(body.reason ? { reason: body.reason } : {}),
    });
    if (!result) throw new ReturnsError("REVIEW_NOT_FOUND", "Review was not found.", 404);
    return mapReview(result.type, result.record);
  }
}
