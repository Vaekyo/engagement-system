"use server";

import { Platform, type Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { actorFor, endSession, requireCreator, startSession } from "@/lib/auth/session";
import { parseContentUrl } from "@/lib/content-url";
import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { AiGenerationError, generateAnalysis, generateReplies } from "@/lib/ai/generate";
import { INPUT_LIMITS } from "@/lib/ai/schema";
import {
  approveDraft,
  cancelDraft,
  createDrafts,
  DraftError,
  editDraft,
  markPostedManually,
  rejectDraft,
  reopenDraft,
  retryDraft,
  submitDraft,
} from "@/lib/drafts/service";
import { InvalidTransitionError } from "@/lib/drafts/state-machine";
import { classifyComment } from "@/lib/comments/classify";
import { syncAccount } from "@/lib/jobs/sync";
import { revokeToken } from "@/lib/oauth/google";
import { haltAccountJobs } from "@/lib/platforms/registry";
import { processDueJobs } from "@/lib/publishing/service";

class ActionError extends Error {}

type CreatorSession = Awaited<ReturnType<typeof requireCreator>>;

function safeReturnTo(value: FormDataEntryValue | null): string {
  const v = typeof value === "string" ? value : "/";
  return v.startsWith("/") && !v.startsWith("//") ? v : "/";
}

function withParam(path: string, key: string, value: string) {
  const url = new URL(path, "http://local");
  url.searchParams.delete("ok");
  url.searchParams.delete("error");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

const isUserFacing = (e: unknown) =>
  e instanceof ActionError || e instanceof DraftError || e instanceof InvalidTransitionError || e instanceof AiGenerationError;

async function run(formData: FormData, fn: (creator: CreatorSession) => Promise<string | void>) {
  const creator = await requireCreator();
  const returnTo = safeReturnTo(formData.get("returnTo"));
  let message: string;
  try {
    message = (await fn(creator)) || "Tersimpan.";
  } catch (error) {
    if (isUserFacing(error)) redirect(withParam(returnTo, "error", (error as Error).message));
    if (error instanceof z.ZodError) redirect(withParam(returnTo, "error", error.issues.map((i) => i.message).join(" ")));
    throw error;
  }
  redirect(withParam(returnTo, "ok", message));
}

const str = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
};
const optional = (formData: FormData, key: string) => str(formData, key) || null;

async function ownedAccount(creatorId: string, accountId: string) {
  const account = await prisma.platformAccount.findUnique({ where: { id: accountId } });
  if (!account || account.creatorId !== creatorId) throw new ActionError("Akun tidak ditemukan.");
  return account;
}

async function ownedContent(creatorId: string, contentId: string) {
  const content = await prisma.content.findUnique({ where: { id: contentId }, include: { account: true } });
  if (!content || content.account.creatorId !== creatorId) throw new ActionError("Konten tidak ditemukan.");
  return content;
}

// --- Workspace & session -----------------------------------------------------

const SetupSchema = z.object({
  displayName: z.string().min(2, "Nama minimal 2 karakter.").max(80),
  password: z.string().min(10, "Kata sandi dashboard minimal 10 karakter."),
});

export async function setupWorkspace(formData: FormData) {
  if ((await prisma.creator.count()) > 0) redirect("/login");
  const parsed = SetupSchema.safeParse({ displayName: str(formData, "displayName"), password: formData.get("password") });
  if (!parsed.success) redirect(`/setup?error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  const creator = await prisma.creator.create({
    data: { displayName: parsed.data.displayName, passwordHash: await hashPassword(parsed.data.password), settings: { retentionDays: 365 } },
  });
  await audit({ action: "workspace.created", actor: actorFor(creator.id), targetType: "creator", targetId: creator.id });
  await startSession(creator.id);
  redirect("/");
}

export async function login(formData: FormData) {
  const password = formData.get("password");
  // Single-creator workspace (MVP scope).
  const creator = await prisma.creator.findFirst();
  if (!creator) redirect("/setup");
  if (typeof password !== "string" || !(await verifyPassword(password, creator.passwordHash))) {
    await audit({ action: "session.login_failed", actor: "anonymous", targetType: "creator", targetId: creator.id });
    redirect("/login?error=" + encodeURIComponent("Kata sandi salah."));
  }
  await startSession(creator.id);
  await audit({ action: "session.login", actor: actorFor(creator.id), targetType: "creator", targetId: creator.id });
  redirect("/");
}

export async function logout() {
  await endSession();
  redirect("/login");
}

export async function updateSettings(formData: FormData) {
  await run(formData, async (creator) => {
    const retentionDays = z.coerce.number().int().min(30, "Retensi minimal 30 hari.").max(3650).parse(formData.get("retentionDays"));
    const settings = { ...((creator.settings as Record<string, unknown>) ?? {}), retentionDays };
    await prisma.creator.update({ where: { id: creator.id }, data: { settings: settings as Prisma.InputJsonValue } });
    await audit({ action: "settings.updated", actor: actorFor(creator.id), targetType: "creator", targetId: creator.id, metadata: { retentionDays } });
    return "Pengaturan disimpan.";
  });
}

// --- Accounts ------------------------------------------------------------------

export async function addManualAccount(formData: FormData) {
  await run(formData, async (creator) => {
    const platform = z.nativeEnum(Platform).parse(formData.get("platform"));
    const handle = z.string().min(1, "Isi handle akun.").max(100).parse(str(formData, "handle").replace(/^@/, ""));
    const accountType = z.enum(["official", "team"]).parse(formData.get("accountType") ?? "official");
    const existing = await prisma.platformAccount.findUnique({ where: { creatorId_platform_handle: { creatorId: creator.id, platform, handle } } });
    if (existing) throw new ActionError("Akun ini sudah terdaftar.");
    const account = await prisma.platformAccount.create({
      data: { creatorId: creator.id, platform, handle, accountType, connectionStatus: platform === "instagram" ? "permission_required" : "manual" },
    });
    await audit({ action: "account.added_manual", actor: actorFor(creator.id), targetType: "platform_account", targetId: account.id, metadata: { platform, handle, accountType } });
    return `Akun @${handle} ditambahkan dalam mode manual.`;
  });
}

export async function revokeAccount(formData: FormData) {
  await run(formData, async (creator) => {
    const account = await ownedAccount(creator.id, str(formData, "accountId"));
    let revokedAtPlatform = false;
    const token = account.encryptedRefreshToken ?? account.encryptedAccessToken;
    if (account.platform === "youtube" && token) {
      try {
        revokedAtPlatform = await revokeToken(decryptSecret(token));
      } catch {
        revokedAtPlatform = false;
      }
    }
    await prisma.platformAccount.update({
      where: { id: account.id },
      data: { encryptedAccessToken: null, encryptedRefreshToken: null, tokenExpiresAt: null, scopes: [], connectionStatus: "revoked" },
    });
    await haltAccountJobs(account.id, "account_revoked");
    await audit({ action: "account.revoked", actor: actorFor(creator.id), targetType: "platform_account", targetId: account.id, metadata: { revokedAtPlatform } });
    return revokedAtPlatform ? "Akses dicabut dan token dihapus." : "Token dihapus dari aplikasi. Cabut juga akses di pengaturan akun Google bila perlu.";
  });
}

export async function syncAccountNow(formData: FormData) {
  await run(formData, async (creator) => {
    const account = await ownedAccount(creator.id, str(formData, "accountId"));
    const res = await syncAccount(account);
    if (!res.synced) throw new ActionError(`Sinkronisasi tidak tersedia: ${res.reason}.`);
    return `Sinkronisasi selesai: ${res.content} konten.`;
  });
}

export async function addAffiliatedAuthor(formData: FormData) {
  await run(formData, async (creator) => {
    const platform = z.nativeEnum(Platform).parse(formData.get("platform"));
    const externalAuthorId = z.string().min(1, "Isi ID akun platform.").max(200).parse(str(formData, "externalAuthorId"));
    const label = z.string().min(1, "Isi label.").max(100).parse(str(formData, "label"));
    await prisma.affiliatedAuthor.upsert({
      where: { creatorId_platform_externalAuthorId: { creatorId: creator.id, platform, externalAuthorId } },
      create: { creatorId: creator.id, platform, externalAuthorId, label },
      update: { label },
    });
    await audit({ action: "affiliated_author.saved", actor: actorFor(creator.id), targetType: "affiliated_author", metadata: { platform, label } });
    return "Akun tim/afiliasi disimpan.";
  });
}

// --- Content -----------------------------------------------------------------

const ContextSchema = z.object({
  title: z.string().max(300).nullable(),
  caption: z.string().max(INPUT_LIMITS.caption, `Caption maksimal ${INPUT_LIMITS.caption} karakter.`).nullable(),
  creatorNotes: z.string().max(INPUT_LIMITS.creatorNotes, `Ringkasan maksimal ${INPUT_LIMITS.creatorNotes} karakter.`).nullable(),
  transcript: z.string().max(INPUT_LIMITS.transcript, `Transkrip maksimal ${INPUT_LIMITS.transcript} karakter.`).nullable(),
});

function readContext(formData: FormData) {
  return ContextSchema.parse({
    title: optional(formData, "title"),
    caption: optional(formData, "caption"),
    creatorNotes: optional(formData, "creatorNotes"),
    transcript: optional(formData, "transcript"),
  });
}

export async function addContentFromUrl(formData: FormData) {
  const creator = await requireCreator();
  const parsed = parseContentUrl(str(formData, "url"));
  if (!parsed) redirect("/content?error=" + encodeURIComponent("URL tidak dikenali. Gunakan URL YouTube Shorts, Instagram Reels, atau TikTok."));
  let contentId: string;
  try {
    const context = readContext(formData);
    const accountId = str(formData, "accountId");
    const account = accountId
      ? await ownedAccount(creator.id, accountId)
      : await prisma.platformAccount.findFirst({ where: { creatorId: creator.id, platform: parsed.platform, accountType: "official" } });
    if (!account) throw new ActionError(`Tambahkan akun ${parsed.platform} terlebih dahulu di halaman Akun.`);
    if (account.platform !== parsed.platform) throw new ActionError("URL tidak cocok dengan platform akun yang dipilih.");
    if (parsed.externalVideoId) {
      const dup = await prisma.content.findUnique({ where: { platformAccountId_externalVideoId: { platformAccountId: account.id, externalVideoId: parsed.externalVideoId } } });
      if (dup) throw new ActionError("Konten ini sudah tercatat.");
    }
    const content = await prisma.content.create({
      data: { platformAccountId: account.id, url: parsed.url, externalVideoId: parsed.externalVideoId, source: "manual", syncStatus: "manual", ...context },
    });
    contentId = content.id;
    await audit({ action: "content.added_manual", actor: actorFor(creator.id), targetType: "content", targetId: content.id, metadata: { platform: parsed.platform } });
  } catch (error) {
    if (isUserFacing(error)) redirect("/content?error=" + encodeURIComponent((error as Error).message));
    if (error instanceof z.ZodError) redirect("/content?error=" + encodeURIComponent(error.issues[0].message));
    throw error;
  }
  redirect(`/content/${contentId}?ok=` + encodeURIComponent("Konten ditambahkan. Lengkapi konteks lalu jalankan analisis AI."));
}

export async function updateContentContext(formData: FormData) {
  await run(formData, async (creator) => {
    const content = await ownedContent(creator.id, str(formData, "contentId"));
    const group = str(formData, "experimentGroup");
    await prisma.content.update({
      where: { id: content.id },
      data: { ...readContext(formData), experimentGroup: group === "seeded" || group === "control" ? group : null },
    });
    await audit({ action: "content.context_updated", actor: actorFor(creator.id), targetType: "content", targetId: content.id });
    return "Konteks konten disimpan.";
  });
}

export async function analyzeContent(formData: FormData) {
  await run(formData, async (creator) => {
    const content = await ownedContent(creator.id, str(formData, "contentId"));
    if (!content.caption && !content.creatorNotes && !content.transcript && !content.title) {
      throw new ActionError("Isi minimal judul, caption, ringkasan, atau transkrip sebelum analisis.");
    }
    const { output, modelVersion } = await generateAnalysis({
      platform: content.account.platform,
      title: content.title,
      caption: content.caption,
      creatorNotes: content.creatorNotes,
      transcript: content.transcript,
    });
    const { starter_comments, ...analysis } = output;
    await prisma.content.update({
      where: { id: content.id },
      data: { analysis: { ...analysis, modelVersion } as Prisma.InputJsonValue, analyzedAt: new Date() },
    });
    await createDrafts({ creatorId: creator.id, contentId: content.id, draftType: "starter", options: starter_comments, modelVersion });
    return `Analisis selesai — ${starter_comments.length} draf komentar pemantik dibuat.`;
  });
}

export async function recordSnapshot(formData: FormData) {
  await run(formData, async (creator) => {
    const content = await ownedContent(creator.id, str(formData, "contentId"));
    const n = (key: string) => (str(formData, key) === "" ? null : z.coerce.number().int().min(0).parse(formData.get(key)));
    const capturedAtRaw = str(formData, "capturedAt");
    await prisma.engagementSnapshot.create({
      data: {
        contentId: content.id,
        views: n("views"),
        likes: n("likes"),
        commentsCount: n("commentsCount"),
        capturedAt: capturedAtRaw ? new Date(capturedAtRaw) : new Date(),
        source: "manual",
      },
    });
    await audit({ action: "snapshot.recorded_manual", actor: actorFor(creator.id), targetType: "content", targetId: content.id });
    return "Snapshot metrik dicatat.";
  });
}

// --- Comments ----------------------------------------------------------------

export async function addManualComment(formData: FormData) {
  await run(formData, async (creator) => {
    const content = await ownedContent(creator.id, str(formData, "contentId"));
    const text = z.string().min(1, "Isi teks komentar.").max(INPUT_LIMITS.comment).parse(str(formData, "text"));
    const authorType = z.enum(["audience", "team", "creator"]).parse(formData.get("authorType") ?? "audience");
    await prisma.comment.create({
      data: {
        contentId: content.id,
        text,
        authorType,
        authorDisplayName: optional(formData, "authorDisplayName"),
        category: authorType === "audience" ? classifyComment(text) : "other",
        source: "manual",
      },
    });
    await audit({ action: "comment.added_manual", actor: actorFor(creator.id), targetType: "content", targetId: content.id, metadata: { authorType } });
    return "Komentar dicatat.";
  });
}

export async function suggestReplies(formData: FormData) {
  await run(formData, async (creator) => {
    const comment = await prisma.comment.findUnique({ where: { id: str(formData, "commentId") }, include: { content: { include: { account: true } } } });
    if (!comment || comment.content.account.creatorId !== creator.id) throw new ActionError("Komentar tidak ditemukan.");
    if (comment.authorType !== "audience") throw new ActionError("Saran balasan hanya untuk komentar penonton.");
    const analysis = comment.content.analysis as { summary?: string } | null;
    const contentSummary = analysis?.summary ?? [comment.content.title, comment.content.caption, comment.content.creatorNotes].filter(Boolean).join("\n");
    // Only the comment text is sent — no author names or identifiers.
    const { output, modelVersion } = await generateReplies({ platform: comment.content.account.platform, contentSummary: contentSummary || "(tidak ada ringkasan)", comment: comment.text });
    await prisma.comment.update({ where: { id: comment.id }, data: { category: output.intent } });
    await createDrafts({ creatorId: creator.id, contentId: comment.contentId, sourceCommentId: comment.id, draftType: "reply", options: output.replies, modelVersion });
    return `${output.replies.length} saran balasan dibuat. Tinjau di bawah komentar atau di halaman Persetujuan.`;
  });
}

export async function setCommentCategory(formData: FormData) {
  await run(formData, async (creator) => {
    const comment = await prisma.comment.findUnique({ where: { id: str(formData, "commentId") }, include: { content: { include: { account: true } } } });
    if (!comment || comment.content.account.creatorId !== creator.id) throw new ActionError("Komentar tidak ditemukan.");
    const category = z.enum(["question", "feedback", "positive", "needs_review", "other"]).parse(formData.get("category"));
    await prisma.comment.update({ where: { id: comment.id }, data: { category } });
    return "Kategori diperbarui.";
  });
}

// --- Drafts & publishing -------------------------------------------------------

export async function editDraftAction(formData: FormData) {
  await run(formData, async (creator) => {
    await editDraft(str(formData, "draftId"), creator.id, z.string().min(1, "Teks tidak boleh kosong.").parse(str(formData, "text")));
    return "Draf diperbarui dan diperiksa ulang.";
  });
}

export async function submitDraftAction(formData: FormData) {
  await run(formData, async (creator) => {
    await submitDraft(str(formData, "draftId"), creator.id);
    return "Draf dikirim ke antrean persetujuan.";
  });
}

export async function approveDraftAction(formData: FormData) {
  await run(formData, async (creator) => {
    const outcome = await approveDraft(str(formData, "draftId"), creator.id, str(formData, "confirmAccountId"));
    return outcome === "queued"
      ? "Disetujui dan masuk antrean publikasi."
      : "Disetujui. Publikasi otomatis tidak tersedia — salin teks dan posting manual.";
  });
}

export async function rejectDraftAction(formData: FormData) {
  await run(formData, async (creator) => {
    await rejectDraft(str(formData, "draftId"), creator.id, optional(formData, "reason") ?? undefined);
    return "Draf ditolak.";
  });
}

export async function cancelDraftAction(formData: FormData) {
  await run(formData, async (creator) => {
    await cancelDraft(str(formData, "draftId"), creator.id);
    return "Draf dibatalkan.";
  });
}

export async function reopenDraftAction(formData: FormData) {
  await run(formData, async (creator) => {
    await reopenDraft(str(formData, "draftId"), creator.id);
    return "Draf dibuka kembali.";
  });
}

export async function markPostedManuallyAction(formData: FormData) {
  await run(formData, async (creator) => {
    await markPostedManually(str(formData, "draftId"), creator.id);
    return "Ditandai sudah diposting manual.";
  });
}

export async function retryDraftAction(formData: FormData) {
  await run(formData, async (creator) => {
    await retryDraft(str(formData, "draftId"), creator.id, formData.get("confirmNotPosted") === "yes");
    return "Job dijadwalkan ulang.";
  });
}

export async function runPublishingNow(formData: FormData) {
  await run(formData, async (creator) => {
    const summary = await processDueJobs();
    await audit({ action: "worker.run_manual", actor: actorFor(creator.id), targetType: "publish_job", metadata: { ...summary } });
    return `Worker: ${summary.published} terpublikasi, ${summary.retried} dijadwalkan ulang, ${summary.manual} perlu manual, ${summary.failed} gagal.`;
  });
}
