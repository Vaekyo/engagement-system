import type { Platform, Prisma } from "@prisma/client";
import { audit } from "../audit";
import { prisma } from "../db";
import { isLivePublishingEnabled, isMockMode } from "../env";
import { checkDraft, extractKeywords, hasBlockingFlag, parseFlags, type RiskFlag } from "../ai/guardrails";
import type { DraftOption } from "../ai/schema";
import { adapterFor } from "../platforms/registry";
import { enqueuePublishJob, recordOwnComment } from "../publishing/service";
import { assertTransition, EDITABLE_STATUSES } from "./state-machine";

export class DraftError extends Error {}

async function loadOwnedDraft(draftId: string, creatorId: string) {
  const draft = await prisma.aiDraft.findUnique({
    where: { id: draftId },
    include: { content: { include: { account: true } }, sourceComment: true, publishJob: true },
  });
  if (!draft || draft.content.account.creatorId !== creatorId) throw new DraftError("Draf tidak ditemukan.");
  return draft;
}

function flagsFor(
  text: string,
  content: { title: string | null; caption: string | null; creatorNotes: string | null; account: { platform: Platform } },
  draftType: "starter" | "reply",
  modelLabels: DraftOption["risk_labels"] = [],
): RiskFlag[] {
  const flags = checkDraft(text, {
    platform: content.account.platform,
    draftType,
    contentKeywords: extractKeywords(content.title, content.caption, content.creatorNotes),
  });
  for (const label of modelLabels) {
    flags.push({ code: "model_flag", severity: "warn", message: `${label.label}: ${label.detail}` });
  }
  return flags;
}

export async function createDrafts(input: {
  creatorId: string;
  contentId: string;
  sourceCommentId?: string;
  draftType: "starter" | "reply";
  options: DraftOption[];
  modelVersion: string;
}) {
  const content = await prisma.content.findUnique({ where: { id: input.contentId }, include: { account: true } });
  if (!content || content.account.creatorId !== input.creatorId) throw new DraftError("Konten tidak ditemukan.");

  const created = await prisma.$transaction(
    input.options.map((option) =>
      prisma.aiDraft.create({
        data: {
          contentId: content.id,
          sourceCommentId: input.sourceCommentId,
          draftType: input.draftType,
          text: option.text.trim(),
          originalText: option.text.trim(),
          rationale: option.rationale,
          modelVersion: input.modelVersion,
          riskFlags: flagsFor(option.text, content, input.draftType, option.risk_labels) as unknown as Prisma.InputJsonValue,
        },
      }),
    ),
  );
  await audit({
    action: "drafts.generated",
    actor: `creator:${input.creatorId}`,
    targetType: input.sourceCommentId ? "comment" : "content",
    targetId: input.sourceCommentId ?? content.id,
    metadata: { count: created.length, modelVersion: input.modelVersion, draftType: input.draftType },
  });
  return created;
}

export async function editDraft(draftId: string, creatorId: string, text: string) {
  const draft = await loadOwnedDraft(draftId, creatorId);
  if (!EDITABLE_STATUSES.includes(draft.status)) throw new DraftError("Draf ini tidak bisa diedit lagi.");
  const modelFlags = parseFlags(draft.riskFlags).filter((f) => f.code === "model_flag");
  const flags = [...flagsFor(text, draft.content, draft.draftType), ...modelFlags];
  await prisma.aiDraft.update({
    where: { id: draft.id },
    data: { text: text.trim(), riskFlags: flags as unknown as Prisma.InputJsonValue },
  });
  await audit({ action: "draft.edited", actor: `creator:${creatorId}`, targetType: "ai_draft", targetId: draft.id });
}

export async function submitDraft(draftId: string, creatorId: string) {
  const draft = await loadOwnedDraft(draftId, creatorId);
  assertTransition(draft.status, "pending_approval");
  await prisma.aiDraft.update({ where: { id: draft.id }, data: { status: "pending_approval" } });
  await audit({ action: "draft.submitted", actor: `creator:${creatorId}`, targetType: "ai_draft", targetId: draft.id });
}

export async function rejectDraft(draftId: string, creatorId: string, reason?: string) {
  const draft = await loadOwnedDraft(draftId, creatorId);
  assertTransition(draft.status, "rejected");
  await prisma.aiDraft.update({ where: { id: draft.id }, data: { status: "rejected", rejectedReason: reason || null } });
  await audit({ action: "draft.rejected", actor: `creator:${creatorId}`, targetType: "ai_draft", targetId: draft.id, metadata: { reason } });
}

export async function cancelDraft(draftId: string, creatorId: string) {
  const draft = await loadOwnedDraft(draftId, creatorId);
  assertTransition(draft.status, "cancelled");
  await prisma.$transaction(async (tx) => {
    await tx.aiDraft.update({ where: { id: draft.id }, data: { status: "cancelled" } });
    if (draft.publishJob) {
      await tx.publishJob.updateMany({
        where: { id: draft.publishJob.id, state: { in: ["queued", "retry_scheduled", "failed", "manual_action_required"] } },
        data: { state: "cancelled", completedAt: new Date() },
      });
    }
  });
  await audit({ action: "draft.cancelled", actor: `creator:${creatorId}`, targetType: "ai_draft", targetId: draft.id });
}

export type ApprovalOutcome = "queued" | "manual_action_required";

// Explicit human approval. `confirmedAccountId` must equal the account the
// comment will be published from, proving the approver saw that identity.
export async function approveDraft(draftId: string, creatorId: string, confirmedAccountId: string): Promise<ApprovalOutcome> {
  const draft = await loadOwnedDraft(draftId, creatorId);
  const account = draft.content.account;
  if (confirmedAccountId !== account.id) throw new DraftError("Konfirmasi akun penerbit tidak cocok.");
  assertTransition(draft.status, "approved");
  const flags = parseFlags(draft.riskFlags);
  if (hasBlockingFlag(flags)) throw new DraftError("Draf memiliki risiko yang memblokir. Edit draf terlebih dahulu.");

  const adapter = await adapterFor(account);
  const canAutoPublish =
    (isMockMode() || isLivePublishingEnabled()) &&
    (draft.draftType === "reply"
      ? adapter.capabilities.replyToComment && Boolean(draft.sourceComment?.externalCommentId)
      : adapter.capabilities.publishComment && Boolean(draft.content.externalVideoId));

  const approvedAt = new Date();
  const actor = `creator:${creatorId}`;
  return prisma.$transaction(async (tx) => {
    // Conditional update guards against a concurrent approve.
    const res = await tx.aiDraft.updateMany({
      where: { id: draft.id, status: "pending_approval" },
      data: { status: "approved", approvedAt, approvedBy: actor },
    });
    if (res.count === 0) throw new DraftError("Draf sudah diproses.");
    await audit({ action: "draft.approved", actor, targetType: "ai_draft", targetId: draft.id, metadata: { publishAs: `${account.platform}:${account.handle}` } }, tx);

    if (canAutoPublish) {
      const job = await enqueuePublishJob(tx, { id: draft.id, text: draft.text, approvedAt }, account);
      await tx.aiDraft.update({ where: { id: draft.id }, data: { status: "queued" } });
      await audit({ action: "publish_job.queued", actor, targetType: "publish_job", targetId: job.id }, tx);
      return "queued";
    }
    await tx.aiDraft.update({ where: { id: draft.id }, data: { status: "manual_action_required" } });
    return "manual_action_required";
  });
}

// Manual fallback: the creator copied the text and posted it themselves.
export async function markPostedManually(draftId: string, creatorId: string) {
  const draft = await loadOwnedDraft(draftId, creatorId);
  assertTransition(draft.status, "published");
  if (draft.status !== "manual_action_required") throw new DraftError("Hanya draf yang perlu posting manual.");
  await prisma.$transaction(async (tx) => {
    await tx.aiDraft.update({ where: { id: draft.id }, data: { status: "published" } });
    await recordOwnComment(tx, {
      contentId: draft.contentId,
      text: draft.text,
      parentId: draft.sourceCommentId,
      externalCommentId: null,
      authorType: draft.content.account.accountType === "team" ? "team" : "creator",
      authorDisplayName: draft.content.account.handle,
      source: "manual",
    });
    await audit({ action: "draft.published_manually", actor: `creator:${creatorId}`, targetType: "ai_draft", targetId: draft.id }, tx);
  });
}

// Re-queues a failed job. Jobs whose outcome is unknown require the creator
// to confirm they checked the platform, so a retry can't double-post.
export async function retryDraft(draftId: string, creatorId: string, confirmedNotPosted: boolean) {
  const draft = await loadOwnedDraft(draftId, creatorId);
  assertTransition(draft.status, "queued");
  const job = draft.publishJob;
  if (!job) throw new DraftError("Tidak ada job publikasi untuk draf ini.");
  if (job.errorCode === "unknown_outcome" && !confirmedNotPosted) {
    throw new DraftError("Konfirmasi bahwa komentar belum muncul di platform sebelum mencoba ulang.");
  }
  await prisma.$transaction([
    prisma.publishJob.update({
      where: { id: job.id },
      data: { state: "queued", nextAttemptAt: new Date(), attempts: 0, errorCode: null, errorMessage: null, completedAt: null },
    }),
    prisma.aiDraft.update({ where: { id: draft.id }, data: { status: "queued" } }),
  ]);
  await audit({ action: "publish_job.retried", actor: `creator:${creatorId}`, targetType: "publish_job", targetId: job.id });
}

export async function reopenDraft(draftId: string, creatorId: string) {
  const draft = await loadOwnedDraft(draftId, creatorId);
  assertTransition(draft.status, "draft");
  await prisma.aiDraft.update({ where: { id: draft.id }, data: { status: "draft", rejectedReason: null } });
  await audit({ action: "draft.reopened", actor: `creator:${creatorId}`, targetType: "ai_draft", targetId: draft.id });
}
