import { Suspense } from "react";

import { DatePicker } from "@/components/layout/date-picker";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";

import { UserDisplay } from "./user-display";

/**
 * Top bar inside the protected shell. On mobile (`<md`), shows the
 * hamburger drawer trigger next to a short page-context label. On
 * desktop (`md+`), the hamburger is hidden via MobileNav's internal
 * `md:hidden`, and the fixed sidebar takes over navigation.
 *
 * Padding (blueprint §6.2): `px-4` on mobile, `md:px-6` on desktop —
 * tighter horizontal space on 360-wide viewports, normal on laptops.
 *
 * The right-side cluster (theme toggle + user display) lives inside a
 * single `<Suspense>` boundary. Two reasons this is required under
 * `cacheComponents: true`:
 *
 * 1. `UserDisplay` is a Server Component that calls `cookies()` — a
 *    runtime API that must live behind Suspense or the static shell
 *    can't prerender.
 * 2. `ThemeToggle` renders shadcn's `<Button>`, which imports
 *    `@base-ui/react/button`. base-ui calls `Math.random()` during its
 *    module evaluation (a property-name-obfuscation trick for
 *    `useInsertionEffect`, plus fallback id generation on older React).
 *    Next.js flags any non-deterministic value in a Client Component
 *    bundle — regardless of whether it fires at module load or at
 *    mount — so the component tree must sit inside a Suspense
 *    boundary. Without one, the static shell can't be prerendered.
 *
 * One boundary covers both. The fallback matches the final footprint
 * (icon button + user pill) so hydration doesn't shift the layout.
 *
 * MobileNav itself is a Client Component (it uses `usePathname` +
 * `useState`) but base-ui's dialog root doesn't trigger the same
 * Math.random flag as base-ui Button until its Content renders under
 * the portal, so it can live outside the Suspense boundary.
 */
export function Header() {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b bg-background px-4 md:px-6">
      <div className="flex items-center gap-2">
        {/*
          MobileNav reads `useSearchParams()` (Step 10.5 — to preserve
          `?date=` across drawer taps). Under `cacheComponents: true`,
          `useSearchParams` consumers must sit inside a Suspense
          boundary so the static shell can prerender around them —
          otherwise Next bails the entire route out with "Uncached data
          was accessed outside of <Suspense>". The skeleton is `size-11`
          (44×44, matches the hamburger's footprint) and `md:hidden`
          because the component itself is mobile-only.
        */}
        <Suspense
          fallback={<Skeleton className="size-11 rounded-md md:hidden" />}
        >
          <MobileNav />
        </Suspense>
        {/*
          Static label — hidden on `<md` because the hamburger already
          establishes page context and the DatePicker immediately to its
          right carries its own visual weight; stacking a third piece of
          text-only furniture crowded the 375px header. Desktop still
          shows it as a quiet breadcrumb anchor (handoff §7 flagged
          dynamic per-route labeling as a follow-up — keeping this
          static for now to avoid scope creep).
        */}
        <div className="hidden text-sm font-medium text-muted-foreground md:block">
          오늘의 투자 환경
        </div>
      </div>
      <Suspense fallback={<HeaderRightSkeleton />}>
        <div className="flex items-center gap-2">
          {/*
            DatePicker is a Client Component that reads `useSearchParams`.
            Under `cacheComponents: true`, any access to
            `searchParams` (server side) or `useSearchParams` (client
            side) requires a Suspense boundary in the render path —
            reusing the one that already wraps the right-hand cluster
            avoids fragmenting the fallback footprint.
          */}
          <DatePicker />
          <ThemeToggle />
          <UserDisplay />
        </div>
      </Suspense>
    </header>
  );
}

function HeaderRightSkeleton() {
  return (
    <div className="flex items-center gap-2">
      {/* DatePicker placeholder — rough width for the date button. */}
      <Skeleton className="h-9 w-28 rounded-md" />
      <Skeleton className="size-9 rounded-md" />
      <Skeleton className="h-9 w-56 rounded-md" />
    </div>
  );
}
