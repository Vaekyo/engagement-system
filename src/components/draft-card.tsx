import type { AiDraft, Comment, Content, PlatformAccount, PublishJob } from "@prisma/client";
import Link from "next/link";
import {
  approveDraftAction,
  cancelDraftAction,
  editDraftAction,
  markPostedManuallyAction,
  rejectDraftAction,
  reopenDraftAction,
  retryDraftAction,
  submitDraftAction,
} from "@/app/actions";
import { CopyButton } from "./copy-button";
import { SubmitButton } from "./submit-button";
import { Badge, DraftStatusBadge, formatDate, inputClass, JobStateBadge, LinkButton, PlatformTag } from "./ui";
import { hasBlockingFlag, parseFlags } from "@/lib/ai/guardrails";
import { EDITABLE_STATUSES } from "@/lib/drafts/state-machine";
import { COMMENT_MAX_LENGTH } from "@/lib/platforms/types";

export type DraftWithRelations = AiDraft & {
  content: Content & { account: PlatformAccount };
  sourceComment: Comment | null;
  publishJob: PublishJob | null;
};

function Hidden({ draftId, returnTo }: { draftId: string; returnTo: string }) {
  return (
    <>
      <input type="hidden" name="draftId" value={draftId} />
      <input type="hidden" name="returnTo" value={returnTo} />
    </>
  );
}

export function DraftCard({ draft, returnTo, showContent = false }: { draft: DraftWithRelations; returnTo: string; showContent?: boolean }) {
  const flags = parseFlags(draft.riskFlags);
  const blocked = hasBlockingFlag(flags);
  const account = draft.content.account;
  const editable = EDITABLE_STATUSES.includes(draft.status);
  const job = draft.publishJob;
  const limit = COMMENT_MAX_LENGTH[account.platform];

  return (
    <article className="rounded-lg border border-border bg-surface p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <DraftStatusBadge status={draft.status} />
          <Badge tone="neutral">{draft.draftType === "starter" ? "Komentar pemantik" : "Balasan"}</Badge>
          {draft.modelVersion === "mock" && <Badge tone="warning">AI mock</Badge>}
          {job && <JobStateBadge state={job.state} />}
        </div>
        <span className="text-xs text-muted">{formatDate(draft.updatedAt)}</span>
      </header>

      {showContent && (
        <p className="mt-2 text-sm">
          <Link href={`/content/${draft.contentId}`} className="font-medium hover:underline">
            {draft.content.title ?? draft.content.url}
          </Link>{" "}
          <PlatformTag platform={account.platform} />
        </p>
      )}

      {draft.sourceComment && (
        <blockquote className="mt-3 border-l-2 border-border pl-3 text-sm text-muted">
          <span className="font-medium text-foreground">{draft.sourceComment.authorDisplayName ?? "Penonton"}:</span> {draft.sourceComment.text}
        </blockquote>
      )}

      {editable ? (
        <form action={editDraftAction} className="mt-3 space-y-2">
          <Hidden draftId={draft.id} returnTo={returnTo} />
          <textarea name="text" defaultValue={draft.text} rows={3} maxLength={limit} className={inputClass} aria-label="Teks draf" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">
              {draft.text.length}/{limit} karakter
            </span>
            <SubmitButton variant="ghost" size="sm" pendingText="Menyimpan…">Simpan edit</SubmitButton>
          </div>
        </form>
      ) : (
        <p className="mt-3 whitespace-pre-wrap text-sm">{draft.text}</p>
      )}

      {draft.rationale && <p className="mt-2 text-xs text-muted">Alasan: {draft.rationale}</p>}

      {flags.length > 0 && (
        <ul className="mt-3 space-y-1">
          {flags.map((f, i) => (
            <li key={i} className={f.severity === "block" ? "text-sm text-danger" : "text-sm text-warning"}>
              {f.severity === "block" ? "⛔" : "⚠️"} {f.message}
            </li>
          ))}
        </ul>
      )}

      {draft.rejectedReason && <p className="mt-2 text-sm text-danger">Ditolak: {draft.rejectedReason}</p>}
      {job?.errorMessage && draft.status !== "published" && <p className="mt-2 text-sm text-danger">Error: {job.errorMessage}</p>}
      {job?.externalCommentId && (
        <p className="mt-2 font-mono text-xs text-muted">
          ID komentar: {job.externalCommentId}
          {job.externalCommentId.startsWith("mock_") && " (mock — tidak diposting ke platform)"}
        </p>
      )}

      <footer className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {draft.status === "draft" && (
          <form action={submitDraftAction}>
            <Hidden draftId={draft.id} returnTo={returnTo} />
            <SubmitButton size="sm" disabled={blocked}>Ajukan persetujuan</SubmitButton>
          </form>
        )}

        {draft.status === "pending_approval" && (
          <form action={approveDraftAction} className="flex flex-wrap items-center gap-2">
            <Hidden draftId={draft.id} returnTo={returnTo} />
            <label className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-1.5 text-xs">
              <input type="checkbox" name="confirmAccountId" value={account.id} required />
              <span>
                Posting sebagai <strong>@{account.handle}</strong> ({account.accountType === "official" ? "akun resmi" : "akun tim"}, {account.platform})
              </span>
            </label>
            <SubmitButton size="sm" disabled={blocked} pendingText="Menyetujui…">Setujui</SubmitButton>
          </form>
        )}

        {(draft.status === "draft" || draft.status === "pending_approval") && (
          <form action={rejectDraftAction} className="flex items-center gap-2">
            <Hidden draftId={draft.id} returnTo={returnTo} />
            <input name="reason" placeholder="Alasan (opsional)" className={`${inputClass} h-8 w-40 py-1 text-xs`} />
            <SubmitButton variant="danger" size="sm">Tolak</SubmitButton>
          </form>
        )}

        {draft.status === "manual_action_required" && (
          <>
            <CopyButton text={draft.text} />
            <LinkButton href={draft.content.url} external size="sm">Buka konten ↗</LinkButton>
            <form action={markPostedManuallyAction}>
              <Hidden draftId={draft.id} returnTo={returnTo} />
              <SubmitButton size="sm">Sudah saya posting</SubmitButton>
            </form>
          </>
        )}

        {draft.status === "failed" && (
          <form action={retryDraftAction} className="flex flex-wrap items-center gap-2">
            <Hidden draftId={draft.id} returnTo={returnTo} />
            {job?.errorCode === "unknown_outcome" && (
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" name="confirmNotPosted" value="yes" required /> Saya sudah cek: komentar belum muncul di platform
              </label>
            )}
            <SubmitButton size="sm">Coba lagi</SubmitButton>
          </form>
        )}

        {draft.status === "rejected" && (
          <form action={reopenDraftAction}>
            <Hidden draftId={draft.id} returnTo={returnTo} />
            <SubmitButton variant="secondary" size="sm">Buka kembali</SubmitButton>
          </form>
        )}

        {["draft", "pending_approval", "approved", "queued", "failed", "manual_action_required"].includes(draft.status) && (
          <form action={cancelDraftAction} className="ml-auto">
            <Hidden draftId={draft.id} returnTo={returnTo} />
            <SubmitButton variant="ghost" size="sm">Batalkan</SubmitButton>
          </form>
        )}
      </footer>
    </article>
  );
}
