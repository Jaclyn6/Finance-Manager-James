"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";
import { buildNavHref } from "@/lib/utils/nav-href";

import { GROUP_ORDER, NAV_ITEMS } from "./nav-items";

/**
 * Desktop sidebar — intended for `md+` viewports (blueprint §6.2).
 *
 * The component itself is viewport-agnostic; it renders the same
 * `<aside>` regardless of screen size. Visibility on `<md` is
 * enforced by its PARENT wrapper in `src/app/(protected)/layout.tsx`,
 * which wraps this Suspense boundary in `<div className="hidden md:flex">`.
 * Mobile users get the same nav items via the drawer in
 * `src/components/layout/mobile-nav.tsx` — both surfaces import
 * from the shared `./nav-items` module so they can never drift.
 *
 * Client Component — active-link highlighting requires `usePathname()`.
 *
 * Visual: Kraken-inspired. Brand mark in Kraken Purple with tight
 * negative tracking, nav groups labeled in tiny caps, active item
 * filled with `brand-subtle` tied back to the primary brand hue.
 */
export function Sidebar() {
  const pathname = usePathname();
  // Preserve `?date=` across sidebar navigation (blueprint §6.1 URL
  // contract) so picking a historical date then clicking "미국주식"
  // keeps the user anchored at that date on the destination page.
  const searchParams = useSearchParams();
  const currentDate = searchParams.get("date");

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
                      href={buildNavHref(item.href, currentDate)}
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
