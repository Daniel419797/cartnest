import { getWorkerEnvironment } from "@repo/config/worker";
import { createDatabaseClient } from "@repo/database";
import { getWorkerHealth, recordOutboxRun, recordWorkerFailure } from "./health.js";
import { OutboxDispatcher } from "./outbox.js";
import { closeWorkerConsumers, createWorkerConsumers } from "./processors.js";
import { closeQueueRegistry, createQueueRegistry } from "./queues.js";
import { startWorkerScheduler } from "./scheduler.js";

const environment = getWorkerEnvironment();
const database = createDatabaseClient({ connectionString: environment.databaseUrl });
const queues = createQueueRegistry(environment.redisUrl, environment.queuePrefix);
const consumers = createWorkerConsumers(database, environment.redisUrl, environment.queuePrefix);
const dispatcher = new OutboxDispatcher(database, queues, {
  batchSize: environment.outboxBatchSize,
  maxAttempts: environment.outboxMaxAttempts,
  lockTimeoutMs: environment.outboxLockTimeoutMs,
});

function logError(message: string, error: unknown): void {
  recordWorkerFailure();
  console.error(JSON.stringify({
    level: "error",
    message,
    error: error instanceof Error ? error.message.slice(0, 1000) : "Unknown worker error",
  }));
}

for (const [queueName, worker] of Object.entries(consumers)) {
  worker.on("failed", (job, error) => {
    logError("CartNest background job failed", error);
    console.error(JSON.stringify({
      level: "error",
      message: "CartNest job failure context",
      queue: queueName,
      jobId: job?.id ?? null,
      jobName: job?.name ?? null,
      attemptsMade: job?.attemptsMade ?? null,
    }));
  });
  worker.on("error", (error) => logError(`CartNest ${queueName} worker connection/runtime error`, error));
}

const scheduler = startWorkerScheduler(
  queues,
  environment.maintenanceIntervalMs,
  (error) => logError("CartNest scheduler could not enqueue maintenance work", error),
);

async function runOutbox(): Promise<void> {
  try {
    const result = await dispatcher.dispatchOnce();
    recordOutboxRun(result);
    if (result.claimed > 0) {
      console.info(JSON.stringify({ level: "info", message: "CartNest outbox dispatch", ...result }));
    }
  } catch (error) {
    logError("CartNest outbox dispatcher failed", error);
  }
}

void runOutbox();
const outboxTimer = setInterval(() => void runOutbox(), environment.outboxPollMs);
outboxTimer.unref();

console.info(JSON.stringify({
  level: "info",
  message: "CartNest worker started",
  environment: environment.nodeEnv,
  queuePrefix: environment.queuePrefix,
  outboxPollMs: environment.outboxPollMs,
  outboxBatchSize: environment.outboxBatchSize,
}));

const heartbeat = setInterval(() => {
  console.info(JSON.stringify({ level: "debug", ...getWorkerHealth() }));
}, 60_000);
heartbeat.unref();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(outboxTimer);
  clearInterval(heartbeat);
  scheduler.close();
  console.info(JSON.stringify({ level: "info", message: "CartNest worker draining", signal }));
  try {
    await closeWorkerConsumers(consumers);
    await closeQueueRegistry(queues);
    await database.$disconnect();
    console.info(JSON.stringify({ level: "info", message: "CartNest worker stopped", signal }));
  } catch (error) {
    logError("CartNest worker shutdown failed", error);
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
