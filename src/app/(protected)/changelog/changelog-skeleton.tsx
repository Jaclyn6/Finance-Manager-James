import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading fallback for the changelog Suspense boundary. Stacks 4
 * card-shaped placeholders matching the final row layout.
 */
export function ChangelogSkeleton() {
  return (
    <div className="space-y-3 md:space-y-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 md:p-5"
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="ml-auto h-4 w-24" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
