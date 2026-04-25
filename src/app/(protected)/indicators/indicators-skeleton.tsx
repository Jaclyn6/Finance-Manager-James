import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading fallback for the `/indicators` Suspense boundary. Renders a
 * pair of category sections, each with two card-shaped placeholders,
 * so the layout doesn't collapse during streaming.
 *
 * Body data is pulled from a static module today, so this fallback is
 * effectively cosmetic — it exists so the seam stays consistent with
 * `ChangelogSkeleton` / `DashboardSkeleton` if a future revision moves
 * to a per-user data fetch (e.g. favorited entries).
 */
export function IndicatorsSkeleton() {
  return (
    <div className="space-y-10">
      {Array.from({ length: 2 }).map((_, sectionIdx) => (
        <section key={sectionIdx} className="space-y-4">
          <Skeleton className="h-7 w-40" />
          <div className="space-y-4">
            {Array.from({ length: 2 }).map((__, cardIdx) => (
              <div
                key={cardIdx}
                className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 md:p-5"
              >
                <Skeleton className="h-5 w-44" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
