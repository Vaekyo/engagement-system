import { Suspense } from "react";
import { logout } from "@/app/actions";
import { NavLink } from "@/components/nav-link";
import { Badge, Button } from "@/components/ui";
import { requireCreator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { isLivePublishingEnabled, isMockMode } from "@/lib/env";
import { isAiConfigured } from "@/lib/ai/generate";

async function Sidebar() {
  const creator = await requireCreator();
  const pending = await prisma.aiDraft.count({
    where: { status: { in: ["pending_approval", "manual_action_required", "failed"] }, content: { account: { creatorId: creator.id } } },
  });
  return (
    <>
      <div className="px-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Workspace</p>
        <p className="mt-0.5 truncate font-semibold">{creator.displayName}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {isMockMode() && <Badge tone="warning" title="Data contoh; tidak ada panggilan ke platform">Mock mode</Badge>}
          {!isAiConfigured() && <Badge tone="neutral" title="ANTHROPIC_API_KEY belum diatur">AI: mock</Badge>}
          {!isMockMode() && !isLivePublishingEnabled() && <Badge tone="neutral" title="ENABLE_LIVE_PUBLISHING=false">Publikasi API off</Badge>}
        </div>
      </div>
      <nav className="-mx-3 mt-4 flex gap-1 overflow-x-auto px-3 md:mx-0 md:mt-6 md:block md:space-y-0.5 md:px-0" aria-label="Navigasi utama">
        <NavLink href="/">Ringkasan</NavLink>
        <NavLink href="/accounts">Akun</NavLink>
        <NavLink href="/content">Konten</NavLink>
        <NavLink href="/inbox">Inbox komentar</NavLink>
        <NavLink href="/approvals" count={pending}>
          Persetujuan
        </NavLink>
        <NavLink href="/analytics">Analitik</NavLink>
        <NavLink href="/audit">Audit log</NavLink>
      </nav>
      <form action={logout} className="mt-2 px-3 md:mt-6">
        <Button variant="ghost" size="sm" type="submit">
          Keluar
        </Button>
      </form>
    </>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col md:flex-row">
      <aside className="border-b border-border px-3 py-5 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <Suspense fallback={<div className="h-24 animate-pulse rounded-xl bg-subtle md:h-64" />}>
          <Sidebar />
        </Suspense>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-8 sm:px-8">{children}</main>
    </div>
  );
}
