import { describe, expect, it } from "vitest";
import { getWorkerEnvironment } from "./worker.js";

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://cartnest:cartnest@localhost:5432/cartnest",
  REDIS_URL: "redis://localhost:6379/0",
};

describe("worker environment", () => {
  it("requires both durable dependencies", () => {
    expect(() => getWorkerEnvironment({ NODE_ENV: "test", REDIS_URL: base.REDIS_URL })).toThrow(
      "DATABASE_URL is required",
    );
    expect(() => getWorkerEnvironment({ NODE_ENV: "test", DATABASE_URL: base.DATABASE_URL })).toThrow(
      "REDIS_URL is required",
    );
  });

  it("uses bounded worker defaults", () => {
    const environment = getWorkerEnvironment(base);
    expect(environment.outboxPollMs).toBe(1000);
    expect(environment.outboxBatchSize).toBe(50);
    expect(environment.outboxMaxAttempts).toBe(5);
    expect(environment.maintenanceIntervalMs).toBe(60000);
  });

  it("rejects unsafe numeric ranges", () => {
    expect(() => getWorkerEnvironment({ ...base, WORKER_OUTBOX_BATCH_SIZE: "0" })).toThrow();
    expect(() => getWorkerEnvironment({ ...base, WORKER_OUTBOX_MAX_ATTEMPTS: "100" })).toThrow();
  });
});
