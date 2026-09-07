import { describe, expect, it } from "vitest";
import { queueSubscriptions, redisConnectionOptions } from "./queues.js";

describe("worker queue routing", () => {
  it("routes only events backed by implemented consumers", () => {
    expect(queueSubscriptions("order.created")).toEqual(["notifications"]);
    expect(queueSubscriptions("payment.succeeded")).toEqual(["notifications"]);
    expect(queueSubscriptions("inventory.reservation_expired")).toEqual([]);
    expect(queueSubscriptions("unknown.event")).toEqual([]);
  });

  it("parses Redis URLs without leaking absent optional fields", () => {
    expect(redisConnectionOptions("redis://localhost:6379/2")).toEqual({
      host: "localhost",
      port: 6379,
      db: 2,
      maxRetriesPerRequest: null,
    });
  });

  it("supports authenticated TLS Redis URLs", () => {
    const options = redisConnectionOptions("rediss://user:pass@example.com:6380/1");
    expect(options.host).toBe("example.com");
    expect(options.port).toBe(6380);
    expect(options.username).toBe("user");
    expect(options.password).toBe("pass");
    expect(options.db).toBe(1);
    expect(options.tls).toEqual({});
  });

  it("rejects unsupported Redis schemes", () => {
    expect(() => redisConnectionOptions("https://example.com")).toThrow();
  });
});
