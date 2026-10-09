import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { addContentFromUrl } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card, EmptyState, Field, Flash, formatDate, inputClass, PageHeader, PlatformTag, Skeleton } from "@/components/ui";
import { requireCreator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { readFlash } from "@/lib/queries/flash";

export const metadata: Metadata = { title: "Konten" };

async function ContentList({ searchParams }: { searchParams: PageProps<"/content">["searchParams"] }) {
  const creator = await requireCreator();
  const flash = await readFlash(searchParams);
  const [accounts, content] = await Promise.all([
    prisma.platformAccount.findMany({ where: { creatorId: creator.id, accountType: "official" }, orderBy: { platform: "asc" } }),
    prisma.content.findMany({
      where: { account: { creatorId: creator.id } },
      orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      include: {
        account: true,
        _count: { select: { comments: { where: { authorType: "audience" } }, drafts: true } },
      },
    }),
  ]);

  return (
    <>
      <Flash {...flash} />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card title={`Semua konten (${content.length})`}>
          {content.length === 0 ? (
            <EmptyState title="Belum ada konten">Konten YouTube yang terhubung tersinkron otomatis. Untuk platform lain, tambahkan URL di samping.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {content.map((c) => (
                <li key={c.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/content/${c.id}`} className="min-w-0 truncate font-medium hover:underline">
                      {c.title ?? c.url}
                    </Link>
                    <div className="flex gap-1.5">
                      {c.experimentGroup && <Badge tone="info">{c.experimentGroup === "seeded" ? "Pilot: pemantik" : "Pilot: pembanding"}</Badge>}
                      {c.analyzedAt ? <Badge tone="success">Dianalisis</Badge> : <Badge>Belum dianalisis</Badge>}
                      <Badge>{c.source === "api" ? "API" : c.source === "mock" ? "Mock" : "Manual"}</Badge>
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
                    <PlatformTag platform={c.account.platform} />
                    <span>@{c.account.handle}</span>
                    <span>{formatDate(c.publishedAt ?? c.createdAt)}</span>
                    <span>{c._count.comments} komentar penonton</span>
                    <span>{c._count.drafts} draf</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Tambah konten via URL" description="Fallback manual untuk platform yang belum terhubung.">
          {accounts.length === 0 ? (
            <EmptyState title="Tambahkan akun dulu">
              <Link className="underline" href="/accounts">Ke halaman Akun</Link>
            </EmptyState>
          ) : (
            <form action={addContentFromUrl} className="space-y-3">
              <Field label="URL video">
                <input name="url" type="url" required className={inputClass} placeholder="https://www.tiktok.com/@akun/video/…" />
              </Field>
              <Field label="Akun" hint="Kosongkan untuk memilih otomatis sesuai platform URL.">
                <select name="accountId" className={inputClass} defaultValue="">
                  <option value="">Otomatis</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.platform} — @{a.handle}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Judul (opsional)">
                <input name="title" maxLength={300} className={inputClass} />
              </Field>
              <Field label="Caption">
                <textarea name="caption" rows={3} maxLength={5000} className={inputClass} />
              </Field>
              <Field label="Ringkasan isi video" hint="Ditulis kreator; dipakai AI sebagai konteks.">
                <textarea name="creatorNotes" rows={3} maxLength={5000} className={inputClass} />
              </Field>
              <SubmitButton>Tambah konten</SubmitButton>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}

export default function ContentPage(props: PageProps<"/content">) {
  return (
    <>
      <PageHeader title="Konten" description="Video dari integrasi yang tersedia, plus konten yang dicatat manual." />
      <Suspense fallback={<Skeleton rows={4} />}>
        <ContentList searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
