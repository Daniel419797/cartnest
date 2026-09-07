import type { DatabaseClient } from "@repo/database";
import type { DurableEventEnvelope } from "./types.js";

type Channel = "EMAIL" | "SMS" | "IN_APP";

interface Recipient {
  readonly userId: string;
  readonly email: string | null;
  readonly phone: string | null;
}

interface Target {
  readonly recipient: Recipient;
  readonly channel: Channel;
  readonly templateKey: string;
  readonly required: boolean;
  readonly dedupeBase: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

async function preferenceEnabled(
  database: DatabaseClient,
  userId: string,
  channel: Channel,
  templateKey: string,
  required: boolean,
): Promise<boolean> {
  if (required) return true;
  const rows = await database.notificationPreference.findMany({
    where: { userId, channel, scopeKey: { in: [templateKey, "*"] } },
  });
  const exact = rows.find((item) => item.scopeKey === templateKey);
  if (exact) return exact.enabled;
  const wildcard = rows.find((item) => item.scopeKey === "*");
  if (wildcard) return wildcard.enabled;
  return channel !== "SMS";
}

async function persistTarget(database: DatabaseClient, target: Target): Promise<boolean> {
  if (!(await preferenceEnabled(
    database,
    target.recipient.userId,
    target.channel,
    target.templateKey,
    target.required,
  ))) return false;

  const recipient =
    target.channel === "IN_APP"
      ? target.recipient.userId
      : target.channel === "EMAIL"
        ? target.recipient.email
        : target.recipient.phone;
  if (!recipient) return false;

  const now = new Date();
  const dedupeKey = `${target.dedupeBase}:${target.channel.toLowerCase()}`;
  await database.notification.upsert({
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
  return true;
}

async function vendorRecipients(database: DatabaseClient, vendorId: string): Promise<Recipient[]> {
  const members = await database.vendorMember.findMany({
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
  const unique = new Map<string, Recipient>();
  for (const member of members) {
    unique.set(member.user.id, {
      userId: member.user.id,
      email: member.user.email,
      phone: member.user.phone,
    });
  }
  return [...unique.values()];
}

function customerTargets(
  recipient: Recipient,
  templateKey: string,
  dedupeBase: string,
  payload: Readonly<Record<string, unknown>>,
  options: { readonly emailRequired: boolean; readonly inAppRequired: boolean; readonly optionalSms?: boolean },
): Target[] {
  return [
    { recipient, channel: "EMAIL", templateKey, required: options.emailRequired, dedupeBase, payload },
    { recipient, channel: "IN_APP", templateKey, required: options.inAppRequired, dedupeBase, payload },
    ...(options.optionalSms
      ? [{ recipient, channel: "SMS" as const, templateKey, required: false, dedupeBase, payload }]
      : []),
  ];
}

export async function materializeNotificationEvent(
  database: DatabaseClient,
  event: DurableEventEnvelope,
): Promise<number> {
  const targets: Target[] = [];

  if (event.eventType === "order.created") {
    const order = await database.order.findUnique({
      where: { id: event.aggregateId },
      include: {
        user: { select: { id: true, email: true, phone: true } },
        vendorOrders: { select: { id: true, vendorId: true, store: { select: { name: true } } } },
      },
    });
    if (!order) return 0;
    const customer = { userId: order.user.id, email: order.user.email, phone: order.user.phone };
    targets.push(...customerTargets(
      customer,
      "order.created.customer.v1",
      `order-created:customer:${order.id}`,
      {
        orderId: order.id,
        orderNumber: order.orderNumber,
        amountMinor: order.grandTotalAmountMinor.toString(),
        currency: order.currency,
        storeCount: order.vendorOrders.length,
      },
      { emailRequired: true, inAppRequired: true },
    ));
    for (const vendorOrder of order.vendorOrders) {
      for (const recipient of await vendorRecipients(database, vendorOrder.vendorId)) {
        const payload = {
          orderId: order.id,
          vendorOrderId: vendorOrder.id,
          orderNumber: order.orderNumber,
          storeName: vendorOrder.store.name,
        };
        const dedupeBase = `vendor-order-created:${vendorOrder.id}:${recipient.userId}`;
        targets.push(
          { recipient, channel: "EMAIL", templateKey: "order.created.vendor.v1", required: true, dedupeBase, payload },
          { recipient, channel: "IN_APP", templateKey: "order.created.vendor.v1", required: true, dedupeBase, payload },
        );
      }
    }
  } else if (event.eventType === "payment.succeeded") {
    const intent = await database.paymentIntent.findUnique({
      where: { id: event.aggregateId },
      include: {
        order: {
          include: {
            user: { select: { id: true, email: true, phone: true } },
            vendorOrders: { select: { id: true, vendorId: true } },
          },
        },
      },
    });
    if (!intent) return 0;
    const customer = {
      userId: intent.order.user.id,
      email: intent.order.user.email,
      phone: intent.order.user.phone,
    };
    targets.push(...customerTargets(
      customer,
      "payment.succeeded.customer.v1",
      `payment-success:customer:${intent.id}`,
      {
        paymentIntentId: intent.id,
        orderId: intent.orderId,
        amountMinor: intent.amountMinor.toString(),
        currency: intent.currency,
      },
      { emailRequired: true, inAppRequired: true },
    ));
    for (const vendorOrder of intent.order.vendorOrders) {
      for (const recipient of await vendorRecipients(database, vendorOrder.vendorId)) {
        targets.push({
          recipient,
          channel: "IN_APP",
          templateKey: "payment.succeeded.vendor.v1",
          required: true,
          dedupeBase: `payment-success:vendor:${intent.id}:${recipient.userId}`,
          payload: {
            paymentIntentId: intent.id,
            orderId: intent.orderId,
            vendorOrderId: vendorOrder.id,
          },
        });
      }
    }
  } else if (event.eventType === "shipment.delivered") {
    const shipment = await database.shipment.findUnique({
      where: { id: event.aggregateId },
      include: {
        vendorOrder: {
          include: { order: { include: { user: { select: { id: true, email: true, phone: true } } } } },
        },
      },
    });
    if (!shipment) return 0;
    const user = shipment.vendorOrder.order.user;
    const customer = { userId: user.id, email: user.email, phone: user.phone };
    targets.push(...customerTargets(
      customer,
      "shipment.delivered.customer.v1",
      `shipment-delivered:${shipment.id}:customer`,
      {
        shipmentId: shipment.id,
        vendorOrderId: shipment.vendorOrderId,
        orderId: shipment.vendorOrder.orderId,
        trackingNumber: shipment.trackingNumber,
      },
      { emailRequired: true, inAppRequired: true, optionalSms: true },
    ));
    for (const recipient of await vendorRecipients(database, shipment.vendorOrder.vendorId)) {
      targets.push({
        recipient,
        channel: "IN_APP",
        templateKey: "shipment.delivered.vendor.v1",
        required: true,
        dedupeBase: `shipment-delivered:${shipment.id}:vendor:${recipient.userId}`,
        payload: { shipmentId: shipment.id, vendorOrderId: shipment.vendorOrderId },
      });
    }
  } else if (event.eventType === "refund.succeeded") {
    const refund = await database.refund.findUnique({
      where: { id: event.aggregateId },
      include: {
        paymentIntent: {
          include: { order: { include: { user: { select: { id: true, email: true, phone: true } } } } },
        },
        vendorOrder: true,
      },
    });
    if (!refund) return 0;
    const user = refund.paymentIntent.order.user;
    const customer = { userId: user.id, email: user.email, phone: user.phone };
    targets.push(...customerTargets(
      customer,
      "refund.succeeded.customer.v1",
      `refund-success:${refund.id}:customer`,
      {
        refundId: refund.id,
        orderId: refund.paymentIntent.orderId,
        amountMinor: refund.amountMinor.toString(),
        currency: refund.currency,
      },
      { emailRequired: true, inAppRequired: true },
    ));
    if (refund.vendorOrder) {
      for (const recipient of await vendorRecipients(database, refund.vendorOrder.vendorId)) {
        targets.push({
          recipient,
          channel: "IN_APP",
          templateKey: "refund.succeeded.vendor.v1",
          required: true,
          dedupeBase: `refund-success:${refund.id}:vendor:${recipient.userId}`,
          payload: {
            refundId: refund.id,
            vendorOrderId: refund.vendorOrder.id,
            amountMinor: refund.amountMinor.toString(),
            currency: refund.currency,
          },
        });
      }
    }
  } else if (event.eventType === "return.status_changed") {
    const request = await database.returnRequest.findUnique({
      where: { id: event.aggregateId },
      include: { user: { select: { id: true, email: true, phone: true } }, vendorOrder: true },
    });
    if (!request) return 0;
    const customer = {
      userId: request.user.id,
      email: request.user.email,
      phone: request.user.phone,
    };
    targets.push(...customerTargets(
      customer,
      "return.status.customer.v1",
      `return-status:${request.id}:${request.status}:customer`,
      {
        returnRequestId: request.id,
        vendorOrderId: request.vendorOrderId,
        status: request.status,
      },
      { emailRequired: true, inAppRequired: true },
    ));
    for (const recipient of await vendorRecipients(database, request.vendorOrder.vendorId)) {
      targets.push({
        recipient,
        channel: "IN_APP",
        templateKey: "return.status.vendor.v1",
        required: true,
        dedupeBase: `return-status:${request.id}:${request.status}:vendor:${recipient.userId}`,
        payload: {
          returnRequestId: request.id,
          vendorOrderId: request.vendorOrderId,
          status: request.status,
        },
      });
    }
  } else {
    throw new Error(`UNSUPPORTED_NOTIFICATION_EVENT:${event.eventType}`);
  }

  let persisted = 0;
  for (const target of targets) {
    if (await persistTarget(database, target)) persisted += 1;
  }
  return persisted;
}
