import type { DraftStatus } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { runPublishingNow } from "@/app/actions";
import { DraftCard } from "@/components/draft-card";
import { SubmitButton } from "@/components/submit-button";
import { cx, EmptyState, Flash, PageHeader, Skeleton } from "@/components/ui";
import { requireCreator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { STATUS_LABELS } from "@/lib/drafts/state-machine";
import { readFlash } from "@/lib/queries/flash";

export const metadata: Metadata = { title: "Persetujuan" };

const TABS: { key: string; label: string; statuses: DraftStatus[] }[] = [
  { key: "pending", label: "Menunggu persetujuan", statuses: ["pending_approval"] },
  { key: "drafts", label: "Draf", statuses: ["draft"] },
  { key: "manual", label: "Perlu posting manual", statuses: ["manual_action_required"] },
  { key: "queue", label: "Antrean & gagal", statuses: ["approved", "queued", "failed"] },
  { key: "done", label: "Selesai", statuses: ["published", "rejected", "cancelled"] },
];

async function Approvals({ searchParams }: { searchParams: PageProps<"/approvals">["searchParams"] }) {
  const creator = await requireCreator();
  const sp = await searchParams;
  const flash = await readFlash(searchParams);
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const scope = { content: { account: { creatorId: creator.id } } };

  const [counts, drafts] = await Promise.all([
    prisma.aiDraft.groupBy({ by: ["status"], where: scope, _count: true }),
    prisma.aiDraft.findMany({
      where: { ...scope, status: { in: tab.statuses } },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { content: { include: { account: true } }, sourceComment: true, publishJob: true },
    }),
  ]);
  const countFor = (statuses: DraftStatus[]) => counts.filter((c) => statuses.includes(c.status)).reduce((n, c) => n + c._count, 0);
  const returnTo = `/approvals?tab=${tab.key}`;

  return (
    <>
      <Flash {...flash} />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1" aria-label="Status draf">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/approvals?tab=${t.key}`}
              aria-current={t.key === tab.key ? "page" : undefined}
              className={cx(
                "rounded-lg px-3 py-1.5 text-sm",
                t.key === tab.key ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-subtle",
              )}
            >
              {t.label} <span className="tabular-nums">({countFor(t.statuses)})</span>
            </Link>
          ))}
        </nav>
        {tab.key === "queue" && (
          <form action={runPublishingNow}>
            <input type="hidden" name="returnTo" value={returnTo} />
            <SubmitButton variant="secondary" size="sm" pendingText="Memproses…">Proses antrean sekarang</SubmitButton>
          </form>
        )}
      </div>
      {drafts.length === 0 ? (
        <EmptyState title={`Tidak ada draf berstatus "${tab.statuses.map((s) => STATUS_LABELS[s]).join(" / ")}"`} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {drafts.map((d) => (
            <DraftCard key={d.id} draft={d} returnTo={returnTo} showContent />
          ))}
        </div>
      )}
    </>
  );
}

export default function ApprovalsPage(props: PageProps<"/approvals">) {
  return (
    <>
      <PageHeader
        title="Persetujuan & publikasi"
        description="Tidak ada komentar yang dipublikasikan tanpa persetujuan eksplisit. Akun penerbit ditampilkan dan harus dikonfirmasi sebelum menyetujui."
      />
      <Suspense fallback={<Skeleton rows={4} />}>
        <Approvals searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
