import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const apps: Array<ReturnType<typeof buildApp>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("P9 returns/refunds/reviews route contracts", () => {
  it("registers buyer, vendor, public, and MFA-gated admin operations", async () => {
    const app = buildApp({ logger: false });
    apps.push(app);
    await app.ready();

    const paths = app.swagger().paths;
    expect(paths["/api/v1/returns"]).toHaveProperty("get");
    expect(paths["/api/v1/returns"]).toHaveProperty("post");
    expect(paths["/api/v1/stores/{storeId}/returns"]).toHaveProperty("get");
    expect(paths["/api/v1/vendor-orders/{vendorOrderId}/refunds"]).toHaveProperty("get");
    expect(paths["/api/v1/vendor-orders/{vendorOrderId}/refunds"]).toHaveProperty("post");
    expect(paths["/api/v1/admin/refunds"]).toHaveProperty("get");
    expect(paths["/api/v1/admin/refunds/{refundId}/approve"]).toHaveProperty("post");
    expect(paths["/api/v1/admin/reviews"]).toHaveProperty("get");
    expect(paths["/api/v1/admin/reviews/{reviewId}/moderate"]).toHaveProperty("post");
    expect(paths["/api/v1/products/{productId}/reviews"]).toHaveProperty("get");
    expect(paths["/api/v1/stores/{storeId}/reviews"]).toHaveProperty("get");
  });

  it("rejects an empty return allocation before authorization", async () => {
    const app = buildApp({ logger: false });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/returns",
      payload: {
        vendorOrderId: "123e4567-e89b-12d3-a456-426614174000",
        reason: "Changed my mind",
        items: [],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("rejects zero-value refund requests through the shared contract", async () => {
    const app = buildApp({ logger: false });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/vendor-orders/123e4567-e89b-12d3-a456-426614174000/refunds",
      headers: { "idempotency-key": "fp9-test-key" },
      payload: { amountMinor: "0", reason: "Refund requested" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("rejects review ratings outside the 1-to-5 contract", async () => {
    const app = buildApp({ logger: false });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/reviews/products",
      payload: {
        orderItemId: "123e4567-e89b-12d3-a456-426614174000",
        rating: 6,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });
});
