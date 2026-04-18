import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import { UserDisplay } from "./user-display";

/**
 * Top bar inside the protected shell. Holds the page-context label on
 * the left and the user pill on the right.
 *
 * `UserDisplay` reads `cookies()` so it lives inside a `<Suspense>`
 * boundary — required for `cacheComponents: true` to prerender the
 * rest of the shell. The skeleton roughly matches the final element's
 * footprint so layout doesn't shift on hydration.
 */
export function Header() {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b bg-background px-6">
      <div className="text-sm font-medium text-muted-foreground">
        오늘의 투자 환경
      </div>
      <Suspense fallback={<Skeleton className="h-9 w-56 rounded-md" />}>
        <UserDisplay />
      </Suspense>
    </header>
  );
}
