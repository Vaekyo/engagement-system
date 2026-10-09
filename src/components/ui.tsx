import type { ConnectionStatus, DraftStatus, JobState, Platform } from "@prisma/client";
import Link from "next/link";
import type { ReactNode } from "react";
import { STATUS_LABELS } from "@/lib/drafts/state-machine";
import { PLATFORM_LABELS } from "@/lib/content-url";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, description, children, className, actions }: { title?: ReactNode; description?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cx("rounded-xl border border-border bg-surface p-5 shadow-sm", className)}>
      {(title || actions) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="font-medium">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const TONES: Record<Tone, string> = {
  neutral: "bg-subtle text-muted border-border",
  success: "bg-success-soft text-success border-success/30",
  warning: "bg-warning-soft text-warning border-warning/30",
  danger: "bg-danger-soft text-danger border-danger/30",
  info: "bg-info-soft text-info border-info/30",
  accent: "bg-accent-soft text-accent border-accent/30",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TONES[tone])}>
      {children}
    </span>
  );
}

const DRAFT_TONES: Record<DraftStatus, Tone> = {
  draft: "neutral",
  pending_approval: "warning",
  approved: "info",
  queued: "info",
  published: "success",
  rejected: "danger",
  failed: "danger",
  manual_action_required: "accent",
  cancelled: "neutral",
};

export function DraftStatusBadge({ status }: { status: DraftStatus }) {
  return <Badge tone={DRAFT_TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}

const JOB_TONES: Record<JobState, Tone> = {
  queued: "info",
  running: "info",
  retry_scheduled: "warning",
  published: "success",
  failed: "danger",
  manual_action_required: "accent",
  cancelled: "neutral",
};

export function JobStateBadge({ state }: { state: JobState }) {
  return <Badge tone={JOB_TONES[state]}>job: {state.replaceAll("_", " ")}</Badge>;
}

const CONNECTION: Record<ConnectionStatus, { tone: Tone; label: string }> = {
  connected: { tone: "success", label: "Terhubung" },
  manual: { tone: "neutral", label: "Mode manual" },
  permission_required: { tone: "warning", label: "Perlu izin" },
  expired: { tone: "warning", label: "Token kedaluwarsa" },
  revoked: { tone: "danger", label: "Dicabut" },
  error: { tone: "danger", label: "Error" },
};

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const c = CONNECTION[status];
  return <Badge tone={c.tone}>{c.label}</Badge>;
}

const PLATFORM_DOT: Record<Platform, string> = {
  youtube: "bg-[#e5484d]",
  instagram: "bg-[#d6409f]",
  tiktok: "bg-foreground",
};

export function PlatformTag({ platform }: { platform: Platform }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
      <span className={cx("size-2 rounded-full", PLATFORM_DOT[platform])} aria-hidden />
      {PLATFORM_LABELS[platform]}
    </span>
  );
}

export const buttonClass = (variant: "primary" | "secondary" | "danger" | "ghost" = "secondary", size: "sm" | "md" = "md") =>
  cx(
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm",
    variant === "primary" && "bg-accent text-accent-foreground hover:bg-accent/90",
    variant === "secondary" && "border border-border bg-surface hover:bg-subtle",
    variant === "danger" && "border border-danger/40 bg-surface text-danger hover:bg-danger-soft",
    variant === "ghost" && "text-muted hover:bg-subtle hover:text-foreground",
  );

export function Button({
  children,
  variant,
  size,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Parameters<typeof buttonClass>[0]; size?: "sm" | "md" }) {
  return (
    <button {...props} className={cx(buttonClass(variant, size), props.className)}>
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant, size, external }: { href: string; children: ReactNode; variant?: Parameters<typeof buttonClass>[0]; size?: "sm" | "md"; external?: boolean }) {
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={buttonClass(variant, size)}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={buttonClass(variant, size)}>
      {children}
    </Link>
  );
}

export const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  return (
    <div
      role={error ? "alert" : "status"}
      className={cx(
        "mb-5 rounded-lg border px-4 py-3 text-sm",
        error ? "border-danger/30 bg-danger-soft text-danger" : "border-success/30 bg-success-soft text-success",
      )}
    >
      {error ?? ok}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Memuat">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl bg-subtle" />
      ))}
    </div>
  );
}

export function formatDate(date: Date | null | undefined) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatNumber(n: number | null | undefined, digits = 0) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

export function formatPercent(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `${formatNumber(n * 100, 0)}%`;
}
