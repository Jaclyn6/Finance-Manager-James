import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import { UserDisplay } from "./user-display";

/**
 * Top bar inside the protected shell. Holds the page-context title on
 * the left and the user pill on the right.
 *
 * `UserDisplay` reads `cookies()` under the hood so it lives inside a
 * `<Suspense>` boundary — required for `cacheComponents: true` to
 * prerender the rest of the shell. The fallback skeleton matches the
 * final element's footprint so layout doesn't jump.
 */
export function Header() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-6">
      <div className="text-sm font-medium text-muted-foreground">
        오늘의 투자 환경
      </div>
      <Suspense fallback={<Skeleton className="h-8 w-48" />}>
        <UserDisplay />
      </Suspense>
    </header>
  );
}
