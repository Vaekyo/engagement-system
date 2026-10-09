import type { AuthorType } from "@prisma/client";

export interface CommentLike {
  id: string;
  parentId: string | null;
  authorType: AuthorType;
  authorIdHash: string | null;
}

export interface EngagementMetrics {
  views: number | null;
  audienceComments: number;
  creatorComments: number;
  teamComments: number;
  uniqueAudienceParticipants: number | null;
  audienceRepliesToOthers: number;
  organicPer1000Views: number | null;
  audienceTopLevel: number;
  audienceTopLevelAnswered: number;
  replyRate: number | null;
}

// Organic comments per 1,000 views = audience comments ÷ views × 1,000.
// Creator and team comments are never counted as organic (blueprint 5.5, 13).
export function organicPer1000(audienceComments: number, views: number | null | undefined): number | null {
  if (!views || views <= 0) return null;
  return (audienceComments / views) * 1000;
}

export function computeMetrics(comments: CommentLike[], views: number | null): EngagementMetrics {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const audience = comments.filter((c) => c.authorType === "audience");
  const ownReplyParents = new Set(
    comments.filter((c) => c.authorType !== "audience" && c.parentId).map((c) => c.parentId as string),
  );
  const audienceTopLevel = audience.filter((c) => !c.parentId);
  const answered = audienceTopLevel.filter((c) => ownReplyParents.has(c.id));
  const hashes = audience.map((c) => c.authorIdHash).filter((h): h is string => Boolean(h));
  const audienceRepliesToOthers = audience.filter((c) => c.parentId && byId.get(c.parentId)).length;

  return {
    views,
    audienceComments: audience.length,
    creatorComments: comments.filter((c) => c.authorType === "creator").length,
    teamComments: comments.filter((c) => c.authorType === "team").length,
    // Only meaningful when identifiers were available (API-imported comments).
    uniqueAudienceParticipants: hashes.length ? new Set(hashes).size : null,
    audienceRepliesToOthers,
    organicPer1000Views: organicPer1000(audience.length, views),
    audienceTopLevel: audienceTopLevel.length,
    audienceTopLevelAnswered: answered.length,
    replyRate: audienceTopLevel.length ? answered.length / audienceTopLevel.length : null,
  };
}

export interface SnapshotLike {
  capturedAt: Date;
  views: number | null;
  likes: number | null;
  commentsCount: number | null;
}

// Snapshot closest to (and not before) publishedAt + offset, for the
// baseline / 24h / 7d checkpoints.
export function snapshotAt<T extends SnapshotLike>(snapshots: T[], publishedAt: Date | null, offsetMs: number): T | null {
  if (!publishedAt) return null;
  const target = publishedAt.getTime() + offsetMs;
  const candidates = snapshots.filter((s) => s.capturedAt.getTime() >= target).sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  return candidates[0] ?? null;
}

export function latestSnapshot<T extends SnapshotLike>(snapshots: T[]): T | null {
  return [...snapshots].sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())[0] ?? null;
}

export function mean(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
