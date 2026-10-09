import { prisma } from "../db";
import { computeMetrics, DAY, latestSnapshot, mean, snapshotAt, type EngagementMetrics } from "./metrics";

export interface ContentReportRow {
  id: string;
  title: string;
  platform: "youtube" | "instagram" | "tiktok";
  experimentGroup: "seeded" | "control" | null;
  publishedAt: Date | null;
  metrics: EngagementMetrics;
  views24h: number | null;
  views7d: number | null;
  starterPublished: number;
}

export async function buildContentReport(creatorId: string): Promise<ContentReportRow[]> {
  const content = await prisma.content.findMany({
    where: { account: { creatorId } },
    include: {
      account: { select: { platform: true } },
      comments: { select: { id: true, parentId: true, authorType: true, authorIdHash: true } },
      snapshots: { select: { capturedAt: true, views: true, likes: true, commentsCount: true } },
      drafts: { where: { draftType: "starter", status: "published" }, select: { id: true } },
    },
    orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });
  return content.map((c) => {
    const latest = latestSnapshot(c.snapshots);
    return {
      id: c.id,
      title: c.title ?? c.url,
      platform: c.account.platform,
      experimentGroup: c.experimentGroup,
      publishedAt: c.publishedAt,
      metrics: computeMetrics(c.comments, latest?.views ?? null),
      views24h: snapshotAt(c.snapshots, c.publishedAt, DAY)?.views ?? null,
      views7d: snapshotAt(c.snapshots, c.publishedAt, 7 * DAY)?.views ?? null,
      starterPublished: c.drafts.length,
    };
  });
}

export interface GroupSummary {
  count: number;
  meanOrganicPer1000: number | null;
  meanReplyRate: number | null;
  meanUniqueParticipants: number | null;
  meanAudienceReplies: number | null;
}

export function summarizeGroup(rows: ContentReportRow[]): GroupSummary {
  return {
    count: rows.length,
    meanOrganicPer1000: mean(rows.map((r) => r.metrics.organicPer1000Views)),
    meanReplyRate: mean(rows.map((r) => r.metrics.replyRate)),
    meanUniqueParticipants: mean(rows.map((r) => r.metrics.uniqueAudienceParticipants)),
    meanAudienceReplies: mean(rows.map((r) => r.metrics.audienceRepliesToOthers)),
  };
}
