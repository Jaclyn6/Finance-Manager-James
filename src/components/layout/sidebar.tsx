"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { GROUP_ORDER, NAV_ITEMS } from "./nav-items";

/**
 * Desktop sidebar (blueprint §6.2: renders on `md+` only).
 *
 * Client Component — active-link highlighting requires `usePathname()`.
 * On `<md` viewports this sidebar is hidden by its parent in
 * `src/app/(protected)/layout.tsx`; mobile users get the same nav
 * via `src/components/layout/mobile-nav.tsx` (Sheet drawer).
 *
 * Visual: Kraken-inspired. Brand mark in Kraken Purple with tight
 * negative tracking, nav groups labeled in tiny caps, active item
 * filled with `brand-subtle` tied back to the primary brand hue.
 */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 shrink-0 border-r bg-sidebar px-5 py-6">
      <div className="mb-8 px-2">
        <p className="text-base font-bold tracking-tight text-brand">
          Investment Advisor
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          가족 전용 대시보드
        </p>
      </div>

      <nav className="space-y-5">
        {GROUP_ORDER.map((group) => (
          <div key={group}>
            <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {group}
            </p>
            <ul className="space-y-0.5">
              {NAV_ITEMS.filter((item) => item.group === group).map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "block rounded-md px-2.5 py-2 text-sm transition-colors",
                        isActive
                          ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent/40 hover:text-foreground",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
