import { Card, CardContent } from "@/components/ui/card";
import { INDICATOR_CONFIG } from "@/lib/score-engine/weights";
import { ASSET_LABELS } from "@/lib/utils/asset-labels";
import { cn } from "@/lib/utils";
import type { Json, Tables } from "@/types/database";

/**
 * One row on the `/changelog` page — a snapshot-to-snapshot delta
 * record from `score_changelog`.
 *
 * Highlights `band_changed = true` rows visually (border-l accent +
 * 'band' badge) because PRD §11.3 specifically calls out band
 * transitions as the high-value signal — the family users should
 * spot them at a glance when scrolling.
 *
 * Top movers: renders the up-to-3 indicators that shifted most in
 * weighted contribution (written by `computeTopMovers` during the
 * cron run, see `src/lib/score-engine/top-movers.ts`). Each mover
 * shows the indicator's Korean label (from `INDICATOR_CONFIG`) and
 * the signed delta. A row with no `top_movers` (first-ever snapshot
 * per asset, or a legacy row) renders without the movers block.
 */
export interface ChangelogRowProps {
  row: Tables<"score_changelog">;
}

interface ParsedMover {
  key: string;
  delta: number;
}

export function ChangelogRow({ row }: ChangelogRowProps) {
  const movers = parseTopMovers(row.top_movers);
  const assetLabel = ASSET_LABELS[row.asset_type] ?? row.asset_type;

  return (
    <Card
      size="sm"
      className={cn(
        "relative overflow-hidden",
        row.band_changed && "border-l-4 border-l-brand",
      )}
    >
      <CardContent className="flex flex-col gap-3 p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {assetLabel}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {row.change_date}
            </span>
          </div>
          {row.band_changed && (
            <span className="rounded-full bg-brand-subtle px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-dark">
              밴드 전환
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <span className="text-muted-foreground">
            {row.previous_band ?? "—"}
          </span>
          <span aria-hidden className="text-muted-foreground">
            →
          </span>
          <span className="font-medium text-foreground">
            {row.current_band}
          </span>
          <DeltaBadge delta={row.delta} />
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {formatScore(row.previous_score)} → {formatScore(row.current_score)}
          </span>
        </div>

        {movers.length > 0 && (
          <div className="border-t pt-3">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              주요 변동 지표
            </p>
            <ul className="space-y-1">
              {movers.map((mover) => {
                const label =
                  INDICATOR_CONFIG[mover.key]?.descriptionKo ?? mover.key;
                return (
                  <li
                    key={mover.key}
                    className="flex items-baseline justify-between gap-3 text-xs"
                  >
                    <span className="text-muted-foreground">{label}</span>
                    <span
                      className={cn(
                        "tabular-nums",
                        mover.delta > 0
                          ? "text-emerald-700 dark:text-emerald-300"
                          : mover.delta < 0
                            ? "text-red-700 dark:text-red-300"
                            : "text-muted-foreground",
                      )}
                    >
                      {formatSignedDelta(mover.delta)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta == null) return null;
  const positive = delta > 0;
  const zero = delta === 0;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
        zero
          ? "bg-muted text-muted-foreground"
          : positive
            ? "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
            : "bg-red-500/10 text-red-700 dark:bg-red-400/10 dark:text-red-300",
      )}
    >
      {formatSignedDelta(delta)}
    </span>
  );
}

function parseTopMovers(raw: Json): ParsedMover[] {
  if (!raw || !Array.isArray(raw)) return [];
  const rows: ParsedMover[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const v = item as Record<string, unknown>;
    const key = v.key;
    const delta = v.delta;
    if (
      typeof key !== "string" ||
      typeof delta !== "number" ||
      !Number.isFinite(delta)
    )
      continue;
    rows.push({ key, delta });
  }
  return rows;
}

function formatScore(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return (Math.round(n * 10) / 10).toFixed(1);
}

function formatSignedDelta(delta: number): string {
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const magnitude = Math.abs(delta);
  return `${sign}${(Math.round(magnitude * 10) / 10).toFixed(1)}`;
}
