import { Card, CardContent } from "@/components/ui/card";
import { StalenessBadge } from "@/components/shared/staleness-badge";
import { cn } from "@/lib/utils";
import { scoreToBand, type BandIntensity } from "@/lib/utils/score-band";
import type { Tables } from "@/types/database";

/**
 * The "오늘 투자 환경" hero card on the dashboard.
 *
 * PRD §11.1 target: "홈 화면에서 5초 내 현재 상태를 이해". That's why the
 * score is rendered at `text-5xl`/`md:text-6xl` and the band label sits
 * directly beneath in a color-coded pill — the two highest-value
 * signals get the most visual weight. Everything else (snapshot date,
 * model version, staleness) is intentionally quiet.
 *
 * Takes the `common` composite specifically — the caller in
 * `dashboard/page.tsx` extracts it from `getLatestCompositeSnapshots()`
 * by asset_type. If no `common` row exists (first-ever run, or all
 * cron runs failed), the caller renders a fallback empty state instead
 * of this component.
 *
 * Mobile-first: card padding `p-6 md:p-10` per blueprint §6.2 — tighter
 * on 375px phones where every pixel of vertical space counts, roomier
 * on desktop where it's read at arm's length.
 */
export interface CompositeStateCardProps {
  snapshot: Tables<"composite_snapshots">;
}

export function CompositeStateCard({ snapshot }: CompositeStateCardProps) {
  const band = scoreToBand(snapshot.score_0_100);
  const score = Math.round(snapshot.score_0_100 * 10) / 10;

  return (
    <Card className="p-6 md:p-10">
      <CardContent className="flex flex-col gap-4 p-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">오늘 투자 환경</p>
            <p className="mt-1 text-sm text-muted-foreground">
              매크로·기술적·온체인 지표가 수렴해 보여주는 전체 상태
            </p>
          </div>
          <StalenessBadge
            fetchStatus={snapshot.fetch_status}
            snapshotDate={snapshot.snapshot_date}
          />
        </div>

        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <span
            className="font-bold leading-none tracking-tight text-foreground"
            style={{ fontSize: "clamp(2.5rem, 10vw, 4rem)" }}
          >
            {score.toFixed(1)}
          </span>
          <span
            className={cn(
              "rounded-full px-3 py-1 text-sm font-semibold",
              intensityPalette[band.intensity],
            )}
          >
            {band.label}
          </span>
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{snapshot.snapshot_date}</span>
          <span aria-hidden>·</span>
          <span>모델 {snapshot.model_version}</span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Band-intensity → Tailwind palette. Kept local because the mapping
 * is visual (hero-scale, bigger pills) and differs from the compact
 * pill used in `asset-card.tsx` — a cross-file shared map would
 * over-unify two visually distinct states.
 */
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
