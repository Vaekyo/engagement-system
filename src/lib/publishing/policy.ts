import type { AdapterFailure } from "../platforms/types";

export const MAX_PUBLISH_ATTEMPTS = 4;
export const STALE_LOCK_MS = 10 * 60 * 1000;

// Exponential backoff for transient publish errors: 30s, 60s, 120s, ... capped at 1h.
export function backoffMs(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 60 * 60 * 1000);
}

export type FailureOutcome =
  | { kind: "retry"; delayMs: number }
  | { kind: "manual"; reason: string }
  | { kind: "halt_account"; accountStatus: "expired" | "permission_required" | "error"; reason: string }
  | { kind: "failed"; reason: string };

// Decides what a failed publish attempt means. A request is only retried when
// the platform definitively rejected it without acting (retryable=true), so a
// retry can never post the same comment twice.
export function classifyPublishFailure(failure: AdapterFailure, attempts: number): FailureOutcome {
  switch (failure.status) {
    case "unsupported":
    case "permission_required":
      return { kind: "manual", reason: failure.status };
    case "token_expired":
      return { kind: "halt_account", accountStatus: "expired", reason: "token_expired" };
    case "policy_error":
      return { kind: "halt_account", accountStatus: "error", reason: "policy_error" };
    case "not_found":
      return { kind: "failed", reason: "not_found" };
    default:
      if (failure.retryable && attempts < MAX_PUBLISH_ATTEMPTS) return { kind: "retry", delayMs: backoffMs(attempts) };
      return { kind: "failed", reason: failure.status };
  }
}
