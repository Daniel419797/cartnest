import type {
  AdminPrivacyRequestDto,
  AdminPrivacyRequestListResponseDto,
  PrivacyExportDto,
  PrivacyRequestDto,
  PrivacyRequestListQueryDto,
  PrivacyRequestListResponseDto,
  ProcessPrivacyRequestBodyDto,
} from "@repo/contracts";
import type { DatabaseClient } from "@repo/database";
import { Prisma, writeAuditEntry } from "@repo/database";
import {
  requirePlatformRole,
  requirePrivilegedMfa,
  type AccessPrincipal,
} from "../auth/auth.public.js";

export class PrivacyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "PrivacyError";
  }
}

type PrivacyReadClient = Pick<
  DatabaseClient,
  "user" | "vendorMember" | "order" | "returnRequest" | "refund"
>;

function mapRequest(record: {
  id: string;
  status: "PENDING" | "REQUIRES_REVIEW" | "COMPLETED" | "REJECTED";
  reviewNote: string | null;
  requestedAt: Date;
  processedAt: Date | null;
}): PrivacyRequestDto {
  return {
    id: record.id,
    status: record.status,
    reviewNote: record.reviewNote,
    requestedAt: record.requestedAt.toISOString(),
    processedAt: record.processedAt?.toISOString() ?? null,
  };
}

function mapAdminRequest(record: {
  id: string;
  userId: string;
  status: "PENDING" | "REQUIRES_REVIEW" | "COMPLETED" | "REJECTED";
  reviewNote: string | null;
  requestedAt: Date;
  processedAt: Date | null;
}): AdminPrivacyRequestDto {
  return {
    id: record.id,
    subjectUserId: record.userId,
    status: record.status,
    reviewNote: record.reviewNote,
    requestedAt: record.requestedAt.toISOString(),
    processedAt: record.processedAt?.toISOString() ?? null,
  };
}

function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, child) =>
      typeof child === "bigint" ? child.toString() : child,
    ),
  ) as unknown;
}

function pagination(page: number, pageSize: number, totalItems: number) {
  return {
    page,
    pageSize,
    totalItems,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
  };
}

function prismaCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function isTransactionConflict(error: unknown): boolean {
  return prismaCode(error) === "P2034";
}

function isUniqueConstraintConflict(error: unknown): boolean {
  return prismaCode(error) === "P2002";
}

export class PrivacyService {
  constructor(private readonly database: DatabaseClient) {}

  private requireAdmin(principal: AccessPrincipal): void {
    requirePlatformRole(principal, ["ADMIN", "SUPER_ADMIN"]);
    requirePrivilegedMfa(principal);
  }

  private async erasureBlockers(
    userId: string,
    database: PrivacyReadClient = this.database,
  ): Promise<string[]> {
    const [user, ownerMemberships, openOrders, openReturns, openRefunds] = await Promise.all([
      database.user.findUnique({
        where: { id: userId },
        select: { platformRole: true },
      }),
      database.vendorMember.count({
        where: { userId, role: "OWNER", status: "ACTIVE" },
      }),
      database.order.count({
        where: {
          userId,
          status: { in: ["PENDING_PAYMENT", "PAID", "PARTIALLY_FULFILLED"] },
        },
      }),
      database.returnRequest.count({
        where: {
          userId,
          status: {
            in: [
              "REQUESTED",
              "APPROVED",
              "AWAITING_RETURN",
              "IN_TRANSIT",
              "RECEIVED",
              "INSPECTING",
              "REFUND_PENDING",
            ],
          },
        },
      }),
      database.refund.count({
        where: {
          requestedBy: userId,
          status: { in: ["REQUESTED", "APPROVED", "PROCESSING"] },
        },
      }),
    ]);

    const blockers: string[] = [];
    if (!user) blockers.push("ACCOUNT_NOT_FOUND");
    if (user?.platformRole !== "USER") blockers.push("PRIVILEGED_PLATFORM_ROLE");
    if (ownerMemberships > 0) blockers.push("ACTIVE_VENDOR_OWNERSHIP");
    if (openOrders > 0) blockers.push("OPEN_ORDERS");
    if (openReturns > 0) blockers.push("OPEN_RETURNS");
    if (openRefunds > 0) blockers.push("OPEN_REFUNDS");
    return blockers;
  }

  async exportData(principal: AccessPrincipal): Promise<PrivacyExportDto> {
    const user = await this.database.user.findUnique({
      where: { id: principal.userId },
      select: {
        id: true,
        email: true,
        phone: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        status: true,
        platformRole: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) throw new PrivacyError("ACCOUNT_NOT_FOUND", "Account was not found.", 404);

    const [addresses, memberships, orders, productReviews, storeReviews, returns, preferences] =
      await Promise.all([
        this.database.address.findMany({ where: { userId: principal.userId }, orderBy: { createdAt: "asc" } }),
        this.database.vendorMember.findMany({
          where: { userId: principal.userId },
          include: {
            vendor: { select: { id: true, displayName: true, status: true } },
            permissions: { select: { permission: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
        this.database.order.findMany({
          where: { userId: principal.userId },
          include: {
            vendorOrders: {
              include: {
                items: true,
                shipments: true,
                refunds: true,
                returns: { include: { items: true } },
              },
            },
            paymentIntents: { include: { attempts: true, refunds: true } },
            promotionRedemptions: true,
          },
          orderBy: { createdAt: "asc" },
        }),
        this.database.productReview.findMany({ where: { userId: principal.userId }, orderBy: { createdAt: "asc" } }),
        this.database.storeReview.findMany({ where: { userId: principal.userId }, orderBy: { createdAt: "asc" } }),
        this.database.returnRequest.findMany({
          where: { userId: principal.userId },
          include: { items: true, refunds: true },
          orderBy: { requestedAt: "asc" },
        }),
        this.database.notificationPreference.findMany({
          where: { userId: principal.userId },
          orderBy: [{ channel: "asc" }, { scopeKey: "asc" }],
        }),
      ]);

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      subjectId: principal.userId,
      data: jsonSafe({
        account: user,
        addresses,
        vendorMemberships: memberships,
        orders,
        productReviews,
        storeReviews,
        returnRequests: returns,
        notificationPreferences: preferences,
      }) as Record<string, unknown>,
    };
  }

  async requestErasure(principal: AccessPrincipal): Promise<PrivacyRequestDto> {
    const activeWhere: Prisma.PrivacyRequestWhereInput = {
      userId: principal.userId,
      status: { in: ["PENDING", "REQUIRES_REVIEW"] },
    };
    const existing = await this.database.privacyRequest.findFirst({
      where: activeWhere,
      orderBy: { requestedAt: "desc" },
    });
    if (existing) return mapRequest(existing);

    const blockers = await this.erasureBlockers(principal.userId);
    try {
      const request = await this.database.$transaction(async (tx) => {
        const created = await tx.privacyRequest.create({
          data: {
            userId: principal.userId,
            status: blockers.length > 0 ? "REQUIRES_REVIEW" : "PENDING",
            reviewNote: blockers.length > 0 ? `Automatic erasure blocked: ${blockers.join(", ")}` : null,
          },
        });
        await writeAuditEntry(tx, {
          actorType: "USER",
          actorUserId: principal.userId,
          action: "privacy.erasure.requested",
          entityType: "PrivacyRequest",
          entityId: created.id,
          metadata: { blockers },
        });
        return created;
      });
      return mapRequest(request);
    } catch (error) {
      if (!isUniqueConstraintConflict(error)) throw error;
      const concurrent = await this.database.privacyRequest.findFirst({
        where: activeWhere,
        orderBy: { requestedAt: "desc" },
      });
      if (concurrent) return mapRequest(concurrent);
      throw new PrivacyError(
        "PRIVACY_REQUEST_STATE_CONFLICT",
        "A concurrent privacy request changed account state. Refresh and try again.",
        409,
      );
    }
  }

  async listMyRequests(
    principal: AccessPrincipal,
    query: PrivacyRequestListQueryDto,
  ): Promise<PrivacyRequestListResponseDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      userId: principal.userId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, totalItems] = await Promise.all([
      this.database.privacyRequest.findMany({
        where,
        orderBy: { requestedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.privacyRequest.count({ where }),
    ]);
    return {
      items: items.map(mapRequest),
      pagination: pagination(page, pageSize, totalItems),
    };
  }

  async listAdminRequests(
    principal: AccessPrincipal,
    query: PrivacyRequestListQueryDto,
  ): Promise<AdminPrivacyRequestListResponseDto> {
    this.requireAdmin(principal);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = query.status ? { status: query.status } : {};
    const [items, totalItems] = await Promise.all([
      this.database.privacyRequest.findMany({
        where,
        orderBy: { requestedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.privacyRequest.count({ where }),
    ]);
    return {
      items: items.map(mapAdminRequest),
      pagination: pagination(page, pageSize, totalItems),
    };
  }

  async processRequest(
    principal: AccessPrincipal,
    privacyRequestId: string,
    body: ProcessPrivacyRequestBodyDto,
  ): Promise<PrivacyRequestDto> {
    this.requireAdmin(principal);
    const request = await this.database.privacyRequest.findUnique({ where: { id: privacyRequestId } });
    if (!request) throw new PrivacyError("PRIVACY_REQUEST_NOT_FOUND", "Privacy request was not found.", 404);
    if (["COMPLETED", "REJECTED"].includes(request.status)) {
      throw new PrivacyError("PRIVACY_REQUEST_FINAL", "Privacy request has already reached a final state.", 409);
    }

    if (body.decision === "REJECT") {
      const rejected = await this.database.$transaction(async (tx) => {
        const changed = await tx.privacyRequest.updateMany({
          where: {
            id: request.id,
            status: { in: ["PENDING", "REQUIRES_REVIEW"] },
            reviewNote: request.reviewNote,
          },
          data: {
            status: "REJECTED",
            reviewNote: body.reason,
            processedAt: new Date(),
            processedBy: principal.userId,
          },
        });
        if (changed.count !== 1) {
          throw new PrivacyError(
            "PRIVACY_REQUEST_STATE_CONFLICT",
            "Privacy request state changed before this decision could be recorded. Refresh and try again.",
            409,
          );
        }
        const updated = await tx.privacyRequest.findUnique({ where: { id: request.id } });
        if (!updated) throw new PrivacyError("PRIVACY_REQUEST_NOT_FOUND", "Privacy request was not found.", 404);
        await writeAuditEntry(tx, {
          actorType: "USER",
          actorUserId: principal.userId,
          action: "privacy.erasure.rejected",
          entityType: "PrivacyRequest",
          entityId: request.id,
          metadata: { subjectUserId: request.userId, reason: body.reason },
        });
        return updated;
      });
      return mapRequest(rejected);
    }

    try {
      const outcome = await this.database.$transaction(async (tx) => {
        const current = await tx.privacyRequest.findUnique({ where: { id: privacyRequestId } });
        if (!current) throw new PrivacyError("PRIVACY_REQUEST_NOT_FOUND", "Privacy request was not found.", 404);
        if (["COMPLETED", "REJECTED"].includes(current.status)) {
          throw new PrivacyError("PRIVACY_REQUEST_FINAL", "Privacy request has already reached a final state.", 409);
        }

        const blockers = await this.erasureBlockers(current.userId, tx);
        if (blockers.length > 0) {
          const changed = await tx.privacyRequest.updateMany({
            where: {
              id: current.id,
              status: { in: ["PENDING", "REQUIRES_REVIEW"] },
              reviewNote: current.reviewNote,
            },
            data: {
              status: "REQUIRES_REVIEW",
              reviewNote: `Cannot anonymize yet: ${blockers.join(", ")}. ${body.reason}`,
            },
          });
          if (changed.count !== 1) {
            throw new PrivacyError(
              "PRIVACY_REQUEST_STATE_CONFLICT",
              "Privacy request state changed while blockers were being reviewed. Refresh and try again.",
              409,
            );
          }
          return { kind: "blocked" as const };
        }

        const claimed = await tx.privacyRequest.updateMany({
          where: {
            id: current.id,
            status: { in: ["PENDING", "REQUIRES_REVIEW"] },
            reviewNote: current.reviewNote,
          },
          data: { reviewNote: `Anonymization approved and processing. ${body.reason}` },
        });
        if (claimed.count !== 1) {
          throw new PrivacyError(
            "PRIVACY_REQUEST_STATE_CONFLICT",
            "Privacy request state changed before anonymization could begin. Refresh and try again.",
            409,
          );
        }

        const returnRows = await tx.returnRequest.findMany({
          where: { userId: current.userId },
          select: { id: true },
        });
        const returnIds = returnRows.map((row) => row.id);
        const now = new Date();

        await tx.authIdentity.deleteMany({ where: { userId: current.userId } });
        await tx.authSession.deleteMany({ where: { userId: current.userId } });
        await tx.mfaFactor.deleteMany({ where: { userId: current.userId } });
        await tx.address.deleteMany({ where: { userId: current.userId } });
        await tx.wishlist.deleteMany({ where: { userId: current.userId } });
        await tx.cart.deleteMany({ where: { userId: current.userId } });
        await tx.notificationReceipt.deleteMany({ where: { userId: current.userId } });
        await tx.notificationPreference.deleteMany({ where: { userId: current.userId } });
        await tx.notification.updateMany({
          where: { userId: current.userId },
          data: {
            userId: null,
            recipient: "redacted",
            payload: { redacted: true },
            lastError: null,
          },
        });
        await tx.productReview.updateMany({ where: { userId: current.userId }, data: { text: null } });
        await tx.storeReview.updateMany({ where: { userId: current.userId }, data: { text: null } });
        await tx.returnRequest.updateMany({
          where: { userId: current.userId },
          data: { reason: "Redacted after approved account-erasure request." },
        });
        if (returnIds.length > 0) {
          await tx.returnItem.updateMany({
            where: { returnRequestId: { in: returnIds } },
            data: { reason: null },
          });
        }
        await tx.order.updateMany({
          where: { userId: current.userId },
          data: { deliveryAddressSnapshot: { redacted: true } },
        });
        await tx.vendorMember.updateMany({
          where: { userId: current.userId, role: "STAFF", status: { in: ["INVITED", "ACTIVE", "SUSPENDED"] } },
          data: { status: "REMOVED" },
        });
        await tx.user.update({
          where: { id: current.userId },
          data: {
            email: null,
            normalizedEmail: null,
            phone: null,
            normalizedPhone: null,
            passwordHash: null,
            emailVerifiedAt: null,
            phoneVerifiedAt: null,
            platformRole: "USER",
            status: "DISABLED",
          },
        });
        const updated = await tx.privacyRequest.update({
          where: { id: current.id },
          data: {
            status: "COMPLETED",
            reviewNote: body.reason,
            processedAt: now,
            processedBy: principal.userId,
          },
        });
        await writeAuditEntry(tx, {
          actorType: "USER",
          actorUserId: principal.userId,
          action: "privacy.erasure.completed",
          entityType: "PrivacyRequest",
          entityId: current.id,
          metadata: { subjectUserId: current.userId, reason: body.reason },
        });
        return { kind: "completed" as const, request: updated };
      }, { isolationLevel: "Serializable" });

      if (outcome.kind === "blocked") {
        throw new PrivacyError(
          "PRIVACY_ERASURE_BLOCKED",
          "Account cannot be anonymized while protected business or fulfillment obligations remain active.",
          409,
        );
      }
      return mapRequest(outcome.request);
    } catch (error) {
      if (isTransactionConflict(error)) {
        throw new PrivacyError(
          "PRIVACY_REQUEST_STATE_CONFLICT",
          "Privacy request or protected account obligations changed during processing. Refresh and try again.",
          409,
        );
      }
      throw error;
    }
  }
}
