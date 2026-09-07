export interface WorkerHealth {
  readonly status: "ok" | "degraded";
  readonly service: "cartnest-worker";
  readonly uptimeSeconds: number;
  readonly outbox: {
    readonly lastRunAt: string | null;
    readonly claimed: number;
    readonly published: number;
    readonly failed: number;
  };
  readonly failures: number;
  readonly lastErrorAt: string | null;
}

interface MutableWorkerHealth {
  lastRunAt: string | null;
  claimed: number;
  published: number;
  failed: number;
  failures: number;
  lastErrorAt: string | null;
}

const state: MutableWorkerHealth = {
  lastRunAt: null,
  claimed: 0,
  published: 0,
  failed: 0,
  failures: 0,
  lastErrorAt: null,
};

export function recordOutboxRun(result: {
  readonly claimed: number;
  readonly published: number;
  readonly failed: number;
}): void {
  state.lastRunAt = new Date().toISOString();
  state.claimed = result.claimed;
  state.published = result.published;
  state.failed = result.failed;
}

export function recordWorkerFailure(): void {
  state.failures += 1;
  state.lastErrorAt = new Date().toISOString();
}

export function getWorkerHealth(): WorkerHealth {
  return {
    status: state.failed > 0 || state.lastErrorAt ? "degraded" : "ok",
    service: "cartnest-worker",
    uptimeSeconds: Math.floor(process.uptime()),
    outbox: {
      lastRunAt: state.lastRunAt,
      claimed: state.claimed,
      published: state.published,
      failed: state.failed,
    },
    failures: state.failures,
    lastErrorAt: state.lastErrorAt,
  };
}
