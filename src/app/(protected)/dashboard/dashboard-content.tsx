import { connection } from "next/server";

import { MarketWeatherStrip } from "@/components/advisor/market-weather-strip";
import { VerdictCard } from "@/components/advisor/verdict-card";
import { AssetCard } from "@/components/dashboard/asset-card";
import { CompositeStateCard } from "@/components/dashboard/composite-state-card";
import { RecentChanges } from "@/components/dashboard/recent-changes";
import { SignalAlignmentCard } from "@/components/dashboard/signal-alignment-card";
import { NoSnapshotNotice } from "@/components/shared/no-snapshot-notice";
import {
  getAdvisorViews,
  getWeatherDeltas,
  getWeatherPercentiles,
} from "@/lib/data/advisor";
import { getChangelogAroundDate } from "@/lib/data/changelog";
import {
  getClosestEarlierSnapshotDate,
  getCompositeSnapshotsForDate,
  getLatestCompositeSnapshots,
  getLatestIndicatorReadings,
} from "@/lib/data/indicators";
import { getLatestSignalEvent } from "@/lib/data/signals";
import { SIGNAL_RULES_VERSION } from "@/lib/score-engine/weights";
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

  // Fire snapshot + changelog + signal-event reads in parallel. The
  // changelog reader is always called because a 14-day window around
  // any anchor is cheap and the cache is keyed on (anchorDate,
  // windowDays). `getLatestSignalEvent(anchorDate)` returns the most
  // recent row ≤ anchorDate or `null` when no row has been computed
  // yet (first day of Phase 2); the SignalAlignmentCard renders its
  // own empty state in that case, so a null here is non-fatal.
  // The advisor verdict + weather strip are LATEST-ONLY surfaces: the
  // verdict is computed from today's readings and price series, so
  // rendering it under a historical `?date=` would pair yesterday's
  // composite with today's judgment — misleading. Historical mode
  // keeps the pre-pivot composite view.
  const [
    snapshots,
    changelog,
    signalEvent,
    advisorViews,
    weatherReadings,
    weatherDeltas,
    weatherPercentiles,
  ] = await Promise.all([
    selectedDate === null
      ? getLatestCompositeSnapshots()
      : getCompositeSnapshotsForDate(selectedDate),
    getChangelogAroundDate(anchorDate, 14),
    getLatestSignalEvent(selectedDate ?? undefined),
    selectedDate === null ? getAdvisorViews(today) : Promise.resolve(null),
    selectedDate === null
      ? getLatestIndicatorReadings()
      : Promise.resolve(null),
    selectedDate === null ? getWeatherDeltas(today) : Promise.resolve(null),
    selectedDate === null
      ? getWeatherPercentiles(today)
      : Promise.resolve(null),
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
      {/*
        Advisor verdict section leads the page (PRD pivot 2026-07-08):
        the product's core question is "지금 이 하락이 할인인가,
        추세전환인가" — everything below (signals, composite score) is
        supporting evidence. Latest-mode only; see fetch block above.
      */}
      {advisorViews !== null && (
        <section className="space-y-3 md:space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight md:text-xl">
              지금이 할인 구간인가?
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              낙폭·추세·심리·변동성·매크로 근거로 조정(할인)과 추세전환을
              판별합니다
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {advisorViews.map((view) => (
              <VerdictCard
                key={view.assetType}
                view={view}
                currentDate={selectedDate}
              />
            ))}
          </div>
        </section>
      )}

      {weatherReadings !== null && (
        <MarketWeatherStrip
          readings={weatherReadings}
          deltas={weatherDeltas ?? undefined}
          percentiles={weatherPercentiles ?? undefined}
        />
      )}

      {/*
        Signal alignment sits ABOVE the composite per plan §0.5 tenet 4:
        "actionable over aggregate" — users care first about whether the
        buy conditions are firing, then about the composite score as a
        quantified summary.
      */}
      <SignalAlignmentCard
        signalEvent={signalEvent}
        assetType="common"
        isRulesCutoverDay={
          signalEvent != null &&
          signalEvent.signal_rules_version !== SIGNAL_RULES_VERSION
        }
      />

      <CompositeStateCard snapshot={commonSnapshot} />

      <section className="space-y-3 md:space-y-4">
        <h2 className="text-lg font-semibold tracking-tight md:text-xl">
          자산군별 상태
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {DASHBOARD_ASSET_ORDER.map((assetType) => {
            const snapshot = snapshotByAsset.get(assetType);
            return snapshot ? (
              <AssetCard
                key={assetType}
                snapshot={snapshot}
                currentDate={selectedDate}
              />
            ) : null;
          })}
        </div>
      </section>

      <RecentChanges rows={bandChanges} />
    </div>
  );
}
