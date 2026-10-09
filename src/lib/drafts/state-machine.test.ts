import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, InvalidTransitionError } from "./state-machine";

describe("draft state machine", () => {
  it("follows the happy path draft → pending_approval → approved → queued → published", () => {
    expect(canTransition("draft", "pending_approval")).toBe(true);
    expect(canTransition("pending_approval", "approved")).toBe(true);
    expect(canTransition("approved", "queued")).toBe(true);
    expect(canTransition("queued", "published")).toBe(true);
  });

  it("never reaches publishing without approval", () => {
    for (const from of ["draft", "pending_approval", "rejected"] as const) {
      expect(canTransition(from, "queued")).toBe(false);
      expect(canTransition(from, "published")).toBe(false);
      expect(canTransition(from, "manual_action_required")).toBe(false);
    }
    expect(canTransition("draft", "approved")).toBe(false);
  });

  it("treats published and cancelled as terminal", () => {
    expect(canTransition("published", "draft")).toBe(false);
    expect(canTransition("published", "queued")).toBe(false);
    expect(canTransition("cancelled", "draft")).toBe(false);
  });

  it("allows retrying failed jobs and manual completion", () => {
    expect(canTransition("failed", "queued")).toBe(true);
    expect(canTransition("manual_action_required", "published")).toBe(true);
  });

  it("throws a typed error on invalid transitions", () => {
    expect(() => assertTransition("draft", "published")).toThrow(InvalidTransitionError);
  });
});
