import type { AuthorType, PlatformAccount } from "@prisma/client";
import { audit } from "../audit";
import { classifyComment } from "../comments/classify";
import { hashAuthorId } from "../crypto";
import { prisma } from "../db";
import { adapterFor as defaultAdapterFor, haltAccountJobs } from "../platforms/registry";
import type { AdapterFailure, CommentItem, PlatformAdapter } from "../platforms/types";

const COMMENT_SYNC_WINDOW_DAYS = 30;

export function authorTypeFor(
  externalAuthorId: string | undefined,
  account: Pick<PlatformAccount, "platformUserId">,
  affiliatedIds: Set<string>,
): AuthorType {
  if (externalAuthorId && externalAuthorId === account.platformUserId) return "creator";
  if (externalAuthorId && affiliatedIds.has(externalAuthorId)) return "team";
  return "audience";
}

async function recordFailure(account: PlatformAccount, failure: AdapterFailure) {
  const status = failure.status === "token_expired" ? "expired" : failure.status === "permission_required" ? "permission_required" : undefined;
  await prisma.platformAccount.update({
    where: { id: account.id },
    data: { lastError: failure.message, ...(status ? { connectionStatus: status } : {}) },
  });
  if (status) await haltAccountJobs(account.id, `sync_${failure.status}`);
}

export async function upsertComments(contentId: string, account: PlatformAccount, items: CommentItem[], affiliatedIds: Set<string>) {
  // Parents first so replies can link to them.
  const ordered = [...items].sort((a, b) => Number(Boolean(a.externalParentId)) - Number(Boolean(b.externalParentId)));
  const idByExternal = new Map<string, string>();
  for (const item of ordered) {
    const parentId = item.externalParentId ? idByExternal.get(item.externalParentId) ?? null : null;
    const authorType = authorTypeFor(item.externalAuthorId, account, affiliatedIds);
    const data = {
      text: item.text,
      parentId,
      replyCount: item.replyCount,
      authorType,
      authorDisplayName: item.authorDisplayName ?? null,
      authorIdHash: item.externalAuthorId ? hashAuthorId(account.platform, item.externalAuthorId) : null,
      publishedAt: item.publishedAt,
    };
    const row = await prisma.comment.upsert({
      where: { contentId_externalCommentId: { contentId, externalCommentId: item.externalCommentId } },
      create: { ...data, contentId, externalCommentId: item.externalCommentId, source: "api", category: authorType === "audience" ? classifyComment(item.text) : "other" },
      update: data,
    });
    idByExternal.set(item.externalCommentId, row.id);
  }
}

export async function syncAccount(account: PlatformAccount, adapterFor: (a: PlatformAccount) => Promise<PlatformAdapter> = defaultAdapterFor) {
  const adapter = await adapterFor(account);
  if (!adapter.capabilities.listRecentContent) return { synced: false, reason: "unsupported" as const };

  const recent = await adapter.listRecentContent();
  if (!recent.ok) {
    await recordFailure(account, recent);
    return { synced: false, reason: recent.status };
  }
  for (const item of recent.data) {
    await prisma.content.upsert({
      where: { platformAccountId_externalVideoId: { platformAccountId: account.id, externalVideoId: item.externalVideoId } },
      create: { platformAccountId: account.id, externalVideoId: item.externalVideoId, url: item.url, title: item.title, caption: item.caption, publishedAt: item.publishedAt, source: "api", syncStatus: "synced" },
      update: { title: item.title, caption: item.caption, syncStatus: "synced" },
    });
  }

  const affiliated = await prisma.affiliatedAuthor.findMany({ where: { creatorId: account.creatorId, platform: account.platform } });
  const affiliatedIds = new Set(affiliated.map((a) => a.externalAuthorId));
  const since = new Date(Date.now() - COMMENT_SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const contents = await prisma.content.findMany({
    where: { platformAccountId: account.id, externalVideoId: { not: null }, OR: [{ publishedAt: null }, { publishedAt: { gte: since } }] },
  });

  for (const content of contents) {
    const videoId = content.externalVideoId!;
    if (adapter.capabilities.listComments) {
      const comments = await adapter.listComments(videoId);
      if (comments.ok) await upsertComments(content.id, account, comments.data, affiliatedIds);
      else if (comments.status !== "permission_required") await recordFailure(account, comments);
    }
    if (adapter.capabilities.getMetrics) {
      const metrics = await adapter.getMetrics(videoId);
      if (metrics.ok) {
        await prisma.engagementSnapshot.create({ data: { contentId: content.id, source: "api", ...metrics.data } });
      }
    }
  }

  await prisma.platformAccount.update({ where: { id: account.id }, data: { lastSyncedAt: new Date(), lastError: null } });
  await audit({ action: "account.synced", actor: "system:worker", targetType: "platform_account", targetId: account.id, metadata: { content: recent.data.length } });
  return { synced: true as const, content: recent.data.length };
}

export const DEFAULT_RETENTION_DAYS = 365;

// Anonymises audience comments past the creator's retention window. Counts
// survive for analytics; text and identifiers do not.
export async function purgeExpiredAudienceData(now = new Date()) {
  const creators = await prisma.creator.findMany({ select: { id: true, settings: true } });
  let total = 0;
  for (const creator of creators) {
    const days = Number((creator.settings as { retentionDays?: number })?.retentionDays ?? DEFAULT_RETENTION_DAYS);
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const res = await prisma.comment.updateMany({
      where: {
        authorType: "audience",
        publishedAt: { lt: cutoff },
        authorDisplayName: { not: null },
        content: { account: { creatorId: creator.id } },
      },
      data: { text: "[dihapus sesuai kebijakan retensi]", authorDisplayName: null, authorIdHash: null },
    });
    total += res.count;
  }
  return total;
}
