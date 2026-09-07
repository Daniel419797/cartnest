import { readRuntimeEnvironment, readString, readUrl } from "./shared.js";

export interface WorkerEnvironment {
  readonly nodeEnv: "development" | "test" | "production";
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly queuePrefix: string;
  readonly outboxPollMs: number;
  readonly outboxBatchSize: number;
  readonly outboxMaxAttempts: number;
  readonly outboxLockTimeoutMs: number;
  readonly maintenanceIntervalMs: number;
}

function requiredUrl(source: NodeJS.ProcessEnv, key: string): string {
  const value = readUrl(source, key);
  if (!value) throw new Error(`${key} is required for the CartNest worker.`);
  return value;
}

function positiveInteger(
  source: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = readString(source, key);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function getWorkerEnvironment(source: NodeJS.ProcessEnv = process.env): WorkerEnvironment {
  return Object.freeze({
    nodeEnv: readRuntimeEnvironment(source),
    databaseUrl: requiredUrl(source, "DATABASE_URL"),
    redisUrl: requiredUrl(source, "REDIS_URL"),
    queuePrefix: readString(source, "WORKER_QUEUE_PREFIX", "cartnest") ?? "cartnest",
    outboxPollMs: positiveInteger(source, "WORKER_OUTBOX_POLL_MS", 1_000, 100, 60_000),
    outboxBatchSize: positiveInteger(source, "WORKER_OUTBOX_BATCH_SIZE", 50, 1, 500),
    outboxMaxAttempts: positiveInteger(source, "WORKER_OUTBOX_MAX_ATTEMPTS", 5, 1, 20),
    outboxLockTimeoutMs: positiveInteger(source, "WORKER_OUTBOX_LOCK_TIMEOUT_MS", 60_000, 5_000, 900_000),
    maintenanceIntervalMs: positiveInteger(source, "WORKER_MAINTENANCE_INTERVAL_MS", 60_000, 10_000, 3_600_000),
  });
}
