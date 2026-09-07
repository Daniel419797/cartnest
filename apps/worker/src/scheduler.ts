import type { JobsOptions } from "bullmq";
import type { QueueRegistry } from "./queues.js";

export interface WorkerScheduler {
  readonly close: () => void;
}

function maintenanceOptions(jobId: string): JobsOptions {
  return {
    jobId,
    attempts: 5,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: { age: 86_400, count: 5_000 },
    removeOnFail: { age: 604_800, count: 10_000 },
  };
}

export function startWorkerScheduler(
  queues: QueueRegistry,
  intervalMs: number,
  onError: (error: unknown) => void,
): WorkerScheduler {
  let closed = false;
  let scheduling = false;

  const enqueue = async () => {
    if (closed || scheduling) return;
    scheduling = true;
    try {
      const now = new Date();
      const bucket = Math.floor(now.getTime() / intervalMs);
      await queues.maintenance.add(
        "inventory.reservations.expire",
        { scheduledAt: now.toISOString() },
        maintenanceOptions(`inventory-reservation-expiry-${bucket}`),
      );
    } catch (error) {
      onError(error);
    } finally {
      scheduling = false;
    }
  };

  void enqueue();
  const timer = setInterval(() => void enqueue(), intervalMs);
  timer.unref();

  return {
    close() {
      closed = true;
      clearInterval(timer);
    },
  };
}
