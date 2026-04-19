import { connection } from "next/server";

import { AssetCard } from "@/components/dashboard/asset-card";
import { CompositeStateCard } from "@/components/dashboard/composite-state-card";
import { RecentChanges } from "@/components/dashboard/recent-changes";
import { NoSnapshotNotice } from "@/components/shared/no-snapshot-notice";
import { getChangelogAroundDate } from "@/lib/data/changelog";
import {
  getClosestEarlierSnapshotDate,
  getCompositeSnapshotsForDate,
  getLatestCompositeSnapshots,
} from "@/lib/data/indicators";
import { DASHBOARD_ASSET_ORDER } from "@/lib/utils/asset-labels";
import { sanitizeDateParam, todayIsoUtc } from "@/lib/utils/date";
import type { Tables } from "@/types/database";

/**
 * Dynamic body of the dashboard. Rendered inside the `<Suspense>`
 * boundary in `page.tsx`.
 *
 * Runtime-API consumers (awaited `searchParams`, `new Date()` via
 * `todayIsoUtc()`, request-context dependencies) live here, not in
 * `page.tsx`, so the static shell prerenders and only this subtree
 * is dynamic per request.
 *
 * `await connection()` is kept in the "latest" branch as the dynamic
 * marker for that code path — the moment `date` is resolved from
 * `searchParams`, the date-keyed cached reader is what provides the
 * request-time input, and `connection()` becomes redundant. When the
 * date is absent (latest mode), the computed `today` is wall-clock
 * data and needs `connection()` to satisfy Next 16's
 * `next-prerender-current-time` guard.
 *
 * Step 10.5 additions vs Step 10:
 * - Accepts `searchParams` Promise prop, awaits it, sanitizes `date`.
 * - Branches to `getCompositeSnapshotsForDate(date)` when a specific
 *   date is selected.
 * - Renders `NoSnapshotNotice` (with a closest-earlier-date link)
 *   when the selected date has no rows — honors PRD §11.6 "no
 *   fabricated estimates" rule.
 */
export async function DashboardContent({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const sp = await searchParams;
  const today = todayIsoUtc();
  const selectedDate = sanitizeDateParam(sp.date, today);

  // When no date param, we need request-time rendering because `today`
  // (wall-clock) drives the changelog window. When a date IS selected,
  // the date itself becomes the cache key for cached readers and
  // request-time is no longer needed — but we still await cached
  // readers either way so ordering is consistent.
  if (selectedDate === null) {
    await connection();
  }

  const anchorDate = selectedDate ?? today;

  // Fire snapshot + changelog reads in parallel. The changelog reader
  // is always called because a 14-day window around any anchor is
  // cheap and the cache is keyed on (anchorDate, windowDays).
  const [snapshots, changelog] = await Promise.all([
    selectedDate === null
      ? getLatestCompositeSnapshots()
      : getCompositeSnapshotsForDate(selectedDate),
    getChangelogAroundDate(anchorDate, 14),
  ]);

  // Empty selected-date → offer a quick jump to the closest earlier
  // snapshot. We only pay for this extra query on the no-data path,
  // not on every render.
  if (selectedDate !== null && snapshots.length === 0) {
    const closest = await getClosestEarlierSnapshotDate(selectedDate);
    return (
      <NoSnapshotNotice
        selectedDate={selectedDate}
        closestEarlierDate={closest}
        basePath="/dashboard"
      />
    );
  }

  const commonSnapshot = snapshots.find((s) => s.asset_type === "common");
  const snapshotByAsset = new Map(snapshots.map((s) => [s.asset_type, s]));

  // Sort by |delta| desc so the top 3 are most-impactful transitions
  // rather than simply newest. Reader returns newest-first, so ties
  // break by recency — deterministic and stable.
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
