"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { GROUP_ORDER, NAV_ITEMS } from "./nav-items";

/**
 * Mobile navigation drawer (blueprint §6.2 / Step 9.5, v2.2).
 *
 * Renders a hamburger button that's only visible below the `md`
 * breakpoint (768px). On tap, opens a shadcn `Sheet` drawer from the
 * left containing the same nav items as the desktop sidebar. Tapping
 * any link closes the drawer so the user lands on the destination
 * with full viewport available.
 *
 * Touch-target rule (blueprint §6.2): hamburger button is 44×44
 * (Tailwind `size-11`). Nav links inside the drawer use `min-h-11`
 * with generous vertical padding so each tap target comfortably
 * clears 44px — larger than the desktop sidebar because phone
 * fingers aren't mouse cursors.
 *
 * Native-gesture non-interference: the Sheet is powered by base-ui's
 * dialog primitive, which closes on Esc and outside-click by default.
 * We don't register a custom swipe-to-close — iOS and Android handle
 * the OS back gesture natively on a full-screen overlay.
 *
 * Controlled via local `open` state so a link click can call
 * `setOpen(false)` — base-ui's `SheetClose` render prop works but
 * clutters the JSX tree with portal-aware elements around each `<Link>`.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            size="icon"
            variant="ghost"
            aria-label="내비게이션 메뉴 열기"
            className="size-11 md:hidden"
          />
        }
      >
        <Menu className="size-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="border-b px-5 py-6">
          <SheetTitle className="text-base font-bold tracking-tight text-brand">
            Investment Advisor
          </SheetTitle>
          <SheetDescription className="text-xs">
            가족 전용 대시보드
          </SheetDescription>
        </SheetHeader>
        <nav className="space-y-5 px-5 py-6">
          {GROUP_ORDER.map((group) => (
            <div key={group}>
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {group}
              </p>
              <ul className="space-y-0.5">
                {NAV_ITEMS.filter((item) => item.group === group).map((item) => {
                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "flex min-h-11 items-center rounded-md px-2.5 text-sm transition-colors",
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
      </SheetContent>
    </Sheet>
  );
}
