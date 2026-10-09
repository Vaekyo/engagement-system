import { describe, expect, it } from "vitest";
import { computeMetrics, DAY, mean, organicPer1000, snapshotAt } from "./metrics";

describe("organicPer1000", () => {
  it("implements audience comments ÷ views × 1000", () => {
    expect(organicPer1000(12, 4000)).toBe(3);
    expect(organicPer1000(5, 0)).toBeNull();
    expect(organicPer1000(5, null)).toBeNull();
  });
});

describe("computeMetrics", () => {
  const comments = [
    { id: "a", parentId: null, authorType: "audience" as const, authorIdHash: "h1" },
    { id: "b", parentId: null, authorType: "audience" as const, authorIdHash: "h2" },
    { id: "c", parentId: "a", authorType: "creator" as const, authorIdHash: null },
    { id: "d", parentId: "a", authorType: "audience" as const, authorIdHash: "h2" },
    { id: "e", parentId: null, authorType: "creator" as const, authorIdHash: null },
    { id: "f", parentId: "b", authorType: "team" as const, authorIdHash: null },
  ];

  it("never counts creator or team comments as organic", () => {
    const m = computeMetrics(comments, 1000);
    expect(m.audienceComments).toBe(3);
    expect(m.creatorComments).toBe(2);
    expect(m.teamComments).toBe(1);
    expect(m.organicPer1000Views).toBe(3);
  });

  it("computes reply rate on audience top-level comments answered by creator or team", () => {
    const m = computeMetrics(comments, 1000);
    expect(m.audienceTopLevel).toBe(2);
    expect(m.audienceTopLevelAnswered).toBe(2);
    expect(m.replyRate).toBe(1);
  });

  it("counts unique participants from hashed IDs and audience replies", () => {
    const m = computeMetrics(comments, 1000);
    expect(m.uniqueAudienceParticipants).toBe(2);
    expect(m.audienceRepliesToOthers).toBe(1);
  });

  it("returns null when identifiers are unavailable", () => {
    expect(computeMetrics([{ id: "x", parentId: null, authorType: "audience", authorIdHash: null }], null).uniqueAudienceParticipants).toBeNull();
  });
});

describe("snapshotAt", () => {
  it("picks the first snapshot at or after the checkpoint", () => {
    const published = new Date("2026-10-01T00:00:00Z");
    const snaps = [
      { capturedAt: new Date("2026-10-01T01:00:00Z"), views: 10, likes: null, commentsCount: null },
      { capturedAt: new Date("2026-10-02T03:00:00Z"), views: 200, likes: null, commentsCount: null },
      { capturedAt: new Date("2026-10-08T02:00:00Z"), views: 900, likes: null, commentsCount: null },
    ];
    expect(snapshotAt(snaps, published, DAY)?.views).toBe(200);
    expect(snapshotAt(snaps, published, 7 * DAY)?.views).toBe(900);
    expect(snapshotAt(snaps, published, 30 * DAY)).toBeNull();
    expect(snapshotAt(snaps, null, DAY)).toBeNull();
  });
});

describe("mean", () => {
  it("ignores nulls", () => {
    expect(mean([1, null, 3])).toBe(2);
    expect(mean([null])).toBeNull();
  });
});
