"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Score trend line chart — `/asset/[slug]` 최근 N일 점수 추이.
 *
 * Blueprint §5 requirement: "Every chart must be wrapped in
 * `<ResponsiveContainer>` (v2.2) — fixed-pixel widths break on mobile
 * viewports". This component honors that: the outer ResponsiveContainer
 * fills its parent and the chart scales fluidly from 320px mobile to
 * 960px desktop.
 *
 * Must be a Client Component because Recharts reads the DOM for its
 * SVG measurements. Keeping it as a thin Client wrapper around a
 * pre-fetched `data` prop means the parent (a Server Component) does
 * the Supabase read inside `'use cache'` and this file never imports
 * the admin client.
 *
 * Reference lines at 80 / 60 / 40 / 20 match the band thresholds from
 * `score-band.ts` — so the user can visually map the trend to 강한 비중
 * 확대 / 비중 확대 / 유지 / 비중 축소 / 강한 비중 축소 without having to
 * know the numeric cutoffs.
 */
export interface ScoreTrendLineProps {
  /** Pre-fetched ascending-date series. `score_0_100` in each row. */
  data: { snapshot_date: string; score_0_100: number }[];
  /**
   * Rolling window length in days. Used to label the chart header
   * ("최근 N일 점수 추이") AND the empty-state fallback ("최근 N일
   * 동안 수집된 점수가 없습니다"). Callers pass the window they
   * fetched with so the visible framing matches the data. Default 90.
   */
  rangeDays?: number;
  /**
   * `YYYY-MM-DD` — the v1→v2 `MODEL_VERSION` cutover date, read by
   * the parent Server Component from `getCurrentModelCutoverDate()`
   * and passed in as a plain string (no client-side DB call).
   *
   * When provided AND the cutover falls inside the rendered window,
   * a vertical Recharts `ReferenceLine` marks the v2 transition so
   * the user can visually distinguish v1-era scores (pre-line) from
   * v2-era scores (post-line). See blueprint §3.4:
   *
   * > `/asset/[slug]` trend line renders a vertical separator at
   * > the v2 cutover date.
   *
   * Omit (or pass `null`) to render without a separator — used for
   * test fixtures and the fresh-DB fallback case where migration 0009
   * hasn't run.
   */
  cutoverDate?: string | null;
}

export function ScoreTrendLine({
  data,
  rangeDays = 90,
  cutoverDate = null,
}: ScoreTrendLineProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground md:p-12">
        최근 {rangeDays}일 동안 수집된 점수가 없습니다.
      </div>
    );
  }

  // Single-point series renders as a lone dot — still informative
  // ("we have one data point so far") but Recharts defaults to hiding
  // dots on LineChart. Force them on so the user actually sees the
  // data they have.
  const isSparse = data.length < 2;

  // Summarize the series for screen readers. Recharts produces an
  // inline <svg> with no accessible name by default (WCAG 1.1.1 /
  // 4.1.2), which would leave AT users hearing nothing about the
  // trend. A text description on the chart container fills that gap
  // — minimum, latest, and range are the three facts a SR user needs
  // to understand "is the trend favorable right now?".
  const scores = data.map((d) => d.score_0_100);
  const latestScore = scores[scores.length - 1];
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const baseAriaSummary = isSparse
    ? `최근 ${rangeDays}일 점수 추이. 데이터 1개 — ${data[0].snapshot_date} 기준 ${latestScore.toFixed(1)}점.`
    : `최근 ${rangeDays}일 점수 추이. ${data.length}개 데이터. 최저 ${minScore.toFixed(1)}점, 최고 ${maxScore.toFixed(1)}점, 가장 최근 ${latestScore.toFixed(1)}점.`;

  // Only render the v1→v2 cutover separator when the cutover actually
  // falls inside the rendered window. A cutover entirely before the
  // window starts (data already all-v2) or entirely after it ends
  // (all-v1 historical view) draws a line at the chart edge that
  // looks like a misleading data marker. Skipping in those cases
  // keeps the chart honest. String comparison works because dates are
  // ISO `YYYY-MM-DD`, which is lexicographically sortable.
  const firstDate = data[0].snapshot_date;
  const lastDate = data[data.length - 1].snapshot_date;
  const showCutoverLine =
    typeof cutoverDate === "string" &&
    cutoverDate.length > 0 &&
    cutoverDate >= firstDate &&
    cutoverDate <= lastDate;

  // Append the cutover note to the aria-label so screen-reader users
  // hear the same visual discontinuity information the ReferenceLine
  // conveys to sighted users. WCAG 1.1.1 — non-text content needs a
  // text alternative of equivalent purpose.
  const ariaSummary = showCutoverLine
    ? `${baseAriaSummary} ${cutoverDate}에 모델 v2.0.0 전환.`
    : baseAriaSummary;

  return (
    <div className="rounded-2xl border bg-card p-4 md:p-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-heading text-base leading-snug font-medium">
          최근 {rangeDays}일 점수 추이
        </h2>
        <span className="text-xs text-muted-foreground">
          {data.length}일 기록
        </span>
      </div>
      {/* `role="img"` + `aria-label` give this SVG an accessible name
          so screen readers announce the summary instead of skipping
          past silently. `h-64 md:h-72` gives Recharts a deterministic
          height — without it, the ResponsiveContainer reports 0 on
          first measure and the chart never draws (a long-standing
          Recharts footgun). */}
      <div
        role="img"
        aria-label={ariaSummary}
        className="h-64 w-full md:h-72"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              className="stroke-border"
            />
            <XAxis
              dataKey="snapshot_date"
              tickLine={false}
              axisLine={false}
              className="fill-muted-foreground text-[10px]"
              minTickGap={40}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 20, 40, 60, 80, 100]}
              tickLine={false}
              axisLine={false}
              className="fill-muted-foreground text-[10px]"
              // Needs ≥36px so three-digit "100" renders fully without
              // clipping the right edge into the chart area.
              width={36}
            />
            {/* Band threshold guidelines — same cuts as score-band.ts. */}
            <ReferenceLine y={80} stroke="currentColor" strokeOpacity={0.15} />
            <ReferenceLine y={60} stroke="currentColor" strokeOpacity={0.15} />
            <ReferenceLine y={40} stroke="currentColor" strokeOpacity={0.15} />
            <ReferenceLine y={20} stroke="currentColor" strokeOpacity={0.15} />
            {/*
              v1→v2 `MODEL_VERSION` cutover separator (blueprint §3.4,
              §4.4 Step 4). Dashed so it's visually distinct from the
              solid horizontal band guidelines above. Label stays at
              the top of the chart so it doesn't collide with the
              score line in the middle 40–60 band where scores
              typically cluster.
            */}
            {showCutoverLine ? (
              <ReferenceLine
                x={cutoverDate ?? undefined}
                stroke="currentColor"
                strokeOpacity={0.45}
                strokeDasharray="3 3"
                label={{
                  value: "v2 전환",
                  position: "top",
                  fill: "currentColor",
                  fontSize: 10,
                  opacity: 0.7,
                }}
              />
            ) : null}
            <Tooltip
              contentStyle={{
                borderRadius: 8,
                border: "1px solid var(--border)",
                backgroundColor: "var(--popover)",
                fontSize: 12,
              }}
              formatter={(value) => {
                // Recharts narrows `value` to `ValueType | undefined`
                // so we normalize: non-numbers render as "—" rather
                // than crashing the tooltip.
                if (typeof value !== "number" || !Number.isFinite(value)) {
                  return ["—", "점수"];
                }
                return [(Math.round(value * 10) / 10).toFixed(1), "점수"];
              }}
              labelFormatter={(label) => String(label)}
            />
            <Line
              type="monotone"
              dataKey="score_0_100"
              stroke="var(--brand, currentColor)"
              strokeWidth={2}
              dot={isSparse ? { r: 3 } : false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
