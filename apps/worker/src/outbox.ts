import { Prisma, type DatabaseClient } from "@repo/database";
import { defaultEventJobOptions, queueSubscriptions, type QueueRegistry } from "./queues.js";
import { SUPPORTED_EVENT_VERSION, type DurableEventEnvelope } from "./types.js";

interface ClaimedOutboxEvent {
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly payload: unknown;
  readonly attempts: number;
  readonly lockedAt: Date;
  readonly createdAt: Date;
}

export interface OutboxDispatcherOptions {
  readonly batchSize: number;
  readonly maxAttempts: number;
  readonly lockTimeoutMs: number;
}

export interface OutboxDispatchResult {
  readonly claimed: number;
  readonly published: number;
  readonly failed: number;
}

const DEAD_LETTER_AT = new Date("9999-12-31T23:59:59.999Z");

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown outbox dispatch failure.";
  return message.replaceAll(/(password|token|secret|authorization)=?[^\s,;]*/gi, "$1=[redacted]").slice(0, 1000);
}

function retryDelayMs(attempt: number): number {
  const schedule = [10_000, 60_000, 300_000, 1_800_000] as const;
  return schedule[Math.min(Math.max(attempt - 1, 0), schedule.length - 1)] ?? 1_800_000;
}

function normalizedEnvelope(event: ClaimedOutboxEvent): DurableEventEnvelope {
  let eventType = event.eventType;
  if (
    event.eventType === "shipment.status_changed" &&
    event.payload &&
    typeof event.payload === "object" &&
    !Array.isArray(event.payload) &&
    (event.payload as { status?: unknown }).status === "DELIVERED"
  ) {
    eventType = "shipment.delivered";
  }
  return {
    eventId: event.id,
    eventType,
    eventVersion: event.eventVersion,
    occurredAt: event.createdAt.toISOString(),
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    payload: event.payload,
  };
}

export class OutboxDispatcher {
  private running = false;

  constructor(
    private readonly database: DatabaseClient,
    private readonly queues: QueueRegistry,
    private readonly options: OutboxDispatcherOptions,
  ) {}

  private async claimBatch(): Promise<ClaimedOutboxEvent[]> {
    const staleBefore = new Date(Date.now() - this.options.lockTimeoutMs);
    return this.database.$transaction(async (tx) => {
      await tx.outboxEvent.updateMany({
        where: {
          status: "PROCESSING",
          attempts: { gte: this.options.maxAttempts },
          lockedAt: { lt: staleBefore },
        },
        data: {
          status: "FAILED",
          lockedAt: null,
          availableAt: DEAD_LETTER_AT,
          lastError: "OUTBOX_LEASE_EXPIRED_AFTER_FINAL_ATTEMPT",
        },
      });

      return tx.$queryRaw<ClaimedOutboxEvent[]>(Prisma.sql`
        WITH candidates AS (
          SELECT "id"
          FROM "OutboxEvent"
          WHERE (
              "status" IN ('PENDING'::"OutboxStatus", 'FAILED'::"OutboxStatus")
              AND "attempts" < ${this.options.maxAttempts}
              AND "availableAt" <= NOW()
            )
            OR (
              "status" = 'PROCESSING'::"OutboxStatus"
              AND "attempts" < ${this.options.maxAttempts}
              AND "lockedAt" IS NOT NULL
              AND "lockedAt" < ${staleBefore}
            )
          ORDER BY "availableAt" ASC, "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${this.options.batchSize}
        )
        UPDATE "OutboxEvent" AS event
        SET
          "attempts" = event."attempts" + 1,
          "status" = 'PROCESSING'::"OutboxStatus",
          "lockedAt" = NOW(),
          "lastError" = NULL
        FROM candidates
        WHERE event."id" = candidates."id"
        RETURNING
          event."id",
          event."aggregateType",
          event."aggregateId",
          event."eventType",
          event."eventVersion",
          event."payload",
          event."attempts",
          event."lockedAt",
          event."createdAt"
      `);
    });
  }

  private leaseWhere(event: ClaimedOutboxEvent) {
    return {
      id: event.id,
      status: "PROCESSING" as const,
      attempts: event.attempts,
      lockedAt: event.lockedAt,
    };
  }

  private async markPublished(event: ClaimedOutboxEvent): Promise<void> {
    const changed = await this.database.outboxEvent.updateMany({
      where: this.leaseWhere(event),
      data: { status: "PUBLISHED", lockedAt: null, publishedAt: new Date(), lastError: null },
    });
    if (changed.count !== 1) throw new Error(`OUTBOX_PUBLISH_STATE_CONFLICT:${event.id}`);
  }

  private async markRetryableFailure(event: ClaimedOutboxEvent, error: unknown): Promise<void> {
    const exhausted = event.attempts >= this.options.maxAttempts;
    const changed = await this.database.outboxEvent.updateMany({
      where: this.leaseWhere(event),
      data: {
        status: "FAILED",
        lockedAt: null,
        lastError: safeError(error),
        availableAt: exhausted
          ? DEAD_LETTER_AT
          : new Date(Date.now() + retryDelayMs(event.attempts)),
      },
    });
    if (changed.count !== 1) throw new Error(`OUTBOX_FAILURE_STATE_CONFLICT:${event.id}`);
  }

  private async markPermanentFailure(event: ClaimedOutboxEvent, reason: string): Promise<void> {
    const changed = await this.database.outboxEvent.updateMany({
      where: this.leaseWhere(event),
      data: {
        status: "FAILED",
        attempts: this.options.maxAttempts,
        lockedAt: null,
        lastError: reason.slice(0, 1000),
        availableAt: DEAD_LETTER_AT,
      },
    });
    if (changed.count !== 1) {
      throw new Error(`OUTBOX_PERMANENT_FAILURE_STATE_CONFLICT:${event.id}`);
    }
  }

  private async publish(event: ClaimedOutboxEvent): Promise<"published" | "failed"> {
    if (event.eventVersion !== SUPPORTED_EVENT_VERSION) {
      await this.markPermanentFailure(
        event,
        `UNSUPPORTED_EVENT_VERSION:${event.eventType}:v${event.eventVersion}`,
      );
      return "failed";
    }

    const envelope = normalizedEnvelope(event);
    const subscriptions = queueSubscriptions(envelope.eventType);
    try {
      for (const queueKey of subscriptions) {
        await this.queues[queueKey].add(
          envelope.eventType,
          envelope,
          defaultEventJobOptions(envelope),
        );
      }
      await this.markPublished(event);
      return "published";
    } catch (error) {
      await this.markRetryableFailure(event, error);
      return "failed";
    }
  }

  async dispatchOnce(): Promise<OutboxDispatchResult> {
    if (this.running) return { claimed: 0, published: 0, failed: 0 };
    this.running = true;
    try {
      const events = await this.claimBatch();
      let published = 0;
      let failed = 0;
      for (const event of events) {
        if ((await this.publish(event)) === "published") published += 1;
        else failed += 1;
      }
      return { claimed: events.length, published, failed };
    } finally {
      this.running = false;
    }
  }
}
