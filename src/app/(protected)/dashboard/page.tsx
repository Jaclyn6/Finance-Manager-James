import { Suspense } from "react";

import { DashboardContent } from "./dashboard-content";
import { DashboardSkeleton } from "./dashboard-skeleton";

/**
 * Phase 1 Step 10 + 10.5 — Dashboard UI (date-aware, mobile-first).
 *
 * Layered rendering model:
 *
 * - THIS file is the **static shell**: headline + blurb + Suspense
 *   boundary. Under `cacheComponents: true` this prerenders at build
 *   time because it has no runtime-API dependencies. The `searchParams`
 *   Promise is passed down without being awaited here — awaiting it at
 *   the top level would force the whole page dynamic.
 *
 * - `DashboardContent` is the **dynamic subtree**: it awaits
 *   `searchParams`, sanitizes the `date` value, and calls the
 *   appropriate data reader — `getLatestCompositeSnapshots()` when
 *   `date` is null, `getCompositeSnapshotsForDate(date)` otherwise.
 *   Both underlying readers are `'use cache'` so same-day reloads and
 *   same-historical-day scrubbing hit cache. Historical dates also
 *   stay cached for weeks since those rows are immutable — see
 *   `src/lib/data/indicators.ts`.
 */
export default function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-6 md:space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          오늘 시장 상황
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          매크로 코어와 자산군별 합성 점수입니다. 확정적 투자 자문이 아닌
          해석 도구로 사용해 주세요.
        </p>
      </div>

      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
