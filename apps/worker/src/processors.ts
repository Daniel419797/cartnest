import type { DatabaseClient } from "@repo/database";
import { UnrecoverableError, Worker, type WorkerOptions } from "bullmq";
import { expireInventoryReservations } from "./maintenance.js";
import { materializeNotificationEvent } from "./notifications.js";
import { QUEUE_NAMES, redisConnectionOptions } from "./queues.js";
import { SUPPORTED_EVENT_VERSION, isDurableEventEnvelope, type BackgroundJobData } from "./types.js";

export interface WorkerConsumers {
  readonly notifications: Worker<BackgroundJobData>;
  readonly maintenance: Worker<BackgroundJobData>;
}

function workerOptions(redisUrl: string, prefix: string, concurrency: number): WorkerOptions {
  return {
    connection: redisConnectionOptions(redisUrl),
    prefix,
    concurrency,
    lockDuration: 30_000,
    stalledInterval: 30_000,
    maxStalledCount: 1,
  };
}

export function createWorkerConsumers(
  database: DatabaseClient,
  redisUrl: string,
  prefix: string,
): WorkerConsumers {
  const notifications = new Worker<BackgroundJobData>(
    QUEUE_NAMES.notifications,
    async (job) => {
      if (!isDurableEventEnvelope(job.data)) {
        throw new UnrecoverableError(`INVALID_EVENT_ENVELOPE:${job.name}`);
      }
      if (job.data.eventVersion !== SUPPORTED_EVENT_VERSION) {
        throw new UnrecoverableError(
          `UNSUPPORTED_EVENT_VERSION:${job.data.eventType}:v${job.data.eventVersion}`,
        );
      }
      return {
        materialized: await materializeNotificationEvent(database, job.data),
        eventId: job.data.eventId,
      };
    },
    workerOptions(redisUrl, prefix, 20),
  );

  const maintenance = new Worker<BackgroundJobData>(
    QUEUE_NAMES.maintenance,
    async (job) => {
      if (job.name === "inventory.reservations.expire") {
        return expireInventoryReservations(database);
      }
      throw new UnrecoverableError(`UNSUPPORTED_MAINTENANCE_JOB:${job.name}`);
    },
    workerOptions(redisUrl, prefix, 2),
  );

  return { notifications, maintenance };
}

export async function closeWorkerConsumers(consumers: WorkerConsumers): Promise<void> {
  await Promise.all([
    consumers.notifications.close(false),
    consumers.maintenance.close(false),
  ]);
}
