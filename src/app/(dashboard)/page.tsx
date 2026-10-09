import Link from "next/link";
import { Suspense } from "react";
import { Card, ConnectionBadge, DraftStatusBadge, EmptyState, Flash, formatDate, LinkButton, PageHeader, PlatformTag, Skeleton, Stat } from "@/components/ui";
import { requireCreator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { readFlash } from "@/lib/queries/flash";

async function Overview({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const creator = await requireCreator();
  const flash = await readFlash(searchParams);
  const scope = { content: { account: { creatorId: creator.id } } };
  const [accounts, pendingApproval, manualRequired, failed, unanswered, recentDrafts, contentCount] = await Promise.all([
    prisma.platformAccount.findMany({ where: { creatorId: creator.id }, orderBy: { platform: "asc" } }),
    prisma.aiDraft.count({ where: { ...scope, status: "pending_approval" } }),
    prisma.aiDraft.count({ where: { ...scope, status: "manual_action_required" } }),
    prisma.aiDraft.count({ where: { ...scope, status: "failed" } }),
    prisma.comment.count({ where: { ...scope, authorType: "audience", category: "question", parentId: null, replies: { none: { authorType: { in: ["creator", "team"] } } } } }),
    prisma.aiDraft.findMany({ where: scope, orderBy: { updatedAt: "desc" }, take: 6, include: { content: { include: { account: true } } } }),
    prisma.content.count({ where: { account: { creatorId: creator.id } } }),
  ]);

  return (
    <>
      <Flash {...flash} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Menunggu persetujuan" value={pendingApproval} />
        <Stat label="Perlu posting manual" value={manualRequired} />
        <Stat label="Pertanyaan belum dijawab" value={unanswered} hint="Komentar penonton tanpa balasan kreator/tim" />
        <Stat label="Publikasi gagal" value={failed} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Koneksi akun" actions={<LinkButton href="/accounts" size="sm">Kelola</LinkButton>}>
          {accounts.length === 0 ? (
            <EmptyState title="Belum ada akun">Hubungkan YouTube atau tambahkan akun manual.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {accounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">@{a.handle}</p>
                    <PlatformTag platform={a.platform} />
                  </div>
                  <ConnectionBadge status={a.connectionStatus} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Aktivitas draf terbaru" actions={<LinkButton href="/approvals" size="sm">Antrean</LinkButton>}>
          {recentDrafts.length === 0 ? (
            <EmptyState title="Belum ada draf">
              {contentCount === 0 ? "Tambahkan konten dulu, lalu jalankan analisis AI." : "Buka konten dan jalankan analisis AI."}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {recentDrafts.map((d) => (
                <li key={d.id} className="py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <Link href={`/content/${d.contentId}`} className="truncate text-sm font-medium hover:underline">
                      {d.content.title ?? d.content.url}
                    </Link>
                    <DraftStatusBadge status={d.status} />
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-sm text-muted">{d.text}</p>
                  <p className="mt-0.5 text-xs text-muted">{formatDate(d.updatedAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

export default function HomePage(props: PageProps<"/">) {
  return (
    <>
      <PageHeader
        title="Ringkasan"
        description="Mulai percakapan nyata dengan audiens. Setiap komentar diposting dari akun resmi Anda dan hanya setelah Anda menyetujuinya."
        actions={<LinkButton href="/content" variant="primary">Tambah konten</LinkButton>}
      />
      <Suspense fallback={<Skeleton rows={4} />}>
        <Overview searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
