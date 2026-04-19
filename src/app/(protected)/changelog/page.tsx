import { Suspense } from "react";

import { ChangelogContent } from "./changelog-content";
import { ChangelogSkeleton } from "./changelog-skeleton";

/**
 * Phase 1 Step 11 — Changelog page (date-aware).
 *
 * Static shell + `<Suspense>`-gated dynamic body, same Partial
 * Prerender pattern as the dashboard and asset-detail pages.
 * `searchParams.date` is awaited only inside the suspended subtree so
 * the shell prerenders.
 *
 * Window is centered on the `?date=` anchor (or today in latest
 * mode), 14 days each side, matching the dashboard's RecentChanges
 * window so the "top 3 around this date" preview on the dashboard
 * and the full list here stay conceptually aligned.
 */
export default function ChangelogPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-6 md:space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          변화 로그
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          선택한 날짜를 기준으로 ±14일 범위에서 기록된 점수 변화와 원인
          지표입니다. 밴드가 전환된 기록은 좌측에 브랜드 컬러로 강조됩니다.
        </p>
      </div>

      <Suspense fallback={<ChangelogSkeleton />}>
        <ChangelogContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
