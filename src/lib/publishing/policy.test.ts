import { describe, expect, it } from "vitest";
import { backoffMs, classifyPublishFailure, MAX_PUBLISH_ATTEMPTS } from "./policy";

describe("backoff", () => {
  it("grows exponentially and is capped at one hour", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(20)).toBe(3_600_000);
  });
});

describe("classifyPublishFailure", () => {
  it("retries only definitively-rejected transient errors", () => {
    expect(classifyPublishFailure({ ok: false, status: "rate_limited", message: "", retryable: true }, 1)).toEqual({ kind: "retry", delayMs: 30_000 });
    // A 5xx on a write may have been applied: not retryable → failed, never auto-retried.
    expect(classifyPublishFailure({ ok: false, status: "error", message: "", retryable: false }, 1).kind).toBe("failed");
  });

  it("stops retrying after the attempt limit", () => {
    expect(classifyPublishFailure({ ok: false, status: "rate_limited", message: "", retryable: true }, MAX_PUBLISH_ATTEMPTS).kind).toBe("failed");
  });

  it("falls back to manual when the capability is missing", () => {
    expect(classifyPublishFailure({ ok: false, status: "unsupported", message: "", retryable: false }, 1).kind).toBe("manual");
    expect(classifyPublishFailure({ ok: false, status: "permission_required", message: "", retryable: false }, 1).kind).toBe("manual");
  });

  it("halts the account on revoked tokens and policy errors", () => {
    expect(classifyPublishFailure({ ok: false, status: "token_expired", message: "", retryable: false }, 1)).toMatchObject({ kind: "halt_account", accountStatus: "expired" });
    expect(classifyPublishFailure({ ok: false, status: "policy_error", message: "", retryable: false }, 1)).toMatchObject({ kind: "halt_account" });
  });
});
