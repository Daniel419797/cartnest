import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  AdminPrivacyRequestListResponseSchema,
  PrivacyRequestListQuerySchema,
  ProcessPrivacyRequestBodySchema,
} from "./index.js";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

describe("P11 privacy contracts", () => {
  it("accepts bounded privacy request pagination", () => {
    expect(Value.Check(PrivacyRequestListQuerySchema, { page: 1, pageSize: 50, status: "PENDING" })).toBe(true);
    expect(Value.Check(PrivacyRequestListQuerySchema, { page: 0, pageSize: 500 })).toBe(false);
  });

  it("requires an explicit reviewed erasure decision and reason", () => {
    expect(Value.Check(ProcessPrivacyRequestBodySchema, {
      decision: "ANONYMIZE",
      reason: "Identity was verified and no active obligations remain.",
    })).toBe(true);
    expect(Value.Check(ProcessPrivacyRequestBodySchema, { decision: "ANONYMIZE", reason: "ok" })).toBe(false);
    expect(Value.Check(ProcessPrivacyRequestBodySchema, { decision: "DELETE", reason: "Identity was verified and approved." })).toBe(false);
  });

  it("requires subject identity on privileged erasure queue records", () => {
    const base = {
      id: REQUEST_ID,
      status: "REQUIRES_REVIEW" as const,
      reviewNote: "Open order obligations remain.",
      requestedAt: "2026-09-06T10:00:00.000Z",
      processedAt: null,
    };
    expect(Value.Check(AdminPrivacyRequestListResponseSchema, {
      items: [{ ...base, subjectUserId: USER_ID }],
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    })).toBe(true);
    expect(Value.Check(AdminPrivacyRequestListResponseSchema, {
      items: [base],
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    })).toBe(false);
  });
});
