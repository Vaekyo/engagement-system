import type { Metadata } from "next";
import { Suspense } from "react";
import { addAffiliatedAuthor, addManualAccount, revokeAccount, syncAccountNow, updateSettings } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card, ConnectionBadge, EmptyState, Field, Flash, formatDate, inputClass, LinkButton, PageHeader, PlatformTag, Skeleton } from "@/components/ui";
import { requireCreator } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { isMockMode, isYouTubeOAuthConfigured } from "@/lib/env";
import { adapterFor } from "@/lib/platforms/registry";
import type { Capabilities } from "@/lib/platforms/types";
import { readFlash } from "@/lib/queries/flash";

export const metadata: Metadata = { title: "Akun" };

const CAPABILITY_LABELS: Record<keyof Capabilities, string> = {
  listRecentContent: "Deteksi konten",
  listComments: "Baca komentar",
  publishComment: "Posting komentar",
  replyToComment: "Balas komentar",
  getMetrics: "Metrik",
};

async function Accounts({ searchParams }: { searchParams: PageProps<"/accounts">["searchParams"] }) {
  const creator = await requireCreator();
  const flash = await readFlash(searchParams);
  const [accounts, affiliated] = await Promise.all([
    prisma.platformAccount.findMany({ where: { creatorId: creator.id }, orderBy: [{ platform: "asc" }, { createdAt: "asc" }] }),
    prisma.affiliatedAuthor.findMany({ where: { creatorId: creator.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const statuses = await Promise.all(accounts.map(async (a) => (await adapterFor(a)).getConnectionStatus()));
  const retentionDays = (creator.settings as { retentionDays?: number })?.retentionDays ?? 365;
  const returnTo = "/accounts";

  return (
    <>
      <Flash {...flash} />
      <div className="space-y-6">
        <Card
          title="Akun terhubung"
          description="Status izin API per platform. Token OAuth disimpan terenkripsi di server dan tidak pernah dikirim ke browser."
          actions={
            isYouTubeOAuthConfigured() && !isMockMode() ? (
              <LinkButton href="/api/oauth/youtube/start" variant="primary" size="sm">
                Hubungkan YouTube
              </LinkButton>
            ) : (
              <Badge tone="neutral" title="Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET dan MOCK_MODE=false">
                OAuth YouTube belum dikonfigurasi
              </Badge>
            )
          }
        >
          {accounts.length === 0 ? (
            <EmptyState title="Belum ada akun">Hubungkan YouTube atau tambahkan akun di bawah untuk mode manual.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {accounts.map((a, i) => {
                const status = statuses[i];
                return (
                  <li key={a.id} className="rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">@{a.handle}</p>
                          <Badge tone={a.accountType === "official" ? "accent" : "info"}>{a.accountType === "official" ? "Akun resmi" : "Akun tim"}</Badge>
                        </div>
                        <PlatformTag platform={a.platform} />
                      </div>
                      <ConnectionBadge status={a.connectionStatus} />
                    </div>
                    <p className="mt-2 text-sm text-muted">{status.detail}</p>
                    {a.lastError && <p className="mt-1 text-sm text-danger">Error terakhir: {a.lastError}</p>}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(Object.keys(CAPABILITY_LABELS) as (keyof Capabilities)[]).map((k) => (
                        <Badge key={k} tone={status.capabilities[k] ? "success" : "neutral"}>
                          {status.capabilities[k] ? "✓" : "—"} {CAPABILITY_LABELS[k]}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>Sinkron terakhir: {formatDate(a.lastSyncedAt)}</span>
                      {a.tokenExpiresAt && <span>· Token berlaku s.d. {formatDate(a.tokenExpiresAt)}</span>}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {a.platform === "youtube" && status.capabilities.listRecentContent && !isMockMode() && (
                        <form action={syncAccountNow}>
                          <input type="hidden" name="accountId" value={a.id} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <SubmitButton variant="secondary" size="sm" pendingText="Menyinkron…">Sinkron sekarang</SubmitButton>
                        </form>
                      )}
                      {a.platform === "youtube" && isYouTubeOAuthConfigured() && !isMockMode() && a.connectionStatus !== "connected" && (
                        <LinkButton href="/api/oauth/youtube/start" size="sm">Hubungkan ulang</LinkButton>
                      )}
                      {a.connectionStatus !== "revoked" && (a.encryptedAccessToken || a.connectionStatus === "connected") && (
                        <form action={revokeAccount}>
                          <input type="hidden" name="accountId" value={a.id} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <SubmitButton variant="danger" size="sm">Cabut akses</SubmitButton>
                        </form>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Tambah akun (mode manual)" description="Untuk Instagram/TikTok atau akun yang belum punya akses API. Konten dicatat via URL dan komentar diposting manual.">
            <form action={addManualAccount} className="space-y-3">
              <input type="hidden" name="returnTo" value={returnTo} />
              <Field label="Platform">
                <select name="platform" className={inputClass} defaultValue="instagram">
                  <option value="youtube">YouTube Shorts</option>
                  <option value="instagram">Instagram Reels</option>
                  <option value="tiktok">TikTok</option>
                </select>
              </Field>
              <Field label="Handle akun">
                <input name="handle" required maxLength={100} className={inputClass} placeholder="@namaakun" />
              </Field>
              <Field label="Jenis akun" hint="Akun tim harus jelas identitasnya sebagai bagian dari tim kreator.">
                <select name="accountType" className={inputClass} defaultValue="official">
                  <option value="official">Akun resmi kreator</option>
                  <option value="team">Akun tim/afiliasi (teridentifikasi)</option>
                </select>
              </Field>
              <SubmitButton>Tambah akun</SubmitButton>
            </form>
          </Card>

          <Card title="Identitas tim & afiliasi" description="Komentar dari ID ini dihitung sebagai aktivitas tim, bukan audiens organik.">
            {affiliated.length > 0 && (
              <ul className="mb-4 divide-y divide-border text-sm">
                {affiliated.map((f) => (
                  <li key={f.id} className="flex justify-between gap-3 py-2">
                    <span className="font-medium">{f.label}</span>
                    <span className="truncate font-mono text-xs text-muted">
                      {f.platform}:{f.externalAuthorId}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <form action={addAffiliatedAuthor} className="space-y-3">
              <input type="hidden" name="returnTo" value={returnTo} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Platform">
                  <select name="platform" className={inputClass}>
                    <option value="youtube">YouTube</option>
                    <option value="instagram">Instagram</option>
                    <option value="tiktok">TikTok</option>
                  </select>
                </Field>
                <Field label="Label">
                  <input name="label" required className={inputClass} placeholder="Editor — Dimas" />
                </Field>
              </div>
              <Field label="ID akun di platform" hint="YouTube: channel ID (UC…).">
                <input name="externalAuthorId" required className={inputClass} />
              </Field>
              <SubmitButton variant="secondary">Simpan</SubmitButton>
            </form>
          </Card>
        </div>

        <Card title="Privasi & retensi data" description="Komentar penonton yang lebih lama dari batas ini dianonimkan (teks dan identitas dihapus; jumlah tetap untuk analitik).">
          <form action={updateSettings} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="returnTo" value={returnTo} />
            <Field label="Retensi komentar penonton (hari)">
              <input name="retentionDays" type="number" min={30} max={3650} defaultValue={retentionDays} className={`${inputClass} w-40`} />
            </Field>
            <SubmitButton variant="secondary">Simpan</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}

export default function AccountsPage(props: PageProps<"/accounts">) {
  return (
    <>
      <PageHeader
        title="Akun"
        description="Hubungkan akun resmi melalui OAuth. Aplikasi ini tidak pernah meminta kata sandi platform."
      />
      <Suspense fallback={<Skeleton rows={3} />}>
        <Accounts searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
