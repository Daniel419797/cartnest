import { createHash } from "node:crypto";
import type {
  CreateProductReviewBodyDto,
  CreateReturnBodyDto,
  CreateStoreReviewBodyDto,
  PaymentProviderDto,
  ReturnStatusDto,
  ReviewStatusDto,
} from "@repo/contracts";
import {
  Prisma,
  type DatabaseClient,
  enqueueOutboxEvent,
  writeAuditEntry,
} from "@repo/database";

const returnInclude = {
  items: { orderBy: { createdAt: "asc" as const } },
  refunds: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.ReturnRequestInclude;

export type ReturnRecord = Prisma.ReturnRequestGetPayload<{ include: typeof returnInclude }>;

const refundInclude = {
  paymentIntent: { include: { attempts: { orderBy: { confirmedAt: "desc" as const } } } },
  vendorOrder: true,
  returnRequest: true,
} satisfies Prisma.RefundInclude;
export type RefundRecord = Prisma.RefundGetPayload<{ include: typeof refundInclude }>;

export interface SuccessfulPaymentSource {
  provider: PaymentProviderDto;
  providerTransactionId: string;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002",
  );
}

async function lockVendorOrder(
  tx: Prisma.TransactionClient,
  vendorOrderId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "VendorOrder"
    WHERE "id" = ${vendorOrderId}::uuid
    FOR UPDATE
  `);
  return rows.length === 1;
}

async function lockReturnRequest(
  tx: Prisma.TransactionClient,
  returnRequestId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "ReturnRequest"
    WHERE "id" = ${returnRequestId}::uuid
    FOR UPDATE
  `);
  return rows.length === 1;
}

export class PrismaReturnsRepository {
  constructor(private readonly database: DatabaseClient) {}

  async createReturn(userId: string, body: CreateReturnBodyDto): Promise<ReturnRecord> {
    const id = await this.database.$transaction(async (tx) => {
      if (!(await lockVendorOrder(tx, body.vendorOrderId))) {
        throw new Error("VENDOR_ORDER_NOT_FOUND");
      }

      const vendorOrder = await tx.vendorOrder.findFirst({
        where: { id: body.vendorOrderId, order: { userId } },
        include: { items: true },
      });
      if (!vendorOrder) throw new Error("VENDOR_ORDER_NOT_FOUND");
      if (vendorOrder.status !== "DELIVERED") throw new Error("RETURN_REQUIRES_DELIVERY");

      const requestedIds = new Set(body.items.map((item) => item.orderItemId));
      if (requestedIds.size !== body.items.length) throw new Error("RETURN_DUPLICATE_ITEM");

      const byId = new Map(vendorOrder.items.map((item) => [item.id, item]));
      const prior = await tx.returnItem.groupBy({
        by: ["orderItemId"],
        where: {
          orderItemId: { in: [...requestedIds] },
          returnRequest: { status: { notIn: ["REJECTED", "CANCELLED"] } },
        },
        _sum: { quantity: true },
      });
      const priorByItem = new Map(
        prior.map((row) => [row.orderItemId, row._sum.quantity ?? 0]),
      );

      for (const item of body.items) {
        const orderItem = byId.get(item.orderItemId);
        if (!orderItem) throw new Error("RETURN_ITEM_NOT_IN_ORDER");
        const already = priorByItem.get(item.orderItemId) ?? 0;
        if (already + item.quantity > orderItem.quantity) {
          throw new Error("RETURN_QUANTITY_EXCEEDED");
        }
      }

      const created = await tx.returnRequest.create({
        data: {
          userId,
          vendorOrderId: vendorOrder.id,
          reason: body.reason,
          items: {
            create: body.items.map((item) => ({
              orderItemId: item.orderItemId,
              quantity: item.quantity,
              ...(item.condition ? { condition: item.condition } : {}),
              ...(item.reason ? { reason: item.reason } : {}),
            })),
          },
        },
      });

      await writeAuditEntry(tx, {
        actorType: "USER",
        actorUserId: userId,
        action: "return.requested",
        entityType: "ReturnRequest",
        entityId: created.id,
        metadata: { vendorOrderId: vendorOrder.id },
      });
      await enqueueOutboxEvent(tx, {
        aggregateType: "ReturnRequest",
        aggregateId: created.id,
        eventType: "return.requested",
        payload: { returnRequestId: created.id, vendorOrderId: vendorOrder.id, userId },
      });
      return created.id;
    });

    return this.database.returnRequest.findUniqueOrThrow({ where: { id }, include: returnInclude });
  }

  findBuyerReturn(userId: string, returnRequestId: string): Promise<ReturnRecord | null> {
    return this.database.returnRequest.findFirst({
      where: { id: returnRequestId, userId },
      include: returnInclude,
    });
  }

  async listBuyerReturns(input: {
    userId: string;
    status?: ReturnStatusDto;
    page: number;
    pageSize: number;
  }) {
    const where = {
      userId: input.userId,
      ...(input.status ? { status: input.status } : {}),
    };
    const [items, totalItems] = await Promise.all([
      this.database.returnRequest.findMany({
        where,
        include: returnInclude,
        orderBy: { requestedAt: "desc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.database.returnRequest.count({ where }),
    ]);
    return { items, totalItems };
  }

  async listStoreReturns(input: {
    storeId: string;
    status?: ReturnStatusDto;
    page: number;
    pageSize: number;
  }) {
    const where = {
      vendorOrder: { storeId: input.storeId },
      ...(input.status ? { status: input.status } : {}),
    };
    const [items, totalItems] = await Promise.all([
      this.database.returnRequest.findMany({
        where,
        include: returnInclude,
        orderBy: { requestedAt: "desc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.database.returnRequest.count({ where }),
    ]);
    return { items, totalItems };
  }

  async findReturnWithStore(returnRequestId: string) {
    return this.database.returnRequest.findUnique({
      where: { id: returnRequestId },
      include: {
        ...returnInclude,
        vendorOrder: { select: { storeId: true, vendorId: true, status: true } },
      },
    });
  }

  async transitionReturn(input: {
    returnRequestId: string;
    from: ReturnStatusDto;
    to: ReturnStatusDto;
    actorUserId: string;
    note?: string;
    now: Date;
  }): Promise<ReturnRecord | null> {
    const changed = await this.database.$transaction(async (tx) => {
      const result = await tx.returnRequest.updateMany({
        where: { id: input.returnRequestId, status: input.from },
        data: {
          status: input.to,
          ...(input.to === "APPROVED" ? { approvedAt: input.now } : {}),
          ...(input.to === "RECEIVED" ? { receivedAt: input.now } : {}),
          ...(input.to === "COMPLETED" ? { completedAt: input.now } : {}),
        },
      });
      if (result.count !== 1) return false;

      await writeAuditEntry(tx, {
        actorType: "USER",
        actorUserId: input.actorUserId,
        action: "return.status_changed",
        entityType: "ReturnRequest",
        entityId: input.returnRequestId,
        metadata: { from: input.from, to: input.to, ...(input.note ? { note: input.note } : {}) },
      });
      await enqueueOutboxEvent(tx, {
        aggregateType: "ReturnRequest",
        aggregateId: input.returnRequestId,
        eventType: "return.status_changed",
        payload: { returnRequestId: input.returnRequestId, from: input.from, to: input.to },
      });
      return true;
    });

    return changed
      ? this.database.returnRequest.findUnique({ where: { id: input.returnRequestId }, include: returnInclude })
      : null;
  }

  async restockReturn(returnRequestId: string, actorUserId: string): Promise<number> {
    return this.database.$transaction(async (tx) => {
      // Explicit restocking is idempotent only if competing restock commands are serialized.
      // A non-unique InventoryAdjustment index alone does not prevent two callers from both
      // observing "no adjustment" and incrementing stock.
      if (!(await lockReturnRequest(tx, returnRequestId))) throw new Error("RETURN_NOT_FOUND");

      const request = await tx.returnRequest.findUnique({
        where: { id: returnRequestId },
        include: { items: { include: { orderItem: true } } },
      });
      if (!request) throw new Error("RETURN_NOT_FOUND");
      if (!(["RECEIVED", "INSPECTING", "REFUND_PENDING", "COMPLETED"] as string[]).includes(request.status)) {
        throw new Error("RETURN_NOT_RESTOCKABLE");
      }

      let count = 0;
      for (const item of request.items) {
        const referenceId = item.id;
        const existing = await tx.inventoryAdjustment.findFirst({
          where: { referenceType: "RETURN_RESTOCK", referenceId },
        });
        if (existing) continue;

        await tx.inventoryItem.upsert({
          where: { variantId: item.orderItem.variantId },
          create: { variantId: item.orderItem.variantId, onHand: item.quantity, reserved: 0, version: 1 },
          update: { onHand: { increment: item.quantity }, version: { increment: 1 } },
        });
        await tx.inventoryAdjustment.create({
          data: {
            variantId: item.orderItem.variantId,
            delta: item.quantity,
            reason: "Returned merchandise restocked",
            referenceType: "RETURN_RESTOCK",
            referenceId,
            actorUserId,
          },
        });
        count += 1;
      }

      await writeAuditEntry(tx, {
        actorType: "USER",
        actorUserId,
        action: "return.restocked",
        entityType: "ReturnRequest",
        entityId: returnRequestId,
        metadata: { adjustedItems: count },
      });
      return count;
    });
  }

  async createRefundRequest(input: {
    actorUserId: string;
    vendorOrderId: string;
    amountMinor: bigint;
    reason: string;
    orderItemId?: string;
    returnRequestId?: string;
    idempotencyKey: string;
  }): Promise<
    | { kind: "created" | "replayed"; refund: RefundRecord }
    | { kind: "conflict" | "in_progress" | "not_found" | "amount_exceeded" | "payment_unavailable" }
  > {
    const operation = `refund.request:${input.vendorOrderId}`;
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          amountMinor: input.amountMinor.toString(),
          reason: input.reason,
          orderItemId: input.orderItemId ?? null,
          returnRequestId: input.returnRequestId ?? null,
        }),
      )
      .digest("hex");

    try {
      const result = await this.database.$transaction(async (tx) => {
        const existing = await tx.idempotencyRecord.findUnique({
          where: {
            principalId_operation_idempotencyKey: {
              principalId: input.actorUserId,
              operation,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (existing) {
          if (existing.requestFingerprint !== fingerprint) return { kind: "conflict" as const };
          if (existing.resourceId) return { kind: "replayed_id" as const, id: existing.resourceId };
          return { kind: "in_progress" as const };
        }

        if (!(await lockVendorOrder(tx, input.vendorOrderId))) return { kind: "not_found" as const };

        const vendorOrder = await tx.vendorOrder.findUnique({
          where: { id: input.vendorOrderId },
          include: {
            order: { include: { paymentIntents: { include: { attempts: true } } } },
            items: true,
          },
        });
        if (!vendorOrder) return { kind: "not_found" as const };

        const intent =
          vendorOrder.order.paymentIntents.find((entry) => entry.status === "SUCCEEDED") ??
          vendorOrder.order.paymentIntents[0];
        if (
          !intent ||
          (vendorOrder.order.paymentStatus !== "SUCCEEDED" &&
            !["PARTIALLY_REFUNDED", "REFUNDED"].includes(vendorOrder.order.paymentStatus))
        ) {
          return { kind: "payment_unavailable" as const };
        }

        if (input.orderItemId && !vendorOrder.items.some((item) => item.id === input.orderItemId)) {
          return { kind: "not_found" as const };
        }
        if (input.returnRequestId) {
          const request = await tx.returnRequest.findFirst({
            where: {
              id: input.returnRequestId,
              vendorOrderId: vendorOrder.id,
              status: { notIn: ["REJECTED", "CANCELLED"] },
            },
          });
          if (!request) return { kind: "not_found" as const };
        }

        const aggregate = await tx.refund.aggregate({
          where: {
            vendorOrderId: vendorOrder.id,
            status: { in: ["REQUESTED", "APPROVED", "PROCESSING", "SUCCEEDED"] },
          },
          _sum: { amountMinor: true },
        });
        const reserved = aggregate._sum.amountMinor ?? 0n;
        if (input.amountMinor <= 0n || reserved + input.amountMinor > vendorOrder.totalAmountMinor) {
          return { kind: "amount_exceeded" as const };
        }

        const successfulAttempt = intent.attempts.find(
          (attempt) => attempt.status === "SUCCEEDED" && attempt.providerTxnId,
        );
        if (!successfulAttempt) return { kind: "payment_unavailable" as const };

        const idem = await tx.idempotencyRecord.create({
          data: {
            principalId: input.actorUserId,
            operation,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: fingerprint,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
        const refund = await tx.refund.create({
          data: {
            paymentIntentId: intent.id,
            vendorOrderId: vendorOrder.id,
            ...(input.orderItemId ? { orderItemId: input.orderItemId } : {}),
            ...(input.returnRequestId ? { returnRequestId: input.returnRequestId } : {}),
            provider: successfulAttempt.provider,
            amountMinor: input.amountMinor,
            currency: vendorOrder.currency,
            reason: input.reason,
            requestedBy: input.actorUserId,
          },
        });
        await tx.idempotencyRecord.update({
          where: { id: idem.id },
          data: {
            status: "COMPLETED",
            resourceType: "Refund",
            resourceId: refund.id,
            responseStatus: 201,
          },
        });
        await writeAuditEntry(tx, {
          actorType: "USER",
          actorUserId: input.actorUserId,
          action: "refund.requested",
          entityType: "Refund",
          entityId: refund.id,
          metadata: { vendorOrderId: vendorOrder.id, amountMinor: input.amountMinor.toString() },
        });
        await enqueueOutboxEvent(tx, {
          aggregateType: "Refund",
          aggregateId: refund.id,
          eventType: "refund.requested",
          payload: {
            refundId: refund.id,
            vendorOrderId: vendorOrder.id,
            amountMinor: input.amountMinor.toString(),
          },
        });
        return { kind: "created_id" as const, id: refund.id };
      });

      if (result.kind === "created_id" || result.kind === "replayed_id") {
        const refund = await this.database.refund.findUniqueOrThrow({
          where: { id: result.id },
          include: refundInclude,
        });
        return {
          kind: result.kind === "created_id" ? "created" : "replayed",
          refund,
        };
      }
      return result;
    } catch (error) {
      if (isUniqueViolation(error)) return { kind: "in_progress" };
      throw error;
    }
  }

  findRefund(refundId: string): Promise<RefundRecord | null> {
    return this.database.refund.findUnique({ where: { id: refundId }, include: refundInclude });
  }

  async claimRefundForExecution(refundId: string): Promise<RefundRecord | null> {
    const result = await this.database.refund.updateMany({
      where: { id: refundId, status: { in: ["REQUESTED", "APPROVED"] } },
      data: { status: "APPROVED" },
    });
    if (result.count !== 1) return this.findRefund(refundId);
    return this.findRefund(refundId);
  }

  successfulPaymentSource(refund: RefundRecord): SuccessfulPaymentSource | null {
    const attempt = refund.paymentIntent.attempts.find(
      (entry) =>
        entry.status === "SUCCEEDED" &&
        entry.providerTxnId &&
        entry.provider === refund.provider,
    );
    return attempt?.providerTxnId
      ? { provider: attempt.provider, providerTransactionId: attempt.providerTxnId }
      : null;
  }

  async markRefundSubmitted(input: {
    refundId: string;
    providerRefundReference: string;
    succeeded: boolean;
  }): Promise<RefundRecord> {
    return this.database.$transaction(async (tx) => {
      const refund = await tx.refund.update({
        where: { id: input.refundId },
        data: {
          providerRefundReference: input.providerRefundReference,
          status: input.succeeded ? "SUCCEEDED" : "PROCESSING",
          ...(input.succeeded ? { completedAt: new Date() } : {}),
        },
        include: refundInclude,
      });
      if (input.succeeded) await this.applyRefundAggregate(tx, refund);
      return refund;
    });
  }

  async markRefundFailure(refundId: string): Promise<RefundRecord> {
    return this.database.refund.update({
      where: { id: refundId },
      data: { status: "FAILED" },
      include: refundInclude,
    });
  }

  async updateRefundVerification(
    refundId: string,
    status: "PROCESSING" | "SUCCEEDED" | "FAILED",
  ): Promise<RefundRecord> {
    return this.database.$transaction(async (tx) => {
      if (status === "PROCESSING") {
        return tx.refund.findUniqueOrThrow({ where: { id: refundId }, include: refundInclude });
      }

      // Reconciliation may run concurrently in an admin request and a worker. Only one caller
      // may move PROCESSING to a terminal state and emit terminal aggregate/outbox effects.
      const changed = await tx.refund.updateMany({
        where: { id: refundId, status: "PROCESSING" },
        data: {
          status,
          ...(status === "SUCCEEDED" ? { completedAt: new Date() } : {}),
        },
      });
      const refund = await tx.refund.findUniqueOrThrow({
        where: { id: refundId },
        include: refundInclude,
      });
      if (changed.count === 1 && status === "SUCCEEDED") {
        await this.applyRefundAggregate(tx, refund);
      }
      return refund;
    });
  }

  private async applyRefundAggregate(
    tx: Prisma.TransactionClient,
    refund: RefundRecord,
  ): Promise<void> {
    const vendorOrderId = refund.vendorOrderId;
    if (!vendorOrderId) return;

    const vendorOrder = await tx.vendorOrder.findUniqueOrThrow({ where: { id: vendorOrderId } });
    const vendorSum = await tx.refund.aggregate({
      where: { vendorOrderId, status: "SUCCEEDED" },
      _sum: { amountMinor: true },
    });
    const vendorRefunded = vendorSum._sum.amountMinor ?? 0n;
    await tx.vendorOrder.update({
      where: { id: vendorOrderId },
      data: {
        status: vendorRefunded >= vendorOrder.totalAmountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED",
      },
    });

    const intent = await tx.paymentIntent.findUniqueOrThrow({
      where: { id: refund.paymentIntentId },
      include: { order: true },
    });
    const allSum = await tx.refund.aggregate({
      where: { paymentIntentId: intent.id, status: "SUCCEEDED" },
      _sum: { amountMinor: true },
    });
    const refunded = allSum._sum.amountMinor ?? 0n;
    const full = refunded >= intent.amountMinor;
    await tx.paymentIntent.update({
      where: { id: intent.id },
      data: { status: full ? "REFUNDED" : "PARTIALLY_REFUNDED" },
    });
    await tx.order.update({
      where: { id: intent.orderId },
      data: {
        paymentStatus: full ? "REFUNDED" : "PARTIALLY_REFUNDED",
        status: full ? "REFUNDED" : "PARTIALLY_REFUNDED",
      },
    });
    if (refund.returnRequestId) {
      await tx.returnRequest.updateMany({
        where: { id: refund.returnRequestId, status: "REFUND_PENDING" },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }
    await enqueueOutboxEvent(tx, {
      aggregateType: "Refund",
      aggregateId: refund.id,
      eventType: "refund.succeeded",
      payload: {
        refundId: refund.id,
        paymentIntentId: refund.paymentIntentId,
        amountMinor: refund.amountMinor.toString(),
      },
    });
  }

  listRefundReconciliationCandidates(limit = 100) {
    return this.database.refund.findMany({
      where: { status: "PROCESSING", providerRefundReference: { not: null } },
      include: refundInclude,
      orderBy: { updatedAt: "asc" },
      take: limit,
    });
  }

  async createProductReview(userId: string, body: CreateProductReviewBodyDto) {
    const orderItem = await this.database.orderItem.findFirst({
      where: {
        id: body.orderItemId,
        vendorOrder: { order: { userId }, status: "DELIVERED" },
      },
    });
    if (!orderItem) throw new Error("REVIEW_REQUIRES_DELIVERED_PURCHASE");
    try {
      return await this.database.productReview.create({
        data: {
          userId,
          productId: orderItem.productId,
          orderItemId: orderItem.id,
          rating: body.rating,
          ...(body.text ? { text: body.text } : {}),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error("REVIEW_ALREADY_EXISTS");
      throw error;
    }
  }

  async createStoreReview(userId: string, body: CreateStoreReviewBodyDto) {
    const vendorOrder = await this.database.vendorOrder.findFirst({
      where: { id: body.vendorOrderId, order: { userId }, status: "DELIVERED" },
    });
    if (!vendorOrder) throw new Error("REVIEW_REQUIRES_DELIVERED_PURCHASE");
    try {
      return await this.database.storeReview.create({
        data: {
          userId,
          storeId: vendorOrder.storeId,
          vendorOrderId: vendorOrder.id,
          rating: body.rating,
          ...(body.text ? { text: body.text } : {}),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error("REVIEW_ALREADY_EXISTS");
      throw error;
    }
  }

  async listProductReviews(productId: string, page: number, pageSize: number) {
    const where = { productId, status: "APPROVED" as const };
    const [items, totalItems] = await Promise.all([
      this.database.productReview.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.productReview.count({ where }),
    ]);
    return { items, totalItems };
  }

  async listStoreReviews(storeId: string, page: number, pageSize: number) {
    const where = { storeId, status: "APPROVED" as const };
    const [items, totalItems] = await Promise.all([
      this.database.storeReview.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.storeReview.count({ where }),
    ]);
    return { items, totalItems };
  }

  async moderateReview(input: {
    reviewId: string;
    status: ReviewStatusDto;
    actorUserId: string;
    reason?: string;
  }) {
    const product = await this.database.productReview.findUnique({ where: { id: input.reviewId } });
    if (product) {
      return this.database.$transaction(async (tx) => {
        const changed = await tx.productReview.update({
          where: { id: input.reviewId },
          data: { status: input.status },
        });
        await writeAuditEntry(tx, {
          actorType: "USER",
          actorUserId: input.actorUserId,
          action: "review.moderated",
          entityType: "ProductReview",
          entityId: input.reviewId,
          metadata: { status: input.status, ...(input.reason ? { reason: input.reason } : {}) },
        });
        return { type: "PRODUCT" as const, record: changed };
      });
    }

    const store = await this.database.storeReview.findUnique({ where: { id: input.reviewId } });
    if (!store) return null;
    return this.database.$transaction(async (tx) => {
      const changed = await tx.storeReview.update({
        where: { id: input.reviewId },
        data: { status: input.status },
      });
      await writeAuditEntry(tx, {
        actorType: "USER",
        actorUserId: input.actorUserId,
        action: "review.moderated",
        entityType: "StoreReview",
        entityId: input.reviewId,
        metadata: { status: input.status, ...(input.reason ? { reason: input.reason } : {}) },
      });
      return { type: "STORE" as const, record: changed };
    });
  }
}
