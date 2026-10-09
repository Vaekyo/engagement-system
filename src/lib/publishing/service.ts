import { Prisma, type PlatformAccount, type PublishJob } from "@prisma/client";
import { audit } from "../audit";
import { sha256 } from "../crypto";
import { prisma } from "../db";
import { adapterFor as defaultAdapterFor, haltAccountJobs } from "../platforms/registry";
import type { AdapterResult, PlatformAdapter, PublishResult } from "../platforms/types";
import { classifyPublishFailure, STALE_LOCK_MS } from "./policy";

type Tx = Prisma.TransactionClient;

export function idempotencyKeyFor(draftId: string, text: string): string {
  return sha256(`${draftId}:${sha256(text)}`);
}

// Creates the single publish job for an approved draft. The unique
// constraints on draftId and idempotencyKey mean a double click, a retried
// request or two workers can never create a second job.
export async function enqueuePublishJob(
  tx: Tx,
  draft: { id: string; text: string; approvedAt: Date },
  account: Pick<PlatformAccount, "id" | "platform">,
): Promise<PublishJob> {
  const idempotencyKey = idempotencyKeyFor(draft.id, draft.text);
  const existing = await tx.publishJob.findUnique({ where: { draftId: draft.id } });
  if (existing) return existing;
  return tx.publishJob.create({
    data: {
      draftId: draft.id,
      platform: account.platform,
      platformAccountId: account.id,
      approvedAt: draft.approvedAt,
      idempotencyKey,
      state: "queued",
    },
  });
}

export interface ProcessOptions {
  now?: Date;
  limit?: number;
  adapterFor?: (account: PlatformAccount) => Promise<PlatformAdapter>;
}

export interface ProcessSummary {
  published: number;
  retried: number;
  manual: number;
  failed: number;
  skipped: number;
}

// Moves jobs left in "running" by a crashed worker to failed. Whether the
// platform received the comment is unknown, so it is never auto-retried:
// the creator checks the platform first and retries by hand if needed.
export async function recoverStaleJobs(now = new Date()): Promise<number> {
  const stale = await prisma.publishJob.findMany({
    where: { state: "running", lockedAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) } },
    select: { id: true, draftId: true },
  });
  for (const job of stale) {
    await prisma.$transaction(async (tx) => {
      const res = await tx.publishJob.updateMany({
        where: { id: job.id, state: "running" },
        data: {
          state: "failed",
          errorCode: "unknown_outcome",
          errorMessage: "Worker berhenti saat publikasi. Cek platform sebelum mencoba ulang agar tidak dobel.",
          lockedAt: null,
        },
      });
      if (res.count) {
        await tx.aiDraft.update({ where: { id: job.draftId }, data: { status: "failed" } });
        await audit({ action: "publish_job.stale_recovered", actor: "system:worker", targetType: "publish_job", targetId: job.id }, tx);
      }
    });
  }
  return stale.length;
}

export async function processDueJobs(options: ProcessOptions = {}): Promise<ProcessSummary> {
  const now = options.now ?? new Date();
  const adapterFor = options.adapterFor ?? defaultAdapterFor;
  const summary: ProcessSummary = { published: 0, retried: 0, manual: 0, failed: 0, skipped: 0 };

  const due = await prisma.publishJob.findMany({
    where: { state: { in: ["queued", "retry_scheduled"] }, nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: "asc" },
    take: options.limit ?? 20,
    select: { id: true, state: true },
  });

  for (const candidate of due) {
    // Atomic claim: only one worker can flip this job to running.
    const claimed = await prisma.publishJob.updateMany({
      where: { id: candidate.id, state: candidate.state },
      data: { state: "running", lockedAt: now, attempts: { increment: 1 } },
    });
    if (claimed.count === 0) {
      summary.skipped++;
      continue;
    }
    const job = await prisma.publishJob.findUniqueOrThrow({
      where: { id: candidate.id },
      include: { account: true, draft: { include: { sourceComment: true } } },
    });
    const outcome = await runJob(job, adapterFor, now);
    summary[outcome]++;
  }
  return summary;
}

type JobWithRelations = Prisma.PublishJobGetPayload<{ include: { account: true; draft: { include: { sourceComment: true } } } }>;

async function runJob(
  job: JobWithRelations,
  adapterFor: (account: PlatformAccount) => Promise<PlatformAdapter>,
  now: Date,
): Promise<keyof ProcessSummary> {
  const { draft, account } = job;

  // A previous attempt already recorded a platform comment ID: finish
  // without calling the platform again.
  if (job.externalCommentId) {
    await markPublished(job, job.externalCommentId, now);
    return "published";
  }

  const content = await prisma.content.findUniqueOrThrow({ where: { id: draft.contentId } });
  const adapter = await adapterFor(account);
  let result: AdapterResult<PublishResult>;

  if (draft.draftType === "reply") {
    const parentId = draft.sourceComment?.externalCommentId;
    result = parentId
      ? await adapter.replyToComment(parentId, draft.text)
      : { ok: false, status: "unsupported", message: "Komentar asal dicatat manual; balas langsung di platform.", retryable: false };
  } else {
    result = content.externalVideoId
      ? await adapter.publishComment(content.externalVideoId, draft.text)
      : { ok: false, status: "unsupported", message: "Konten tidak punya ID platform; posting manual.", retryable: false };
  }

  if (result.ok) {
    await markPublished(job, result.data.externalCommentId, now);
    return "published";
  }

  const decision = classifyPublishFailure(result, job.attempts);
  const base = { lockedAt: null, errorCode: result.status, errorMessage: result.message };

  switch (decision.kind) {
    case "retry":
      await prisma.publishJob.update({
        where: { id: job.id },
        data: { ...base, state: "retry_scheduled", nextAttemptAt: new Date(now.getTime() + decision.delayMs) },
      });
      await audit({ action: "publish_job.retry_scheduled", actor: "system:worker", targetType: "publish_job", targetId: job.id, metadata: { attempts: job.attempts, error: result.status } });
      return "retried";
    case "manual":
      await prisma.$transaction([
        prisma.publishJob.update({ where: { id: job.id }, data: { ...base, state: "manual_action_required", completedAt: now } }),
        prisma.aiDraft.update({ where: { id: draft.id }, data: { status: "manual_action_required" } }),
      ]);
      await audit({ action: "publish_job.manual_action_required", actor: "system:worker", targetType: "publish_job", targetId: job.id, metadata: { reason: result.message } });
      return "manual";
    case "halt_account":
      await prisma.$transaction([
        prisma.publishJob.update({ where: { id: job.id }, data: { ...base, state: "failed", completedAt: now } }),
        prisma.aiDraft.update({ where: { id: draft.id }, data: { status: "failed" } }),
        prisma.platformAccount.update({ where: { id: account.id }, data: { connectionStatus: decision.accountStatus, lastError: result.message } }),
      ]);
      await haltAccountJobs(account.id, decision.reason);
      await audit({ action: "publish_job.failed", actor: "system:worker", targetType: "publish_job", targetId: job.id, metadata: { error: result.status, haltedAccount: true } });
      return "failed";
    case "failed":
      await prisma.$transaction([
        prisma.publishJob.update({ where: { id: job.id }, data: { ...base, state: "failed", completedAt: now } }),
        prisma.aiDraft.update({ where: { id: draft.id }, data: { status: "failed" } }),
      ]);
      await audit({ action: "publish_job.failed", actor: "system:worker", targetType: "publish_job", targetId: job.id, metadata: { error: result.status } });
      return "failed";
  }
}

async function markPublished(job: JobWithRelations, externalCommentId: string, now: Date) {
  const { draft, account } = job;
  await prisma.$transaction(async (tx) => {
    await tx.publishJob.update({
      where: { id: job.id },
      data: { state: "published", externalCommentId, completedAt: now, lockedAt: null, errorCode: null, errorMessage: null },
    });
    await tx.aiDraft.update({ where: { id: draft.id }, data: { status: "published" } });
    await recordOwnComment(tx, {
      contentId: draft.contentId,
      text: draft.text,
      parentId: draft.sourceCommentId,
      externalCommentId,
      authorType: account.accountType === "team" ? "team" : "creator",
      authorDisplayName: account.handle,
      source: externalCommentId.startsWith("mock_") ? "mock" : "api",
    });
    await audit(
      { action: "draft.published", actor: "system:worker", targetType: "ai_draft", targetId: draft.id, metadata: { jobId: job.id, platform: job.platform, externalCommentId } },
      tx,
    );
  });
}

// Stores the creator/team's own comment so analytics can separate it from
// organic audience activity, and bumps the parent's reply count.
export async function recordOwnComment(
  tx: Tx,
  input: {
    contentId: string;
    text: string;
    parentId: string | null;
    externalCommentId: string | null;
    authorType: "creator" | "team";
    authorDisplayName: string;
    source: "api" | "manual" | "mock";
  },
) {
  await tx.comment.create({
    data: {
      contentId: input.contentId,
      text: input.text,
      parentId: input.parentId,
      externalCommentId: input.externalCommentId,
      authorType: input.authorType,
      authorDisplayName: input.authorDisplayName,
      category: "other",
      source: input.source,
    },
  });
  if (input.parentId) {
    await tx.comment.update({ where: { id: input.parentId }, data: { replyCount: { increment: 1 } } });
  }
}
