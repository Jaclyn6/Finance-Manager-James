import { Suspense } from "react";

import { BacktestContent } from "./backtest-content";
import { BacktestSkeleton } from "./backtest-skeleton";

/**
 * Phase 3.4 Step 5 — Backtest UI page (`/backtest`).
 *
 * Reference: docs/phase3_4_backtest_blueprint.md §2.5, §9 Step 5
 *
 * Same Partial Prerender pattern as `/asset/[slug]`: static shell +
 * `<Suspense>`-gated content that awaits searchParams. The form
 * controls + Recharts dual-line chart + summary + deviation table
 * live inside `BacktestContent`.
 */
export default function BacktestPage({
  searchParams,
}: {
  searchParams: Promise<{
    asset?: string;
    from?: string;
    to?: string;
    weights?: string;
  }>;
}) {
  return (
    <div className="mx-auto max-w-6xl space-y-6 md:space-y-8">
      <Suspense fallback={<BacktestSkeleton />}>
        <BacktestContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
