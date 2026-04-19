import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading fallback for the asset-detail Suspense boundary. Shape
 * mirrors the final layout (eyebrow + heading + hero + trend chart
 * + breakdown card) so hydration doesn't shift content vertically.
 */
export function AssetSkeleton() {
  return (
    <div className="space-y-6 md:space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-4 w-16 rounded-md" />
        <Skeleton className="h-8 w-40 md:h-9" />
        <Skeleton className="h-4 w-full max-w-[420px]" />
      </div>
      <Skeleton className="h-40 w-full rounded-xl md:h-48" />
      <Skeleton className="h-64 w-full rounded-2xl md:h-72" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
