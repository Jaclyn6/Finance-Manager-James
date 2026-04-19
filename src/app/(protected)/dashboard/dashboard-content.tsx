import { connection } from "next/server";

import { AssetCard } from "@/components/dashboard/asset-card";
import { CompositeStateCard } from "@/components/dashboard/composite-state-card";
import { RecentChanges } from "@/components/dashboard/recent-changes";
import { getChangelogAroundDate } from "@/lib/data/changelog";
import { getLatestCompositeSnapshots } from "@/lib/data/indicators";
import { DASHBOARD_ASSET_ORDER } from "@/lib/utils/asset-labels";
import type { Tables } from "@/types/database";

/**
 * Dynamic body of the dashboard. Rendered inside the `<Suspense>`
 * boundary in `page.tsx` so the static shell (the `<h1>` + intro blurb)
 * can prerender while this async tree waits on the Supabase readers.
 *
 * `await connection()` is the Next 16 escape hatch for Cache Components:
 * it tells the prerender pass "this subtree needs request-time data, do
 * not try to materialize it at build time". Without it, calling
 * `new Date()` here triggers the `next-prerender-current-time` error
 * because build-time prerender can't pick a stable "today".
 *
 * The downstream `getLatestCompositeSnapshots()` and
 * `getChangelogAroundDate(today, 14)` are BOTH `'use cache'` functions.
 * `today` becomes part of the cache key for the changelog call, so cache
 * hits are still possible on same-day reloads — `connection()` only
 * opts this rendering path out of the static prerender, not out of
 * runtime caching.
 *
 * Empty-state policy:
 * - No `common` snapshot → quiet fallback card (first-run / full outage).
 *   We deliberately suppress the asset grid and recent-changes block
 *   in this case because they'd be confusing peers-without-anchor.
 * - Empty `bandChanges` → `RecentChanges` renders its own empty message;
 *   see that component's comment for the pedagogy rationale.
 */
export async function DashboardContent() {
  await connection();
  const today = new Date().toISOString().slice(0, 10);

  const [snapshots, changelog] = await Promise.all([
    getLatestCompositeSnapshots(),
    getChangelogAroundDate(today, 14),
  ]);

  const commonSnapshot = snapshots.find((s) => s.asset_type === "common");
  const snapshotByAsset = new Map(snapshots.map((s) => [s.asset_type, s]));

  // Sort by |delta| descending so the top 3 are the most impactful
  // moves, not simply the newest. The reader returns newest-first so
  // same-magnitude ties naturally break by recency — a deterministic
  // stable ranking.
  const bandChanges: Tables<"score_changelog">[] = [...changelog]
    .filter((row) => row.band_changed)
    .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0))
    .slice(0, 3);

  if (!commonSnapshot) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground md:p-12">
        아직 수집된 스냅샷이 없습니다. 다음 크론 실행 이후 오늘의 상태가
        표시됩니다.
      </div>
    );
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <CompositeStateCard snapshot={commonSnapshot} />

      <section className="space-y-3 md:space-y-4">
        <h2 className="text-lg font-semibold tracking-tight md:text-xl">
          자산군별 상태
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {DASHBOARD_ASSET_ORDER.map((assetType) => {
            const snapshot = snapshotByAsset.get(assetType);
            return snapshot ? (
              <AssetCard key={assetType} snapshot={snapshot} />
            ) : null;
          })}
        </div>
      </section>

      <RecentChanges rows={bandChanges} />
    </div>
  );
}
