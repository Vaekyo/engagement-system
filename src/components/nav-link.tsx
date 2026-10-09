"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

export function NavLink({ href, children, count }: { href: string; children: React.ReactNode; count?: number }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors",
        active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-subtle hover:text-foreground",
      )}
    >
      <span>{children}</span>
      {count ? <span className="rounded-full bg-warning-soft px-1.5 text-xs font-semibold text-warning tabular-nums">{count}</span> : null}
    </Link>
  );
}
