"use client";

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";

import type { CategoryName } from "@/lib/score-engine/types";
import { CATEGORY_LABELS_KO } from "@/lib/utils/category-labels";
import { cn } from "@/lib/utils";

/**
 * Stacked horizontal contribution bar — the visual companion to the
 * grouped ContributingIndicators card (blueprint §9 Step 8, PRD §18
 * line 497 "점수 기여 시각화").
 *
 * Renders one horizontal stacked bar whose segments are proportional to
 * each category's `contribution` (score × weight). A colored-dot legend
 * below the bar lists category label + contribution value. Value labels
 * are intentionally NOT drawn INSIDE segments — the card body can be as
 * narrow as ~320px on 375px phones and inside-segment text would clash
 * with short labels at that width.
 *
 * ─ Why a Client Component ───────────────────────────────────────────
 * Recharts reads the DOM for its SVG measurements, so any chart has to
 * run client-side. This wrapper takes a pre-computed shape as its prop
 * so the parent (a Server Component) can await the DB read inside
 * `'use cache'` and this file never imports the admin client. Same
 * pattern as {@link ScoreTrendLine}.
 *
 * ─ a11y ─────────────────────────────────────────────────────────────
 * The outer `<div role="img" aria-label="...">` announces the full
 * breakdown to screen readers (Recharts SVGs are unlabeled by default,
 * which would make this chart invisible to AT users).
 *
 * ─ Color palette ────────────────────────────────────────────────────
 * 6-color palette keyed on `CategoryName`, mapped to the theme's
 * `--chart-1`..`--chart-6` CSS variables (defined in
 * `src/app/globals.css` for both light and dark themes). Using the
 * theme tokens keeps segment hues consistent with the rest of the
 * charting surface and lets the dark-mode palette inherit correct
 * contrast without per-component overrides.
 */

export interface CategoryContributionBarProps {
  /**
   * One row per category, ordered as it should appear on the bar.
   * Parent is responsible for:
   *   1. filtering to categories whose score is non-null,
   *   2. ordering per {@link CATEGORY_DISPLAY_ORDER} (macro, technical,
   *      onchain, sentiment, valuation, regional_overlay).
   */
  rows: CategoryContributionRow[];
}

export interface CategoryContributionRow {
  category: CategoryName;
  /** 0-100 after renormalization — what this category adds to the composite. */
  contribution: number;
}

/**
 * Palette — references the theme's `--chart-1`..`--chart-6` CSS
 * variables defined in `globals.css` (`:root` + `.dark`). Not
 * color-coded by semantics (higher / lower); the LEGEND BELOW carries
 * the value, so color is just a segment-identifier affordance. Using
 * the theme tokens means dark-mode contrast and any future palette
 * rework happens in one place (`globals.css`) not here.
 */
const CATEGORY_COLORS: Record<CategoryName, string> = {
  macro: "var(--chart-1)",
  technical: "var(--chart-2)",
  onchain: "var(--chart-3)",
  sentiment: "var(--chart-4)",
  valuation: "var(--chart-5)",
  regional_overlay: "var(--chart-6)",
};

export function CategoryContributionBar({ rows }: CategoryContributionBarProps) {
  // Filter zero / negative contributions out of the visual bar —
  // a 0-contribution category shows in the legend at the parent level,
  // but drawing a 0-width segment is a Recharts footgun (tooltip
  // alignment breaks). Keep the legend honest though: include them.
  const nonEmpty = rows.filter((r) => Number.isFinite(r.contribution) && r.contribution > 0);

  // Empty state — no category has a positive contribution yet. This is
  // realistic on day 1 when all categories are null-pinned.
  if (nonEmpty.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-center text-xs text-muted-foreground">
        기여도를 계산할 카테고리 점수가 아직 없습니다.
      </div>
    );
  }

  // Shape the data into a single-row BarChart — each category becomes
  // its own `<Bar>` stacked on `stackId="contribution"`. This is the
  // idiomatic Recharts way to draw a stacked horizontal bar. `name` is
  // a plain string used only by the hidden YAxis; the numeric fields
  // share the dict, so the value type is `string | number`.
  const datum: Record<string, string | number> = { name: "composite" };
  for (const row of nonEmpty) {
    datum[row.category] = row.contribution;
  }

  const total = nonEmpty.reduce((acc, r) => acc + r.contribution, 0);

  // Match the visible bar's filtering — never announce "—점" on a
  // malformed row. Non-finite contributions are dropped from the SR
  // read-out just as they are from the drawn bar.
  const ariaLabel = `카테고리별 기여도: ${rows
    .filter((r) => Number.isFinite(r.contribution))
    .map(
      (r) =>
        `${CATEGORY_LABELS_KO[r.category]} ${formatContribution(r.contribution)}점`,
    )
    .join(", ")}. 합계 ${formatContribution(total)}점.`;

  return (
    <div className="space-y-2">
      <div role="img" aria-label={ariaLabel} className="h-10 w-full md:h-12">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={[datum]}
            margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
            barCategoryGap={0}
          >
            {/*
              Hide both axes — this is a decorative segmented bar, not
              a true chart. Ticks and labels would crowd the 40-48px
              height budget. Domain is fixed 0..max so segment widths
              are proportional to contribution.
            */}
            <XAxis type="number" domain={[0, total]} hide />
            <YAxis type="category" dataKey="name" hide />
            {nonEmpty.map((row) => (
              <Bar
                key={row.category}
                dataKey={row.category}
                stackId="contribution"
                fill={CATEGORY_COLORS[row.category]}
                isAnimationActive={false}
                // Uniform 4px radius on every segment. Recharts draws
                // the radius per-segment (not per-stack-endpoint), so
                // every segment gets the same rounded corners. At this
                // bar height (40-48px) the slight visual join between
                // segments is imperceptible and gives the bar a softer
                // edge treatment than raw rectangles.
                radius={4}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/*
        Legend below the bar. Wraps on `<md` so 375px viewports never
        horizontal-scroll. Each item is a colored dot + Korean label +
        contribution value in tabular-nums so values align as a column.
      */}
      <ul
        className={cn(
          "flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground",
        )}
        aria-hidden="true"
      >
        {rows.map((row) => (
          <li key={row.category} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block size-2 shrink-0 rounded-sm"
              style={{ backgroundColor: CATEGORY_COLORS[row.category] }}
            />
            <span className="text-foreground">
              {CATEGORY_LABELS_KO[row.category]}
            </span>
            <span>{formatContribution(row.contribution)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatContribution(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return (Math.round(n * 10) / 10).toFixed(1);
}
