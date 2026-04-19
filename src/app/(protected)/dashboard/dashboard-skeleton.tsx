import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading fallback shown while the Suspense boundary in `page.tsx`
 * waits for `DashboardContent` to resolve. Shape mirrors the final
 * rendered tree (hero, 4-card grid, changes list) so the first paint
 * doesn't visually jump when data arrives — a ~same-layout skeleton
 * beats a spinner for perceived-performance on mobile (PRD §11.7).
 *
 * Pure Server Component, no animation state — the shimmer comes from
 * the shadcn `Skeleton` primitive.
 */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6 md:space-y-8">
      {/* Hero card skeleton */}
      <div className="rounded-xl bg-card p-6 ring-1 ring-foreground/10 md:p-10">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-5 w-12 rounded-full" />
        </div>
        <div className="mt-6 flex items-end gap-4">
          <Skeleton className="h-14 w-32 md:h-16" />
          <Skeleton className="h-7 w-20 rounded-full" />
        </div>
      </div>

      {/* Asset grid skeleton */}
      <div>
        <Skeleton className="mb-3 h-6 w-28 md:mb-4" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl bg-card p-5 ring-1 ring-foreground/10 md:p-6"
            >
              <div className="space-y-3">
                <Skeleton className="h-4 w-20" />
                <div className="flex items-baseline gap-3">
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent changes skeleton */}
      <div className="rounded-xl bg-card py-4 ring-1 ring-foreground/10">
        <div className="space-y-2 px-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-64" />
        </div>
        <div className="mt-4 space-y-3 px-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
