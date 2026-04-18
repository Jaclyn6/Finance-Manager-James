"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  group: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "오늘의 상태", group: "홈" },
  { href: "/asset/us-equity", label: "미국주식", group: "자산군" },
  { href: "/asset/kr-equity", label: "한국주식", group: "자산군" },
  { href: "/asset/btc", label: "BTC", group: "자산군" },
  { href: "/asset/global-etf", label: "글로벌 ETF", group: "자산군" },
  { href: "/changelog", label: "변화 로그", group: "히스토리" },
];

const GROUP_ORDER = ["홈", "자산군", "히스토리"] as const;

/**
 * Client Component because active-link highlighting depends on
 * `usePathname()`. Kept intentionally small so the protected layout
 * stays mostly Server-Component.
 *
 * `pathname.startsWith(item.href)` is used for `/asset/*` so that
 * `/asset/us-equity` (the page) correctly highlights "미국주식" even
 * if sub-routes are added later.
 */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 border-r bg-card px-4 py-6">
      <div className="mb-6 px-2">
        <p className="text-sm font-semibold">투자 어드바이저</p>
        <p className="text-xs text-muted-foreground">가족 전용 대시보드</p>
      </div>

      <nav className="space-y-4">
        {GROUP_ORDER.map((group) => (
          <div key={group}>
            <p className="mb-1 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
                        "block rounded px-2 py-1.5 text-sm transition-colors",
                        isActive
                          ? "bg-accent font-medium text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
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
