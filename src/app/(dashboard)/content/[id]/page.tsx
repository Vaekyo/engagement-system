import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { addManualComment, analyzeContent, recordSnapshot, suggestReplies, updateContentContext } from "@/app/actions";
import { DraftCard } from "@/components/draft-card";
import { SubmitButton } from "@/components/submit-button";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Flash,
  formatDate,
  formatNumber,
  formatPercent,
  inputClass,
  LinkButton,
  PageHeader,
  PlatformTag,
  Skeleton,
  Stat,
} from "@/components/ui";
import { requireCreator } from "@/lib/auth/session";
import { CATEGORY_LABELS } from "@/lib/comments/classify";
import { prisma } from "@/lib/db";
import { computeMetrics, latestSnapshot } from "@/lib/analytics/metrics";
import { INPUT_LIMITS, type ContentAnalysis } from "@/lib/ai/schema";
import { isAiConfigured } from "@/lib/ai/generate";
import { readFlash } from "@/lib/queries/flash";

export const metadata: Metadata = { title: "Detail konten" };

const AUTHOR_LABEL = { creator: "Kreator", team: "Tim", audience: "Penonton" } as const;

async function ContentDetail({ params, searchParams }: PageProps<"/content/[id]">) {
  const creator = await requireCreator();
  const { id } = await params;
  const flash = await readFlash(searchParams);
  const content = await prisma.content.findUnique({
    where: { id },
    include: {
      account: true,
      comments: { orderBy: { publishedAt: "asc" } },
      drafts: { orderBy: { createdAt: "desc" }, include: { sourceComment: true, publishJob: true } },
      snapshots: { orderBy: { capturedAt: "desc" } },
    },
  });
  if (!content || content.account.creatorId !== creator.id) notFound();

  const returnTo = `/content/${content.id}`;
  const analysis = content.analysis as (Omit<ContentAnalysis, "starter_comments"> & { modelVersion?: string }) | null;
  const withRelations = <T extends (typeof content.drafts)[number]>(d: T) => ({ ...d, content });
  const starterDrafts = content.drafts.filter((d) => d.draftType === "starter").map(withRelations);
  const replyDraftsByComment = new Map<string, ReturnType<typeof withRelations>[]>();
  for (const d of content.drafts.filter((d) => d.draftType === "reply" && d.sourceCommentId)) {
    const list = replyDraftsByComment.get(d.sourceCommentId!) ?? [];
    list.push(withRelations(d));
    replyDraftsByComment.set(d.sourceCommentId!, list);
  }
  const topLevel = content.comments.filter((c) => !c.parentId);
  const repliesByParent = new Map<string, typeof content.comments>();
  for (const c of content.comments.filter((c) => c.parentId)) {
    repliesByParent.set(c.parentId!, [...(repliesByParent.get(c.parentId!) ?? []), c]);
  }
  const latest = latestSnapshot(content.snapshots);
  const metrics = computeMetrics(content.comments, latest?.views ?? null);

  return (
    <>
      <PageHeader
        title={content.title ?? "Konten tanpa judul"}
        description={
          <span className="flex flex-wrap items-center gap-3">
            <PlatformTag platform={content.account.platform} />
            <span>@{content.account.handle}</span>
            <span>{formatDate(content.publishedAt ?? content.createdAt)}</span>
          </span>
        }
        actions={<LinkButton href={content.url} external size="sm">Buka di platform ↗</LinkButton>}
      />
      <Flash {...flash} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Views" value={formatNumber(latest?.views)} hint={latest ? `per ${formatDate(latest.capturedAt)}` : "Belum ada snapshot"} />
        <Stat label="Komentar organik / 1.000 views" value={formatNumber(metrics.organicPer1000Views, 1)} hint={`${metrics.audienceComments} komentar penonton`} />
        <Stat label="Pertanyaan dibalas" value={formatPercent(metrics.replyRate)} hint={`${metrics.audienceTopLevelAnswered}/${metrics.audienceTopLevel} komentar utama`} />
        <Stat label="Komentar kreator / tim" value={`${metrics.creatorComments} / ${metrics.teamComments}`} hint="Tidak dihitung sebagai organik" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Card
            title="Analisis AI"
            description={analysis ? `Dianalisis ${formatDate(content.analyzedAt)} · model ${analysis.modelVersion ?? "?"}` : "Belum dianalisis."}
            actions={
              <form action={analyzeContent}>
                <input type="hidden" name="contentId" value={content.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <SubmitButton size="sm" pendingText="Menganalisis…">{analysis ? "Analisis ulang" : "Analisis & buat draf"}</SubmitButton>
              </form>
            }
          >
            {!isAiConfigured() && (
              <p className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">ANTHROPIC_API_KEY belum diatur — analisis memakai generator mock.</p>
            )}
            {analysis ? (
              <div className="space-y-3 text-sm">
                <p>{analysis.summary}</p>
                {[
                  ["Tema", analysis.themes],
                  ["Hook", analysis.hooks],
                  ["Momen diskusi", analysis.discussion_moments],
                ].map(([label, items]) =>
                  (items as string[]).length ? (
                    <div key={label as string}>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label as string}</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5">
                        {(items as string[]).map((t, i) => (
                          <li key={i}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null,
                )}
                {analysis.risks.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-warning">Label risiko</p>
                    <ul className="mt-1 space-y-0.5">
                      {analysis.risks.map((r, i) => (
                        <li key={i} className="text-warning">
                          ⚠️ <strong>{r.label}</strong>: {r.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">Lengkapi konteks di samping, lalu jalankan analisis untuk mendapat ringkasan dan minimal tiga draf komentar pemantik.</p>
            )}
          </Card>

          <Card title={`Draf komentar pemantik (${starterDrafts.length})`} description="Diposting dari akun resmi Anda setelah disetujui.">
            {starterDrafts.length === 0 ? (
              <EmptyState title="Belum ada draf" />
            ) : (
              <div className="space-y-3">
                {starterDrafts.map((d) => (
                  <DraftCard key={d.id} draft={d} returnTo={returnTo} />
                ))}
              </div>
            )}
          </Card>

          <Card title={`Komentar (${content.comments.length})`} description={content.source === "api" ? "Tersinkron dari platform." : "Dicatat manual."}>
            {topLevel.length === 0 ? (
              <EmptyState title="Belum ada komentar" />
            ) : (
              <ul className="space-y-4">
                {topLevel.map((c) => (
                  <li key={c.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-medium">{c.authorDisplayName ?? AUTHOR_LABEL[c.authorType]}</span>
                      <Badge tone={c.authorType === "audience" ? "neutral" : "accent"}>{AUTHOR_LABEL[c.authorType]}</Badge>
                      {c.authorType === "audience" && <Badge tone={c.category === "needs_review" ? "danger" : c.category === "question" ? "warning" : "neutral"}>{CATEGORY_LABELS[c.category]}</Badge>}
                      <span className="text-muted">{formatDate(c.publishedAt)}</span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm">{c.text}</p>
                    {(repliesByParent.get(c.id) ?? []).map((r) => (
                      <div key={r.id} className="mt-2 border-l-2 border-border pl-3 text-sm">
                        <span className="text-xs font-medium">{r.authorDisplayName ?? AUTHOR_LABEL[r.authorType]}</span>{" "}
                        <Badge tone={r.authorType === "audience" ? "neutral" : "accent"}>{AUTHOR_LABEL[r.authorType]}</Badge>
                        <p className="mt-0.5 whitespace-pre-wrap">{r.text}</p>
                      </div>
                    ))}
                    {c.authorType === "audience" && (
                      <form action={suggestReplies} className="mt-2">
                        <input type="hidden" name="commentId" value={c.id} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <SubmitButton variant="ghost" size="sm" pendingText="Membuat saran…">✨ Sarankan balasan</SubmitButton>
                      </form>
                    )}
                    {(replyDraftsByComment.get(c.id) ?? []).length > 0 && (
                      <div className="mt-2 space-y-2">
                        {replyDraftsByComment.get(c.id)!.map((d) => (
                          <DraftCard key={d.id} draft={d} returnTo={returnTo} />
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <form action={addManualComment} className="mt-5 space-y-3 border-t border-border pt-4">
              <input type="hidden" name="contentId" value={content.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <p className="text-sm font-medium">Catat komentar manual</p>
              <p className="text-xs text-muted">Untuk platform yang API komentarnya belum tersedia. Hanya catat komentar publik pada konten Anda.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nama tampilan (opsional)">
                  <input name="authorDisplayName" maxLength={100} className={inputClass} />
                </Field>
                <Field label="Penulis">
                  <select name="authorType" className={inputClass} defaultValue="audience">
                    <option value="audience">Penonton</option>
                    <option value="team">Tim/afiliasi</option>
                    <option value="creator">Kreator</option>
                  </select>
                </Field>
              </div>
              <Field label="Teks komentar">
                <textarea name="text" required rows={2} maxLength={INPUT_LIMITS.comment} className={inputClass} />
              </Field>
              <SubmitButton variant="secondary" size="sm">Catat komentar</SubmitButton>
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Konteks konten" description="Hanya materi ini yang dikirim ke AI.">
            <form action={updateContentContext} className="space-y-3">
              <input type="hidden" name="contentId" value={content.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <Field label="Judul">
                <input name="title" defaultValue={content.title ?? ""} maxLength={300} className={inputClass} />
              </Field>
              <Field label="Caption">
                <textarea name="caption" defaultValue={content.caption ?? ""} rows={3} maxLength={INPUT_LIMITS.caption} className={inputClass} />
              </Field>
              <Field label="Ringkasan dari kreator">
                <textarea name="creatorNotes" defaultValue={content.creatorNotes ?? ""} rows={4} maxLength={INPUT_LIMITS.creatorNotes} className={inputClass} />
              </Field>
              <Field label="Transkrip" hint={`Maks ${formatNumber(INPUT_LIMITS.transcript)} karakter. Gunakan transkrip yang Anda miliki atau peroleh dengan cara yang diizinkan.`}>
                <textarea name="transcript" defaultValue={content.transcript ?? ""} rows={5} maxLength={INPUT_LIMITS.transcript} className={inputClass} />
              </Field>
              <Field label="Grup pilot" hint="Untuk evaluasi pilot (bagian 13 blueprint).">
                <select name="experimentGroup" defaultValue={content.experimentGroup ?? ""} className={inputClass}>
                  <option value="">Tidak ikut pilot</option>
                  <option value="seeded">Dengan komentar pemantik</option>
                  <option value="control">Pembanding</option>
                </select>
              </Field>
              <SubmitButton variant="secondary">Simpan konteks</SubmitButton>
            </form>
          </Card>

          <Card title="Snapshot metrik" description="Tercatat otomatis bila API mendukung; bisa diisi manual.">
            {content.snapshots.length > 0 && (
              <table className="mb-4 w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="py-1 font-medium">Waktu</th>
                    <th className="py-1 text-right font-medium">Views</th>
                    <th className="py-1 text-right font-medium">Likes</th>
                    <th className="py-1 text-right font-medium">Komentar</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {content.snapshots.slice(0, 8).map((s) => (
                    <tr key={s.id} className="border-t border-border">
                      <td className="py-1.5 text-xs">{formatDate(s.capturedAt)}</td>
                      <td className="py-1.5 text-right">{formatNumber(s.views)}</td>
                      <td className="py-1.5 text-right">{formatNumber(s.likes)}</td>
                      <td className="py-1.5 text-right">{formatNumber(s.commentsCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <form action={recordSnapshot} className="space-y-3">
              <input type="hidden" name="contentId" value={content.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <div className="grid grid-cols-3 gap-2">
                <Field label="Views">
                  <input name="views" type="number" min={0} className={inputClass} />
                </Field>
                <Field label="Likes">
                  <input name="likes" type="number" min={0} className={inputClass} />
                </Field>
                <Field label="Komentar">
                  <input name="commentsCount" type="number" min={0} className={inputClass} />
                </Field>
              </div>
              <Field label="Waktu pencatatan" hint="Kosongkan untuk sekarang.">
                <input name="capturedAt" type="datetime-local" className={inputClass} />
              </Field>
              <SubmitButton variant="secondary" size="sm">Catat snapshot</SubmitButton>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}

export default function ContentDetailPage(props: PageProps<"/content/[id]">) {
  return (
    <Suspense fallback={<Skeleton rows={5} />}>
      <ContentDetail {...props} />
    </Suspense>
  );
}
