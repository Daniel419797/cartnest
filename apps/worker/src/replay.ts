import { getWorkerEnvironment } from "@repo/config/worker";
import { createDatabaseClient, writeAuditEntry } from "@repo/database";

const FINANCIAL_CONFIRMATION = "REVIEWED_FINANCIAL_REPLAY";

function usage(): never {
  throw new Error(
    "Usage: pnpm --filter @cartnest/worker outbox:replay -- <outbox-event-id>. " +
      `Financial events additionally require WORKER_FINANCIAL_REPLAY_CONFIRM=${FINANCIAL_CONFIRMATION}.`,
  );
}

function isFinancialEvent(eventType: string): boolean {
  return eventType.startsWith("payment.") || eventType.startsWith("refund.");
}

const eventId = process.argv[2]?.trim();
if (!eventId) usage();

const environment = getWorkerEnvironment();
const database = createDatabaseClient({ connectionString: environment.databaseUrl });

try {
  const event = await database.outboxEvent.findUnique({ where: { id: eventId } });
  if (!event) throw new Error("OUTBOX_EVENT_NOT_FOUND");
  if (event.status !== "FAILED") {
    throw new Error(`OUTBOX_EVENT_NOT_REPLAYABLE:${event.status}`);
  }

  const financial = isFinancialEvent(event.eventType);
  if (
    financial &&
    process.env.WORKER_FINANCIAL_REPLAY_CONFIRM !== FINANCIAL_CONFIRMATION
  ) {
    throw new Error(
      `FINANCIAL_REPLAY_REQUIRES_EXPLICIT_REVIEW:${event.eventType}`,
    );
  }

  const changed = await database.$transaction(async (tx) => {
    const reset = await tx.outboxEvent.updateMany({
      where: {
        id: event.id,
        status: "FAILED",
        attempts: event.attempts,
        lockedAt: event.lockedAt,
      },
      data: {
        status: "PENDING",
        attempts: 0,
        availableAt: new Date(),
        lockedAt: null,
        publishedAt: null,
        lastError: null,
      },
    });
    if (reset.count !== 1) {
      throw new Error("OUTBOX_REPLAY_STATE_CONFLICT");
    }

    await writeAuditEntry(tx, {
      actorType: "SYSTEM",
      action: "outbox.replay.requested",
      entityType: "OutboxEvent",
      entityId: event.id,
      metadata: {
        eventType: event.eventType,
        eventVersion: event.eventVersion,
        previousAttempts: event.attempts,
        financial,
      },
    });
    return reset.count;
  });

  console.info(JSON.stringify({
    status: "queued-for-replay",
    eventId: event.id,
    eventType: event.eventType,
    previousAttempts: event.attempts,
    financial,
    changed,
  }));
} finally {
  await database.$disconnect();
}
