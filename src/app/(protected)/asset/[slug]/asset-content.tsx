import { notFound } from "next/navigation";
import { connection } from "next/server";

import { CompositeStateCard } from "@/components/dashboard/composite-state-card";
import { ContributingIndicators } from "@/components/asset/contributing-indicators";
import { ScoreTrendLine } from "@/components/asset/score-trend-line";
import { NoSnapshotNotice } from "@/components/shared/no-snapshot-notice";
import {
  getClosestEarlierSnapshotDate,
  getCompositeSnapshotsForAssetRange,
  getCompositeSnapshotsForDate,
  getLatestCompositeSnapshots,
} from "@/lib/data/indicators";
import { ASSET_LABELS } from "@/lib/utils/asset-labels";
import { slugToAssetType } from "@/lib/utils/asset-slug";
import { sanitizeDateParam, todayIsoUtc } from "@/lib/utils/date";

/**
 * Dynamic body of the asset-detail page. Awaits `params` and
 * `searchParams`, resolves the asset type, and composes three data
 * reads (latest/forDate composite + per-asset trend window) for the
 * hero card, breakdown, and trend chart.
 *
 * Trend range: 90 days per PRD §11.2 "최근 30/90/180일 점수 추이".
 * 90 is the middle option — enough to see trends without the 180-day
 * query cost on every render. A future range-toggle would add a
 * Client Component control that updates `?range=` and branches here.
 */
const TREND_WINDOW_DAYS = 90;

export async function AssetContent({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);

  const assetType = slugToAssetType(slug);
  if (!assetType) {
    notFound();
  }

  const today = todayIsoUtc();
  const selectedDate = sanitizeDateParam(sp.date, today);

  // Same `connection()` gate as the dashboard: only the "latest"
  // branch reads wall-clock `today`, so only that branch needs the
  // opt-out marker. When a date is selected the cache key comes
  // from the URL and `await searchParams` already makes the subtree
  // dynamic.
  if (selectedDate === null) {
    await connection();
  }

  const anchorDate = selectedDate ?? today;

  // Three cached reads in parallel. Each has its own cache key so
  // same-date reloads are hits on all three. Trend window is keyed
  // on (assetType, anchorDate, TREND_WINDOW_DAYS).
  const [snapshots, trendSeries] = await Promise.all([
    selectedDate === null
      ? getLatestCompositeSnapshots()
      : getCompositeSnapshotsForDate(selectedDate),
    getCompositeSnapshotsForAssetRange(
      assetType,
      anchorDate,
      TREND_WINDOW_DAYS,
    ),
  ]);

  const snapshot = snapshots.find((s) => s.asset_type === assetType) ?? null;
  const label = ASSET_LABELS[assetType];

  // No snapshot for this asset + date: render the same empty-state
  // component the dashboard uses, pointing the jump-back link at
  // THIS asset's URL so the user stays on the same asset page.
  if (!snapshot) {
    const closest =
      selectedDate !== null
        ? await getClosestEarlierSnapshotDate(selectedDate)
        : null;
    return (
      <div className="space-y-6 md:space-y-8">
        <div>
          <Eyebrow />
          <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">
            {label}
          </h1>
        </div>
        {selectedDate !== null ? (
          <NoSnapshotNotice
            selectedDate={selectedDate}
            closestEarlierDate={closest}
            basePath={`/asset/${slug}`}
          />
        ) : (
          <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground md:p-12">
            이 자산군의 스냅샷이 아직 수집되지 않았습니다. 다음 크론 실행
            이후 표시됩니다.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <div>
        <Eyebrow />
        <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">
          {label}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          합성 점수가 어떤 지표들의 결합으로 산출됐는지와 최근{" "}
          {TREND_WINDOW_DAYS}일 추이입니다.
        </p>
      </div>

      {/*
        Reuse `CompositeStateCard` — the hero surface and data shape
        are identical to the dashboard common-card, just scoped to
        this asset. DRY beats diverging two near-identical components.
      */}
      <CompositeStateCard snapshot={snapshot} />

      <ScoreTrendLine
        data={trendSeries.map((s) => ({
          snapshot_date: s.snapshot_date,
          score_0_100: s.score_0_100,
        }))}
        rangeDays={TREND_WINDOW_DAYS}
      />

      <ContributingIndicators
        contributing={snapshot.contributing_indicators}
      />
    </div>
  );
}

function Eyebrow() {
  return (
    <div className="inline-flex rounded-md bg-brand-subtle px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-dark">
      자산군
    </div>
  );
}
