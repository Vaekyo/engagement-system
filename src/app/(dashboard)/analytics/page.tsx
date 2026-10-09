import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, Card, EmptyState, formatNumber, formatPercent, PageHeader, PlatformTag, Skeleton, Stat } from "@/components/ui";
import { requireCreator } from "@/lib/auth/session";
import { buildContentReport, summarizeGroup } from "@/lib/analytics/report";
import { organicPer1000 } from "@/lib/analytics/metrics";

export const metadata: Metadata = { title: "Analitik" };

async function Analytics() {
  const creator = await requireCreator();
  const rows = await buildContentReport(creator.id);
  if (rows.length === 0) return <EmptyState title="Belum ada data">Tambahkan konten dan snapshot metrik untuk melihat analitik.</EmptyState>;

  const sum = (f: (r: (typeof rows)[number]) => number | null) => rows.reduce((n, r) => n + (f(r) ?? 0), 0);
  const audience = sum((r) => r.metrics.audienceComments);
  const viewsWithData = rows.filter((r) => r.metrics.views !== null);
  const audienceWithViews = viewsWithData.reduce((n, r) => n + r.metrics.audienceComments, 0);
  const views = viewsWithData.reduce((n, r) => n + (r.metrics.views ?? 0), 0);
  const topLevel = sum((r) => r.metrics.audienceTopLevel);
  const answered = sum((r) => r.metrics.audienceTopLevelAnswered);
  const seeded = summarizeGroup(rows.filter((r) => r.experimentGroup === "seeded"));
  const control = summarizeGroup(rows.filter((r) => r.experimentGroup === "control"));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Komentar organik penonton" value={formatNumber(audience)} hint="Tidak termasuk kreator & tim" />
        <Stat label="Organik / 1.000 views" value={formatNumber(organicPer1000(audienceWithViews, views), 1)} hint={`dari ${viewsWithData.length} konten dengan data views`} />
        <Stat label="Komentar utama dibalas" value={formatPercent(topLevel ? answered / topLevel : null)} hint={`${answered}/${topLevel}`} />
        <Stat label="Komentar kreator / tim" value={`${formatNumber(sum((r) => r.metrics.creatorComments))} / ${formatNumber(sum((r) => r.metrics.teamComments))}`} hint="Dipisahkan dari organik" />
      </div>

      <Card title="Per konten" description="Metrik dihitung dari komentar tercatat dan snapshot terbaru. Views 24 jam / 7 hari memakai snapshot pertama setelah titik waktu tersebut.">
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-border">
                <th className="py-2 pr-3 font-medium">Konten</th>
                <th className="py-2 pr-3 text-right font-medium">Views</th>
                <th className="py-2 pr-3 text-right font-medium">24 jam</th>
                <th className="py-2 pr-3 text-right font-medium">7 hari</th>
                <th className="py-2 pr-3 text-right font-medium">Organik</th>
                <th className="py-2 pr-3 text-right font-medium">/1.000 views</th>
                <th className="py-2 pr-3 text-right font-medium">Peserta unik</th>
                <th className="py-2 pr-3 text-right font-medium">Balasan antar-penonton</th>
                <th className="py-2 pr-3 text-right font-medium">Dibalas</th>
                <th className="py-2 text-right font-medium">Kreator/tim</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="max-w-64 py-2 pr-3">
                    <Link href={`/content/${r.id}`} className="block truncate font-medium hover:underline">
                      {r.title}
                    </Link>
                    <span className="flex items-center gap-2">
                      <PlatformTag platform={r.platform} />
                      {r.experimentGroup && <Badge tone="info">{r.experimentGroup === "seeded" ? "pemantik" : "pembanding"}</Badge>}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right">{formatNumber(r.metrics.views)}</td>
                  <td className="py-2 pr-3 text-right">{formatNumber(r.views24h)}</td>
                  <td className="py-2 pr-3 text-right">{formatNumber(r.views7d)}</td>
                  <td className="py-2 pr-3 text-right">{formatNumber(r.metrics.audienceComments)}</td>
                  <td className="py-2 pr-3 text-right">{formatNumber(r.metrics.organicPer1000Views, 1)}</td>
                  <td className="py-2 pr-3 text-right" title="Hanya tersedia untuk komentar yang diimpor via API">
                    {formatNumber(r.metrics.uniqueAudienceParticipants)}
                  </td>
                  <td className="py-2 pr-3 text-right">{formatNumber(r.metrics.audienceRepliesToOthers)}</td>
                  <td className="py-2 pr-3 text-right">{formatPercent(r.metrics.replyRate)}</td>
                  <td className="py-2 text-right">
                    {r.metrics.creatorComments}/{r.metrics.teamComments}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Evaluasi pilot"
        description="Bandingkan konten dengan komentar pemantik resmi vs pembanding. Tandai grup di halaman detail konten."
      >
        {seeded.count === 0 && control.count === 0 ? (
          <EmptyState title="Belum ada konten pilot">Rancangan awal: 12 video sebanding — 6 dengan komentar pemantik, 6 pembanding, pantau 7 hari.</EmptyState>
        ) : (
          <>
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3 font-medium">Grup</th>
                    <th className="py-2 pr-3 text-right font-medium">Konten</th>
                    <th className="py-2 pr-3 text-right font-medium">Rata-rata organik/1.000</th>
                    <th className="py-2 pr-3 text-right font-medium">Rata-rata dibalas</th>
                    <th className="py-2 pr-3 text-right font-medium">Rata-rata peserta unik</th>
                    <th className="py-2 text-right font-medium">Rata-rata balasan antar-penonton</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {[
                    ["Dengan pemantik", seeded],
                    ["Pembanding", control],
                  ].map(([label, g]) => {
                    const s = g as typeof seeded;
                    return (
                      <tr key={label as string} className="border-b border-border last:border-0">
                        <td className="py-2 pr-3 font-medium">{label as string}</td>
                        <td className="py-2 pr-3 text-right">{s.count}</td>
                        <td className="py-2 pr-3 text-right">{formatNumber(s.meanOrganicPer1000, 2)}</td>
                        <td className="py-2 pr-3 text-right">{formatPercent(s.meanReplyRate)}</td>
                        <td className="py-2 pr-3 text-right">{formatNumber(s.meanUniqueParticipants, 1)}</td>
                        <td className="py-2 text-right">{formatNumber(s.meanAudienceReplies, 1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted">
              Ini bukan bukti kausal: sampel kecil dan perbedaan topik, format, durasi, dan jam upload dapat memengaruhi hasil. Catat faktor tersebut saat menilai.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <>
      <PageHeader
        title="Analitik engagement"
        description="Aktivitas kreator, tim, dan penonton dipisahkan. Komentar pemantik kreator tidak pernah dihitung sebagai engagement organik."
      />
      <Suspense fallback={<Skeleton rows={4} />}>
        <Analytics />
      </Suspense>
    </>
  );
}
