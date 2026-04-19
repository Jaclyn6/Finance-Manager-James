import { Suspense } from "react";

import { DashboardContent } from "./dashboard-content";
import { DashboardSkeleton } from "./dashboard-skeleton";

/**
 * Phase 1 Step 10 — Dashboard UI (latest-only, mobile-first).
 *
 * Layered rendering model:
 *
 * - THIS file is the **static shell**: headline + blurb + Suspense
 *   boundary. Under `cacheComponents: true` this prerenders at build
 *   time because it has no runtime-API dependencies.
 *
 * - `DashboardContent` is the **dynamic subtree**: it calls
 *   `await connection()` to opt out of prerender, then `new Date()`
 *   (today in UTC) becomes the cache key for the changelog reader.
 *   Under the hood the two data readers are still `'use cache'`, so
 *   same-day reloads are cache hits even though the subtree renders
 *   dynamically.
 *
 * This is the Partial Prerender pattern from blueprint §5: static shell
 * + Suspense-gated dynamic content. When `?date=` navigation lands at
 * Step 10.5, this page will start accepting `searchParams`, the
 * `connection()` dependency moves to use `searchParams.date ??
 * today`, and the dashboard transitions toward fully-cacheable
 * `'use cache'(date)` territory.
 */
export default function DashboardPage() {
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
        <DashboardContent />
      </Suspense>
    </div>
  );
}
