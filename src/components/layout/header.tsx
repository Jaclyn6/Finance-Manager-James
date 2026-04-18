import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";

import { UserDisplay } from "./user-display";

/**
 * Top bar inside the protected shell. Holds the page-context label on
 * the left and the user controls on the right.
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
 */
export function Header() {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b bg-background px-6">
      <div className="text-sm font-medium text-muted-foreground">
        오늘의 투자 환경
      </div>
      <Suspense fallback={<HeaderRightSkeleton />}>
        <div className="flex items-center gap-2">
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
      <Skeleton className="size-9 rounded-md" />
      <Skeleton className="h-9 w-56 rounded-md" />
    </div>
  );
}
