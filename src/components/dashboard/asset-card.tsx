import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { StalenessBadge } from "@/components/shared/staleness-badge";
import { ASSET_LABELS } from "@/lib/utils/asset-labels";
import { ASSET_SLUGS } from "@/lib/utils/asset-slug";
import { buildNavHref } from "@/lib/utils/nav-href";
import { cn } from "@/lib/utils";
import { scoreToBand, type BandIntensity } from "@/lib/utils/score-band";
import type { Tables } from "@/types/database";

/**
 * Per-asset-class card in the dashboard grid.
 *
 * Peer of four in `grid-cols-1 md:grid-cols-2` (blueprint §6.2) — the
 * `common` asset_type is intentionally excluded from this grid because
 * it renders above as the hero via `CompositeStateCard`.
 *
 * Visual weight is deliberately lower than the hero: body-sized score
 * and a compact band pill, no model-version prefix (just the version
 * number). Staleness badge still shows so a partial-day failure on a
 * single asset class surfaces here even while the hero reads "최신".
 *
 * Phase 1 keeps this card score-only. The small sparkline hinted at
 * in blueprint §9 Step 10 lands with the Recharts Client Component in
 * Step 11 — adding it here would force an unnecessary `"use client"`
 * boundary and pull the whole dashboard into client-side rendering.
 */
export interface AssetCardProps {
  snapshot: Tables<"composite_snapshots">;
  /**
   * Optional `?date=` value to preserve when the card's link navigates
   * to `/asset/[slug]`. Caller (dashboard-content) passes the already-
   * sanitized selected date so the user's chosen history anchor
   * survives the drill-down (blueprint §6.1 URL contract).
   */
  currentDate?: string | null;
}

export function AssetCard({ snapshot, currentDate = null }: AssetCardProps) {
  const band = scoreToBand(snapshot.score_0_100);
  const score = Math.round(snapshot.score_0_100 * 10) / 10;
  const label = ASSET_LABELS[snapshot.asset_type];

  // `common` has no dedicated page (it's the dashboard hero), so the
  // slug lookup can be undefined. In practice the dashboard grid
  // filters out common via DASHBOARD_ASSET_ORDER, so this branch is
  // defensive — if the filter ever regresses, we want to render a
  // non-linked card rather than crash.
  const slug =
    snapshot.asset_type === "common"
      ? null
      : (ASSET_SLUGS[snapshot.asset_type] ?? null);

  const cardInner = (
    <Card
      size="sm"
      className={cn(
        "p-5 md:p-6 transition-colors",
        slug &&
          "hover:bg-muted/40 group-focus-visible/asset-link:ring-2 group-focus-visible/asset-link:ring-ring",
      )}
    >
      <CardContent className="flex flex-col gap-3 p-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <StalenessBadge
            fetchStatus={snapshot.fetch_status}
            snapshotDate={snapshot.snapshot_date}
          />
        </div>

        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-bold leading-none tracking-tight text-foreground">
            {score.toFixed(1)}
          </span>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-medium",
              intensityPalette[band.intensity],
            )}
          >
            {band.label}
          </span>
        </div>

        <p className="text-[11px] text-muted-foreground">
          {snapshot.model_version}
        </p>
      </CardContent>
    </Card>
  );

  if (!slug) return cardInner;

  // Wrap the whole card in a Link so the entire surface is tappable —
  // blueprint §6.2 touch-target rule is automatically satisfied
  // because the hit area becomes the card footprint (well beyond
  // 44×44). `buildNavHref` preserves `?date=` so historical-date
  // drill-down keeps the user anchored. `group/asset-link` + focus
  // ring className above gives a visible keyboard focus state.
  return (
    <Link
      href={buildNavHref(`/asset/${slug}`, currentDate)}
      className="group/asset-link block rounded-xl outline-none"
      aria-label={`${label} 상세 보기`}
    >
      {cardInner}
    </Link>
  );
}

const intensityPalette: Record<BandIntensity, string> = {
  strong_overweight:
    "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300",
  overweight:
    "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300",
  neutral: "bg-muted text-foreground",
  underweight:
    "bg-amber-500/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300",
  strong_underweight:
    "bg-red-500/10 text-red-700 dark:bg-red-400/10 dark:text-red-300",
};
