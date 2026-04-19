import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ASSET_LABELS } from "@/lib/utils/asset-labels";
import { cn } from "@/lib/utils";
import type { Tables } from "@/types/database";

/**
 * Top band-transition events in the last 14 days.
 *
 * PRD §11.6 framing: "최근 변화". Caller filters the raw
 * `getChangelogAroundDate(today, 14)` output by `band_changed=true` and
 * caps the list at 3 (highest |delta| first — `score_changelog` is
 * pre-ordered newest-first, not delta-first; see the sort in the
 * caller). This component is a dumb renderer so it stays a Server
 * Component and never leaks `new Date()` into the cached tree.
 *
 * When the list is empty — which is the common case in the first days
 * after a fresh Phase 1 deploy (the very first cron run has no prior
 * snapshot to diff against) — render a quiet empty state rather than
 * hiding the section. Hiding would leave users wondering whether the
 * feature exists at all; the empty message teaches the affordance.
 */
export interface RecentChangesProps {
  rows: Tables<"score_changelog">[];
}

export function RecentChanges({ rows }: RecentChangesProps) {
  return (
    <Card>
      <CardHeader>
        {/*
          Semantic `<h2>` rather than shadcn's `CardTitle` (which renders
          a `<div>`) so this section is reachable via the screen-reader
          heading outline — pairs with the `<h2>` "자산군별 상태" above
          (WCAG 2.4.6 Headings and Labels / 1.3.1 Info and Relationships).
          Same visual classes as `CardTitle` so the Kraken look is
          preserved.
        */}
        <h2 className="font-heading text-base leading-snug font-medium">
          최근 밴드 전환
        </h2>
        <p className="text-xs text-muted-foreground">
          최근 14일 범위에서 자산군별 상태가 바뀐 기록입니다.
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            최근 14일 내 밴드 전환 기록이 없습니다. 새 데이터가 수집되면
            여기에 표시됩니다.
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-1 border-b border-border/60 pb-3 last:border-0 last:pb-0 md:flex-row md:items-center md:justify-between"
              >
                <div className="flex flex-col gap-0.5 md:flex-row md:items-center md:gap-3">
                  <span className="text-sm font-semibold text-foreground">
                    {ASSET_LABELS[row.asset_type]}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {row.change_date}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">
                    {row.previous_band ?? "—"}
                  </span>
                  <span aria-hidden className="text-muted-foreground">
                    →
                  </span>
                  <span className="font-medium text-foreground">
                    {row.current_band}
                  </span>
                  {row.delta != null && (
                    <span
                      className={cn(
                        "ml-1 rounded-full px-2 py-0.5 text-xs font-medium",
                        row.delta > 0
                          ? "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
                          : row.delta < 0
                            ? "bg-red-500/10 text-red-700 dark:bg-red-400/10 dark:text-red-300"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {formatDelta(row.delta)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function formatDelta(delta: number): string {
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const magnitude = Math.abs(delta);
  const rounded = Math.round(magnitude * 10) / 10;
  return `${sign}${rounded.toFixed(1)}`;
}
