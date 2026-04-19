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
   * Rolling window length in days — used only for the chart's empty
   * state message. Default 90.
   */
  rangeDays?: number;
}

export function ScoreTrendLine({ data, rangeDays = 90 }: ScoreTrendLineProps) {
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
      {/* `h-64 md:h-72` gives Recharts a deterministic height — without
          it, the ResponsiveContainer reports 0 on first measure and
          the chart never draws (a long-standing Recharts footgun). */}
      <div className="h-64 w-full md:h-72">
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
