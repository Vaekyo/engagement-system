import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, EmptyState, formatDate, PageHeader, Skeleton } from "@/components/ui";
import { requireCreator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Audit log" };

async function AuditLog() {
  await requireCreator();
  const entries = await prisma.auditLog.findMany({ orderBy: { timestamp: "desc" }, take: 200 });
  if (entries.length === 0) return <EmptyState title="Belum ada aktivitas" />;
  return (
    <Card title="200 aktivitas terakhir">
      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-border">
              <th className="py-2 pr-3 font-medium">Waktu</th>
              <th className="py-2 pr-3 font-medium">Aksi</th>
              <th className="py-2 pr-3 font-medium">Aktor</th>
              <th className="py-2 pr-3 font-medium">Target</th>
              <th className="py-2 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-border align-top last:border-0">
                <td className="whitespace-nowrap py-2 pr-3 text-xs text-muted">{formatDate(e.timestamp)}</td>
                <td className="py-2 pr-3 font-mono text-xs">{e.action}</td>
                <td className="py-2 pr-3 font-mono text-xs text-muted">{e.actor}</td>
                <td className="py-2 pr-3 font-mono text-xs text-muted">
                  {e.targetType}
                  {e.targetId ? `:${e.targetId.slice(0, 10)}` : ""}
                </td>
                <td className="py-2 font-mono text-xs text-muted">
                  {Object.keys(e.metadata as object).length ? JSON.stringify(e.metadata) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function AuditPage() {
  return (
    <>
      <PageHeader title="Audit log" description="Persetujuan, publikasi, kegagalan, koneksi akun, dan perubahan konfigurasi. Token dan rahasia disensor otomatis." />
      <Suspense fallback={<Skeleton rows={6} />}>
        <AuditLog />
      </Suspense>
    </>
  );
}
