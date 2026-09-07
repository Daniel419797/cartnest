import { Queue, type JobsOptions, type QueueOptions } from "bullmq";
import type { BackgroundJobData, DurableEventEnvelope } from "./types.js";

export const QUEUE_NAMES = {
  payments: "payments",
  inventory: "inventory",
  logistics: "logistics",
  notifications: "notifications",
  analytics: "analytics",
  maintenance: "maintenance",
} as const;

export type QueueKey = keyof typeof QUEUE_NAMES;
export type QueueRegistry = Readonly<Record<QueueKey, Queue<BackgroundJobData>>>;

const NOTIFICATION_EVENTS = new Set([
  "order.created",
  "payment.succeeded",
  "shipment.delivered",
  "refund.succeeded",
  "return.status_changed",
]);

export function redisConnectionOptions(redisUrl: string) {
  const url = new URL(redisUrl);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis:// or rediss://.");
  }
  const dbText = url.pathname.replace(/^\//, "");
  const db = dbText ? Number.parseInt(dbText, 10) : 0;
  if (!Number.isInteger(db) || db < 0) throw new Error("REDIS_URL database index is invalid.");
  const username = url.username ? decodeURIComponent(url.username) : undefined;
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  return {
    host: url.hostname,
    port: url.port ? Number.parseInt(url.port, 10) : 6379,
    db,
    maxRetriesPerRequest: null,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
}

/**
 * Only subscribe an outbox event to queues that have a real consumer today.
 * Adding a prefix here without a processor would incorrectly mark durable work
 * published while BullMQ only dead-letters it later.
 */
export function queueSubscriptions(eventType: string): readonly QueueKey[] {
  return NOTIFICATION_EVENTS.has(eventType) ? ["notifications"] : [];
}

export function defaultEventJobOptions(event: DurableEventEnvelope): JobsOptions {
  return {
    jobId: event.eventId,
    attempts: 5,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: { age: 86_400, count: 10_000 },
    removeOnFail: { age: 604_800, count: 25_000 },
  };
}

export function createQueueRegistry(redisUrl: string, prefix: string): QueueRegistry {
  const options: QueueOptions = {
    connection: redisConnectionOptions(redisUrl),
    prefix,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: { age: 86_400, count: 10_000 },
      removeOnFail: { age: 604_800, count: 25_000 },
    },
  };
  return {
    payments: new Queue(QUEUE_NAMES.payments, options),
    inventory: new Queue(QUEUE_NAMES.inventory, options),
    logistics: new Queue(QUEUE_NAMES.logistics, options),
    notifications: new Queue(QUEUE_NAMES.notifications, options),
    analytics: new Queue(QUEUE_NAMES.analytics, options),
    maintenance: new Queue(QUEUE_NAMES.maintenance, options),
  };
}

export async function closeQueueRegistry(queues: QueueRegistry): Promise<void> {
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
}
