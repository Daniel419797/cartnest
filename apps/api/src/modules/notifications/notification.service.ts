import type {
  NotificationChannelDto,
  NotificationDto,
  NotificationListQueryDto,
  NotificationListResponseDto,
  NotificationPreferenceDto,
  OperationalNotificationListResponseDto,
  OperationalNotificationQueryDto,
  UpdateNotificationPreferenceBodyDto,
} from "@repo/contracts";
import type { DatabaseClient } from "@repo/database";
import { writeAuditEntry } from "@repo/database";
import {
  requirePlatformRole,
  requirePrivilegedMfa,
  type AccessPrincipal,
} from "../auth/auth.public.js";

export class NotificationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "NotificationError";
  }
}

interface NotificationRecipient {
  readonly userId: string;
  readonly email: string | null;
  readonly phone: string | null;
}

interface QueueTarget {
  readonly recipient: NotificationRecipient;
  readonly channel: NotificationChannelDto;
  readonly templateKey: string;
  readonly required: boolean;
  readonly dedupeBase: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface DomainNotificationEvent {
  readonly eventType:
    | "order.created"
    | "payment.succeeded"
    | "shipment.delivered"
    | "refund.succeeded"
    | "return.status_changed";
  readonly aggregateId: string;
}

function pagination(page: number, pageSize: number, totalItems: number) {
  return {
    page,
    pageSize,
    totalItems,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
  };
}

function mapNotification(
  record: {
    id: string;
    channel: NotificationChannelDto;
    templateKey: string;
    status: NotificationDto["status"];
    payload: unknown;
    createdAt: Date;
    updatedAt: Date;
  },
  readAt: Date | null,
): NotificationDto {
  return {
    id: record.id,
    channel: record.channel,
    templateKey: record.templateKey,
    status: record.status,
    payload: record.payload,
    readAt: readAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export class NotificationService {
  constructor(private readonly database: DatabaseClient) {}

  private requireAdmin(principal: AccessPrincipal): void {
    requirePlatformRole(principal, ["ADMIN", "SUPER_ADMIN"]);
    requirePrivilegedMfa(principal);
  }

  private async preferenceEnabled(
    userId: string,
    channel: NotificationChannelDto,
    templateKey: string,
    required: boolean,
  ): Promise<boolean> {
    if (required) return true;
    const rows = await this.database.notificationPreference.findMany({
      where: { userId, channel, scopeKey: { in: [templateKey, "*"] } },
    });
    const exact = rows.find((item) => item.scopeKey === templateKey);
    if (exact) return exact.enabled;
    const wildcard = rows.find((item) => item.scopeKey === "*");
    if (wildcard) return wildcard.enabled;
    // SMS is opt-in by default; in-app/email optional notices default enabled.
    return channel !== "SMS";
  }

  private async queueTarget(target: QueueTarget): Promise<void> {
    if (!(await this.preferenceEnabled(
      target.recipient.userId,
      target.channel,
      target.templateKey,
      target.required,
    ))) return;

    const recipient =
      target.channel === "IN_APP"
        ? target.recipient.userId
        : target.channel === "EMAIL"
          ? target.recipient.email
          : target.recipient.phone;
    if (!recipient) return;

    const now = new Date();
    const dedupeKey = `${target.dedupeBase}:${target.channel.toLowerCase()}`;
    await this.database.notification.upsert({
      where: { dedupeKey },
      update: {},
      create: {
        userId: target.recipient.userId,
        channel: target.channel,
        templateKey: target.templateKey,
        recipient,
        status: target.channel === "IN_APP" ? "DELIVERED" : "QUEUED",
        dedupeKey,
        payload: target.payload as never,
        ...(target.channel === "IN_APP" ? { deliveredAt: now } : { nextAttemptAt: now }),
      },
    });
  }

  private async vendorRecipients(vendorId: string): Promise<NotificationRecipient[]> {
    const members = await this.database.vendorMember.findMany({
      where: {
        vendorId,
        status: "ACTIVE",
        OR: [
          { role: "OWNER" },
          {
            permissions: {
              some: {
                permission: {
                  in: ["order:read", "order:process", "order:fulfill", "refund:request"],
                },
              },
            },
          },
        ],
      },
      include: { user: { select: { id: true, email: true, phone: true } } },
    });
    const unique = new Map<string, NotificationRecipient>();
    for (const member of members) {
      unique.set(member.user.id, {
        userId: member.user.id,
        email: member.user.email,
        phone: member.user.phone,
      });
    }
    return [...unique.values()];
  }

  private customerTargets(
    recipient: NotificationRecipient,
    templateKey: string,
    dedupeBase: string,
    payload: Readonly<Record<string, unknown>>,
    options: { emailRequired: boolean; inAppRequired: boolean; optionalSms?: boolean },
  ): QueueTarget[] {
    return [
      { recipient, channel: "EMAIL", templateKey, required: options.emailRequired, dedupeBase, payload },
      { recipient, channel: "IN_APP", templateKey, required: options.inAppRequired, dedupeBase, payload },
      ...(options.optionalSms
        ? [{ recipient, channel: "SMS" as const, templateKey, required: false, dedupeBase, payload }]
        : []),
    ];
  }

  async materializeDomainEvent(event: DomainNotificationEvent): Promise<number> {
    const targets: QueueTarget[] = [];

    if (event.eventType === "order.created") {
      const order = await this.database.order.findUnique({
        where: { id: event.aggregateId },
        include: {
          user: { select: { id: true, email: true, phone: true } },
          vendorOrders: { select: { id: true, vendorId: true, store: { select: { name: true } } } },
        },
      });
      if (!order) return 0;
      const customer = { userId: order.user.id, email: order.user.email, phone: order.user.phone };
      targets.push(...this.customerTargets(
        customer,
        "order.created.customer.v1",
        `order-created:customer:${order.id}`,
        { orderId: order.id, orderNumber: order.orderNumber, amountMinor: order.grandTotalAmountMinor.toString(), currency: order.currency, storeCount: order.vendorOrders.length },
        { emailRequired: true, inAppRequired: true },
      ));
      for (const vendorOrder of order.vendorOrders) {
        for (const recipient of await this.vendorRecipients(vendorOrder.vendorId)) {
          targets.push(
            { recipient, channel: "EMAIL", templateKey: "order.created.vendor.v1", required: true, dedupeBase: `vendor-order-created:${vendorOrder.id}:${recipient.userId}`, payload: { orderId: order.id, vendorOrderId: vendorOrder.id, orderNumber: order.orderNumber, storeName: vendorOrder.store.name } },
            { recipient, channel: "IN_APP", templateKey: "order.created.vendor.v1", required: true, dedupeBase: `vendor-order-created:${vendorOrder.id}:${recipient.userId}`, payload: { orderId: order.id, vendorOrderId: vendorOrder.id, orderNumber: order.orderNumber, storeName: vendorOrder.store.name } },
          );
        }
      }
    }

    if (event.eventType === "payment.succeeded") {
      const intent = await this.database.paymentIntent.findUnique({
        where: { id: event.aggregateId },
        include: { order: { include: { user: { select: { id: true, email: true, phone: true } }, vendorOrders: { select: { id: true, vendorId: true } } } } },
      });
      if (!intent) return 0;
      const customer = { userId: intent.order.user.id, email: intent.order.user.email, phone: intent.order.user.phone };
      targets.push(...this.customerTargets(
        customer,
        "payment.succeeded.customer.v1",
        `payment-success:customer:${intent.id}`,
        { paymentIntentId: intent.id, orderId: intent.orderId, amountMinor: intent.amountMinor.toString(), currency: intent.currency },
        { emailRequired: true, inAppRequired: true },
      ));
      for (const vendorOrder of intent.order.vendorOrders) {
        for (const recipient of await this.vendorRecipients(vendorOrder.vendorId)) {
          targets.push({ recipient, channel: "IN_APP", templateKey: "payment.succeeded.vendor.v1", required: true, dedupeBase: `payment-success:vendor:${intent.id}:${recipient.userId}`, payload: { paymentIntentId: intent.id, orderId: intent.orderId, vendorOrderId: vendorOrder.id } });
        }
      }
    }

    if (event.eventType === "shipment.delivered") {
      const shipment = await this.database.shipment.findUnique({
        where: { id: event.aggregateId },
        include: { vendorOrder: { include: { order: { include: { user: { select: { id: true, email: true, phone: true } } } } } } },
      });
      if (!shipment) return 0;
      const user = shipment.vendorOrder.order.user;
      const customer = { userId: user.id, email: user.email, phone: user.phone };
      targets.push(...this.customerTargets(
        customer,
        "shipment.delivered.customer.v1",
        `shipment-delivered:${shipment.id}:customer`,
        { shipmentId: shipment.id, vendorOrderId: shipment.vendorOrderId, orderId: shipment.vendorOrder.orderId, trackingNumber: shipment.trackingNumber },
        { emailRequired: true, inAppRequired: true, optionalSms: true },
      ));
      for (const recipient of await this.vendorRecipients(shipment.vendorOrder.vendorId)) {
        targets.push({ recipient, channel: "IN_APP", templateKey: "shipment.delivered.vendor.v1", required: true, dedupeBase: `shipment-delivered:${shipment.id}:vendor:${recipient.userId}`, payload: { shipmentId: shipment.id, vendorOrderId: shipment.vendorOrderId } });
      }
    }

    if (event.eventType === "refund.succeeded") {
      const refund = await this.database.refund.findUnique({
        where: { id: event.aggregateId },
        include: { paymentIntent: { include: { order: { include: { user: { select: { id: true, email: true, phone: true } } } } } }, vendorOrder: true },
      });
      if (!refund) return 0;
      const user = refund.paymentIntent.order.user;
      const customer = { userId: user.id, email: user.email, phone: user.phone };
      targets.push(...this.customerTargets(
        customer,
        "refund.succeeded.customer.v1",
        `refund-success:${refund.id}:customer`,
        { refundId: refund.id, orderId: refund.paymentIntent.orderId, amountMinor: refund.amountMinor.toString(), currency: refund.currency },
        { emailRequired: true, inAppRequired: true },
      ));
      if (refund.vendorOrder) {
        for (const recipient of await this.vendorRecipients(refund.vendorOrder.vendorId)) {
          targets.push({ recipient, channel: "IN_APP", templateKey: "refund.succeeded.vendor.v1", required: true, dedupeBase: `refund-success:${refund.id}:vendor:${recipient.userId}`, payload: { refundId: refund.id, vendorOrderId: refund.vendorOrder.id, amountMinor: refund.amountMinor.toString(), currency: refund.currency } });
        }
      }
    }

    if (event.eventType === "return.status_changed") {
      const request = await this.database.returnRequest.findUnique({
        where: { id: event.aggregateId },
        include: { user: { select: { id: true, email: true, phone: true } }, vendorOrder: true },
      });
      if (!request) return 0;
      const customer = { userId: request.user.id, email: request.user.email, phone: request.user.phone };
      targets.push(...this.customerTargets(
        customer,
        "return.status.customer.v1",
        `return-status:${request.id}:${request.status}:customer`,
        { returnRequestId: request.id, vendorOrderId: request.vendorOrderId, status: request.status },
        { emailRequired: true, inAppRequired: true },
      ));
      for (const recipient of await this.vendorRecipients(request.vendorOrder.vendorId)) {
        targets.push({ recipient, channel: "IN_APP", templateKey: "return.status.vendor.v1", required: true, dedupeBase: `return-status:${request.id}:${request.status}:vendor:${recipient.userId}`, payload: { returnRequestId: request.id, vendorOrderId: request.vendorOrderId, status: request.status } });
      }
    }

    for (const target of targets) await this.queueTarget(target);
    return targets.length;
  }

  async listUserNotifications(
    principal: AccessPrincipal,
    query: NotificationListQueryDto,
  ): Promise<NotificationListResponseDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const receipts = await this.database.notificationReceipt.findMany({
      where: { userId: principal.userId },
      select: { notificationId: true, readAt: true },
    });
    const readById = new Map(receipts.map((receipt) => [receipt.notificationId, receipt.readAt]));
    const where = {
      userId: principal.userId,
      channel: "IN_APP" as const,
      ...(query.unreadOnly && receipts.length > 0
        ? { id: { notIn: receipts.map((receipt) => receipt.notificationId) } }
        : {}),
    };
    const [items, totalItems] = await Promise.all([
      this.database.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      this.database.notification.count({ where }),
    ]);
    return {
      items: items.map((item) => mapNotification(item, readById.get(item.id) ?? null)),
      pagination: pagination(page, pageSize, totalItems),
    };
  }

  async markRead(principal: AccessPrincipal, notificationId: string): Promise<NotificationDto> {
    const notification = await this.database.notification.findFirst({
      where: { id: notificationId, userId: principal.userId, channel: "IN_APP" },
    });
    if (!notification) throw new NotificationError("NOTIFICATION_NOT_FOUND", "Notification was not found.", 404);
    const receipt = await this.database.notificationReceipt.upsert({
      where: { notificationId },
      create: { notificationId, userId: principal.userId, readAt: new Date() },
      update: {},
    });
    return mapNotification(notification, receipt.readAt);
  }

  async listPreferences(principal: AccessPrincipal): Promise<{ items: NotificationPreferenceDto[] }> {
    const rows = await this.database.notificationPreference.findMany({
      where: { userId: principal.userId },
      orderBy: [{ channel: "asc" }, { scopeKey: "asc" }],
    });
    return { items: rows.map((item) => ({ channel: item.channel, scopeKey: item.scopeKey, enabled: item.enabled })) };
  }

  async updatePreference(
    principal: AccessPrincipal,
    body: UpdateNotificationPreferenceBodyDto,
  ): Promise<NotificationPreferenceDto> {
    const scopeKey = body.scopeKey || "*";
    if (scopeKey.startsWith("auth.") || scopeKey.startsWith("payment.") || scopeKey.startsWith("refund.")) {
      throw new NotificationError(
        "REQUIRED_NOTIFICATION_PREFERENCE",
        "Required security/payment/refund notifications cannot be disabled by preference.",
        409,
      );
    }
    const row = await this.database.notificationPreference.upsert({
      where: { userId_channel_scopeKey: { userId: principal.userId, channel: body.channel, scopeKey } },
      create: { userId: principal.userId, channel: body.channel, scopeKey, enabled: body.enabled },
      update: { enabled: body.enabled },
    });
    return { channel: row.channel, scopeKey: row.scopeKey, enabled: row.enabled };
  }

  async listOperational(
    principal: AccessPrincipal,
    query: OperationalNotificationQueryDto,
  ): Promise<OperationalNotificationListResponseDto> {
    this.requireAdmin(principal);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
    };
    const [items, totalItems] = await Promise.all([
      this.database.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      this.database.notification.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        userId: item.userId,
        channel: item.channel,
        templateKey: item.templateKey,
        recipient: item.recipient,
        status: item.status,
        provider: item.provider,
        providerRef: item.providerRef,
        attempts: item.attempts,
        nextAttemptAt: item.nextAttemptAt?.toISOString() ?? null,
        lastError: item.lastError,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
      pagination: pagination(page, pageSize, totalItems),
    };
  }

  async retryOperational(principal: AccessPrincipal, notificationId: string): Promise<void> {
    this.requireAdmin(principal);
    const notification = await this.database.notification.findUnique({ where: { id: notificationId } });
    if (!notification) throw new NotificationError("NOTIFICATION_NOT_FOUND", "Notification was not found.", 404);
    if (notification.channel === "IN_APP") {
      throw new NotificationError("NOTIFICATION_NOT_RETRYABLE", "In-app notifications do not require provider retry.", 409);
    }
    if (!["FAILED", "QUEUED"].includes(notification.status)) {
      throw new NotificationError("NOTIFICATION_NOT_RETRYABLE", "Notification is not in a retryable state.", 409);
    }
    await this.database.$transaction(async (tx) => {
      const changed = await tx.notification.updateMany({
        where: {
          id: notificationId,
          updatedAt: notification.updatedAt,
          channel: { not: "IN_APP" },
          status: { in: ["FAILED", "QUEUED"] },
        },
        data: { status: "QUEUED", nextAttemptAt: new Date(), failedAt: null, lastError: null },
      });
      if (changed.count !== 1) {
        throw new NotificationError(
          "NOTIFICATION_RETRY_STATE_CONFLICT",
          "Notification state changed before the retry could be queued. Refresh and try again.",
          409,
        );
      }
      await writeAuditEntry(tx, {
        actorType: "USER",
        actorUserId: principal.userId,
        action: "admin.notification.retry_queued",
        entityType: "Notification",
        entityId: notificationId,
      });
    });
  }
}
