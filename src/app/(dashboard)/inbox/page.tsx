import type { CommentCategory, Platform, Prisma } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { setCommentCategory, suggestReplies } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card, EmptyState, Flash, formatDate, inputClass, PageHeader, PlatformTag, Skeleton, buttonClass } from "@/components/ui";
import { requireCreator } from "@/lib/auth/session";
import { CATEGORY_LABELS } from "@/lib/comments/classify";
import { PLATFORM_LABELS } from "@/lib/content-url";
import { prisma } from "@/lib/db";
import { adapterFor } from "@/lib/platforms/registry";
import { readFlash } from "@/lib/queries/flash";

export const metadata: Metadata = { title: "Inbox komentar" };

const PLATFORMS: Platform[] = ["youtube", "instagram", "tiktok"];
const CATEGORIES = Object.keys(CATEGORY_LABELS) as CommentCategory[];

async function Inbox({ searchParams }: { searchParams: PageProps<"/inbox">["searchParams"] }) {
  const creator = await requireCreator();
  const sp = await searchParams;
  const flash = await readFlash(searchParams);
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  const platform = PLATFORMS.includes(one(sp.platform) as Platform) ? (one(sp.platform) as Platform) : undefined;
  const category = CATEGORIES.includes(one(sp.category) as CommentCategory) ? (one(sp.category) as CommentCategory) : undefined;
  const status = one(sp.status) === "all" ? "all" : "unanswered";
  const q = one(sp.q).slice(0, 100);

  const where: Prisma.CommentWhereInput = {
    authorType: "audience",
    parentId: null,
    content: { account: { creatorId: creator.id, ...(platform ? { platform } : {}) } },
    ...(category ? { category } : {}),
    ...(q ? { text: { contains: q, mode: "insensitive" } } : {}),
    ...(status === "unanswered" ? { replies: { none: { authorType: { in: ["creator", "team"] } } } } : {}),
  };
  const [comments, accounts] = await Promise.all([
    prisma.comment.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      take: 200,
      include: {
        content: { include: { account: true } },
        replies: { where: { authorType: { in: ["creator", "team"] } }, select: { id: true } },
        drafts: { where: { status: { notIn: ["cancelled", "rejected"] } }, select: { id: true, status: true } },
      },
    }),
    prisma.platformAccount.findMany({ where: { creatorId: creator.id, accountType: "official" } }),
  ]);
  // Unanswered questions first (blueprint 5.3), then newest.
  const priority = (c: (typeof comments)[number]) => (c.category === "question" && c.replies.length === 0 ? 0 : c.category === "needs_review" ? 1 : 2);
  comments.sort((a, b) => priority(a) - priority(b) || b.publishedAt.getTime() - a.publishedAt.getTime());

  const integrations = await Promise.all(
    accounts.map(async (a) => ({ account: a, canRead: (await adapterFor(a)).capabilities.listComments })),
  );
  const unreadable = integrations.filter((i) => !i.canRead);
  const filterHref = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { platform, category, status, q, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    return `/inbox?${params}`;
  };
  const returnTo = filterHref({});

  return (
    <>
      <Flash {...flash} />
      {unreadable.length > 0 && (
        <div className="mb-5 rounded-lg border border-info/30 bg-info-soft px-4 py-3 text-sm text-info">
          Pembacaan komentar otomatis belum tersedia untuk {unreadable.map((i) => `${PLATFORM_LABELS[i.account.platform]} (@${i.account.handle})`).join(", ")}. Catat
          komentar penting secara manual dari halaman konten.
        </div>
      )}

      <form className="mb-5 flex flex-wrap items-end gap-2" action="/inbox">
        <input name="q" defaultValue={q} placeholder="Cari komentar…" className={`${inputClass} w-56`} />
        <select name="platform" defaultValue={platform ?? ""} className={`${inputClass} w-44`}>
          <option value="">Semua platform</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABELS[p]}
            </option>
          ))}
        </select>
        <select name="category" defaultValue={category ?? ""} className={`${inputClass} w-40`}>
          <option value="">Semua kategori</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={status} className={`${inputClass} w-40`}>
          <option value="unanswered">Belum dibalas</option>
          <option value="all">Semua</option>
        </select>
        <button type="submit" className={buttonClass("secondary")}>
          Terapkan
        </button>
      </form>

      <Card title={`${comments.length} komentar penonton`}>
        {comments.length === 0 ? (
          <EmptyState title="Tidak ada komentar yang cocok">{status === "unanswered" ? "Semua komentar sudah dibalas 🎉" : null}</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {comments.map((c) => (
              <li key={c.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <PlatformTag platform={c.content.account.platform} />
                  <span className="font-medium">{c.authorDisplayName ?? "Penonton"}</span>
                  <Badge tone={c.category === "needs_review" ? "danger" : c.category === "question" ? "warning" : "neutral"}>{CATEGORY_LABELS[c.category]}</Badge>
                  {c.replies.length > 0 ? <Badge tone="success">Sudah dibalas</Badge> : <Badge tone="neutral">Belum dibalas</Badge>}
                  {c.drafts.length > 0 && <Badge tone="info">{c.drafts.length} draf balasan</Badge>}
                  <span className="text-muted">{formatDate(c.publishedAt)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{c.text}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Link href={`/content/${c.contentId}`} className="text-xs text-muted hover:underline">
                    {c.content.title ?? c.content.url}
                  </Link>
                  <form action={suggestReplies}>
                    <input type="hidden" name="commentId" value={c.id} />
                    <input type="hidden" name="returnTo" value={`/content/${c.contentId}`} />
                    <SubmitButton variant="ghost" size="sm" pendingText="Membuat saran…">✨ Sarankan balasan</SubmitButton>
                  </form>
                  <form action={setCommentCategory} className="flex items-center gap-1">
                    <input type="hidden" name="commentId" value={c.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <select name="category" defaultValue={c.category} className={`${inputClass} h-8 w-36 py-1 text-xs`} aria-label="Kategori">
                      {CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {CATEGORY_LABELS[cat]}
                        </option>
                      ))}
                    </select>
                    <SubmitButton variant="ghost" size="sm">Ubah</SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

export default function InboxPage(props: PageProps<"/inbox">) {
  return (
    <>
      <PageHeader title="Inbox komentar" description="Komentar penonton dari semua platform. Pertanyaan yang belum dijawab tampil paling atas." />
      <Suspense fallback={<Skeleton rows={6} />}>
        <Inbox searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
