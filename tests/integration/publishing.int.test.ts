import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { approveDraft, DraftError, editDraft, markPostedManually, retryDraft, submitDraft } from "@/lib/drafts/service";
import { InvalidTransitionError } from "@/lib/drafts/state-machine";
import { processDueJobs, recoverStaleJobs } from "@/lib/publishing/service";
import { fakeAdapter, makeDraft, makeWorkspace, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

async function approved() {
  const ws = await makeWorkspace();
  const draft = await makeDraft(ws.content.id);
  await submitDraft(draft.id, ws.creator.id);
  const outcome = await approveDraft(draft.id, ws.creator.id, ws.account.id);
  return { ...ws, draft, outcome };
}

describe("approval gate", () => {
  it("never publishes a draft that was not approved", async () => {
    const ws = await makeWorkspace();
    const draft = await makeDraft(ws.content.id);
    const fake = fakeAdapter([]);
    await processDueJobs({ adapterFor: fake.adapterFor });
    expect(fake.calls).toHaveLength(0);
    expect(await prisma.publishJob.count()).toBe(0);
    await expect(approveDraft(draft.id, ws.creator.id, ws.account.id)).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("requires confirming the publishing account", async () => {
    const ws = await makeWorkspace();
    const draft = await makeDraft(ws.content.id);
    await submitDraft(draft.id, ws.creator.id);
    await expect(approveDraft(draft.id, ws.creator.id, "some-other-account")).rejects.toBeInstanceOf(DraftError);
    expect((await prisma.aiDraft.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("pending_approval");
  });

  it("refuses to approve drafts with blocking guardrail flags", async () => {
    const ws = await makeWorkspace();
    const draft = await makeDraft(ws.content.id);
    await editDraft(draft.id, ws.creator.id, "Sebagai fans, baru nemu channel ini dan lampu toples-nya keren");
    await submitDraft(draft.id, ws.creator.id);
    await expect(approveDraft(draft.id, ws.creator.id, ws.account.id)).rejects.toThrow(/memblokir/);
  });

  it("denies access to another creator's drafts", async () => {
    const ws = await makeWorkspace();
    const draft = await makeDraft(ws.content.id);
    const other = await prisma.creator.create({ data: { displayName: "Other", passwordHash: "x" } });
    await expect(submitDraft(draft.id, other.id)).rejects.toBeInstanceOf(DraftError);
  });

  it("records approver and timestamp in the audit log", async () => {
    const { draft, outcome } = await approved();
    expect(outcome).toBe("queued");
    const row = await prisma.aiDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.status).toBe("queued");
    expect(row.approvedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "draft.approved", targetId: draft.id } })).toBe(1);
  });
});

describe("idempotency", () => {
  it("creates exactly one job even if approval is retried", async () => {
    const { draft, creator, account } = await approved();
    await expect(approveDraft(draft.id, creator.id, account.id)).rejects.toBeInstanceOf(InvalidTransitionError);
    expect(await prisma.publishJob.count({ where: { draftId: draft.id } })).toBe(1);
  });

  it("publishes once across repeated and concurrent worker runs", async () => {
    const { draft } = await approved();
    const fake = fakeAdapter([]);
    const results = await Promise.all([1, 2, 3, 4].map(() => processDueJobs({ adapterFor: fake.adapterFor })));
    await processDueJobs({ adapterFor: fake.adapterFor });
    expect(fake.calls).toHaveLength(1);
    expect(results.reduce((n, r) => n + r.published, 0)).toBe(1);
    const job = await prisma.publishJob.findUniqueOrThrow({ where: { draftId: draft.id } });
    expect(job.state).toBe("published");
    expect(job.externalCommentId).toBe("ext_1");
    expect((await prisma.aiDraft.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("published");
    // The creator's own comment is stored and not counted as audience.
    const own = await prisma.comment.findMany({ where: { contentId: draft.contentId } });
    expect(own).toHaveLength(1);
    expect(own[0].authorType).toBe("creator");
  });
});

describe("retry and failure handling", () => {
  it("retries rate-limited attempts with backoff and then publishes", async () => {
    const { draft } = await approved();
    const fake = fakeAdapter([{ ok: false, status: "rate_limited", message: "quota", retryable: true }]);
    const t0 = new Date();
    await processDueJobs({ adapterFor: fake.adapterFor, now: t0 });
    let job = await prisma.publishJob.findUniqueOrThrow({ where: { draftId: draft.id } });
    expect(job.state).toBe("retry_scheduled");
    expect(job.nextAttemptAt.getTime()).toBe(t0.getTime() + 30_000);

    // Not due yet.
    await processDueJobs({ adapterFor: fake.adapterFor, now: new Date(t0.getTime() + 10_000) });
    expect(fake.calls).toHaveLength(1);

    await processDueJobs({ adapterFor: fake.adapterFor, now: new Date(t0.getTime() + 31_000) });
    job = await prisma.publishJob.findUniqueOrThrow({ where: { draftId: draft.id } });
    expect(job.state).toBe("published");
    expect(job.attempts).toBe(2);
    expect(fake.calls).toHaveLength(2);
  });

  it("does not auto-retry errors where the outcome is uncertain", async () => {
    const { draft } = await approved();
    const fake = fakeAdapter([{ ok: false, status: "error", message: "500", retryable: false }]);
    await processDueJobs({ adapterFor: fake.adapterFor });
    await processDueJobs({ adapterFor: fake.adapterFor, now: new Date(Date.now() + 3600_000) });
    expect(fake.calls).toHaveLength(1);
    expect((await prisma.aiDraft.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("failed");
  });

  it("falls back to manual posting when the platform reports permission_required", async () => {
    const { draft, creator } = await approved();
    const fake = fakeAdapter([{ ok: false, status: "permission_required", message: "commentsDisabled", retryable: false }]);
    await processDueJobs({ adapterFor: fake.adapterFor });
    expect((await prisma.aiDraft.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("manual_action_required");
    await markPostedManually(draft.id, creator.id);
    expect((await prisma.aiDraft.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("published");
  });

  it("halts all queued jobs for an account when its token is rejected", async () => {
    const { draft, creator, account, content } = await approved();
    const second = await makeDraft(content.id, "Bagian lampu toples mana yang mau dibahas berikutnya?");
    await submitDraft(second.id, creator.id);
    await approveDraft(second.id, creator.id, account.id);
    const fake = fakeAdapter([{ ok: false, status: "token_expired", message: "401", retryable: false }]);
    await processDueJobs({ adapterFor: fake.adapterFor, limit: 1 });
    expect(fake.calls).toHaveLength(1);
    const states = await prisma.publishJob.findMany({ select: { draftId: true, state: true } });
    expect(states.find((s) => s.draftId === draft.id)?.state).toBe("failed");
    expect(states.find((s) => s.draftId === second.id)?.state).toBe("cancelled");
    expect((await prisma.platformAccount.findUniqueOrThrow({ where: { id: account.id } })).connectionStatus).toBe("expired");
  });

  it("recovers stale running jobs without re-posting and requires confirmation to retry", async () => {
    const { draft, creator } = await approved();
    await prisma.publishJob.update({ where: { draftId: draft.id }, data: { state: "running", lockedAt: new Date(Date.now() - 60 * 60_000) } });
    expect(await recoverStaleJobs()).toBe(1);
    const job = await prisma.publishJob.findUniqueOrThrow({ where: { draftId: draft.id } });
    expect(job.state).toBe("failed");
    expect(job.errorCode).toBe("unknown_outcome");
    await expect(retryDraft(draft.id, creator.id, false)).rejects.toBeInstanceOf(DraftError);
    await retryDraft(draft.id, creator.id, true);
    const fake = fakeAdapter([]);
    await processDueJobs({ adapterFor: fake.adapterFor });
    expect(fake.calls).toHaveLength(1);
  });

  it("finishes without calling the platform if a comment ID was already recorded", async () => {
    const { draft } = await approved();
    await prisma.publishJob.update({ where: { draftId: draft.id }, data: { externalCommentId: "already" } });
    const fake = fakeAdapter([]);
    await processDueJobs({ adapterFor: fake.adapterFor });
    expect(fake.calls).toHaveLength(0);
    expect((await prisma.publishJob.findUniqueOrThrow({ where: { draftId: draft.id } })).state).toBe("published");
  });
});
