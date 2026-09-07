export const SUPPORTED_EVENT_VERSION = 1 as const;

export interface DurableEventEnvelope {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly occurredAt: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: unknown;
}

export interface ScheduledJobData {
  readonly scheduledAt: string;
}

export type BackgroundJobData = DurableEventEnvelope | ScheduledJobData;

export function isDurableEventEnvelope(value: unknown): value is DurableEventEnvelope {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DurableEventEnvelope>;
  return (
    typeof candidate.eventId === "string" &&
    typeof candidate.eventType === "string" &&
    typeof candidate.eventVersion === "number" &&
    typeof candidate.occurredAt === "string" &&
    typeof candidate.aggregateType === "string" &&
    typeof candidate.aggregateId === "string"
  );
}
