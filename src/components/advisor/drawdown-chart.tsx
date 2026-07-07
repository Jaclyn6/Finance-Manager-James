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

import type { DailyClose, DrawdownState } from "@/lib/advisor/types";

/**
 * 52-week drawdown chart for the advisor evidence view.
 *
 * One close-price line over the advisor's judgment window, annotated
 * with the numbers the verdict actually used: a horizontal line at the
 * window peak, a vertical marker on the peak date, and a dashed
 * vertical marker on the MDD trough date. The tooltip shows each day's
 * close plus its distance from the peak — the same "how deep is the
 * discount" framing as the verdict card.
 *
 * No currency symbol on the axis: the representative tickers span USD
 * (SPY, GLD, BTC) and KRW (005930.KS), and pinning "$" to a 70,000-won
 * Samsung close would be wrong. Bare numbers + the ticker in the
 * heading are unambiguous.
 */
export interface DrawdownChartProps {
  series: DailyClose[];
  /** Null when the series was too thin — chart renders without markers. */
  drawdown: DrawdownState | null;
  ticker: string;
}

const compactTick = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const fullNumber = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

function formatTick(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return compactTick.format(value);
}

function formatClose(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return fullNumber.format(value);
}

interface TooltipPayloadEntry {
  payload?: DailyClose;
}

function DrawdownTooltip({
  active,
  label,
  payload,
  peakClose,
}: {
  active?: boolean;
  label?: string;
  payload?: TooltipPayloadEntry[];
  peakClose: number | null;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const close = payload[0]?.payload?.close;
  const fromPeak =
    typeof close === "number" && peakClose !== null && peakClose > 0
      ? ((close - peakClose) / peakClose) * 100
      : null;

  return (
    <div
      className="rounded-md border bg-popover p-2 text-xs shadow-md"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="mb-1 font-medium">{label}</div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">종가</span>
          <span className="tabular-nums">
            {typeof close === "number" ? formatClose(close) : "—"}
          </span>
        </div>
        {fromPeak !== null ? (
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">고점 대비</span>
            <span
              className={`tabular-nums ${
                fromPeak < 0 ? "text-rose-600 dark:text-rose-400" : ""
              }`}
            >
              {fromPeak > 0 ? "+" : ""}
              {fromPeak.toFixed(1)}%
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function DrawdownChart({ series, drawdown, ticker }: DrawdownChartProps) {
  if (series.length < 2) {
    return (
      <div className="flex h-56 items-center justify-center rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
        낙폭을 그리기에 가격 데이터가 부족합니다. 수집이 쌓이면 표시됩니다.
      </div>
    );
  }

  const firstDate = series[0].date;
  const lastDate = series[series.length - 1].date;
  const peakClose = drawdown?.peakClose ?? null;

  const inRange = (d: string | undefined): d is string =>
    typeof d === "string" && d >= firstDate && d <= lastDate;

  const ariaLabel = drawdown
    ? `${ticker} 최근 ${series.length}일 종가 추이. 고점 ${drawdown.peakDate} 대비 현재 ${(drawdown.drawdownPct * 100).toFixed(1)}% 하락, 기간 내 최대 낙폭 ${(drawdown.maxDrawdownPct * 100).toFixed(1)}%.`
    : `${ticker} 최근 ${series.length}일 종가 추이.`;

  return (
    <div className="rounded-2xl border bg-card p-4 md:p-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-heading text-base leading-snug font-medium">
          52주 낙폭 · {ticker}
        </h3>
        <span className="text-xs text-muted-foreground">
          {series.length}일 기록
        </span>
      </div>
      <div role="img" aria-label={ariaLabel} className="h-56 w-full md:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={series}
            margin={{ top: 16, right: 16, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              className="stroke-border"
            />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              className="fill-muted-foreground text-[10px]"
              minTickGap={48}
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={formatTick}
              tickLine={false}
              axisLine={false}
              className="fill-muted-foreground text-[10px]"
              width={44}
            />
            {peakClose !== null ? (
              <ReferenceLine
                y={peakClose}
                stroke="currentColor"
                strokeOpacity={0.3}
                strokeDasharray="3 3"
                label={{
                  value: "52주 고점",
                  position: "insideTopRight",
                  fill: "currentColor",
                  fontSize: 10,
                  opacity: 0.7,
                }}
              />
            ) : null}
            {inRange(drawdown?.peakDate) ? (
              <ReferenceLine
                x={drawdown?.peakDate}
                stroke="var(--chart-2)"
                strokeOpacity={0.5}
                label={{
                  value: "고점",
                  position: "top",
                  fill: "currentColor",
                  fontSize: 10,
                  opacity: 0.7,
                }}
              />
            ) : null}
            {inRange(drawdown?.maxDrawdownTroughDate) ? (
              <ReferenceLine
                x={drawdown?.maxDrawdownTroughDate}
                stroke="currentColor"
                strokeOpacity={0.35}
                strokeDasharray="4 2"
                label={{
                  value: "최대 낙폭",
                  position: "insideBottomLeft",
                  fill: "currentColor",
                  fontSize: 10,
                  opacity: 0.7,
                }}
              />
            ) : null}
            <Tooltip
              content={(props) => (
                <DrawdownTooltip
                  active={props.active}
                  label={
                    typeof props.label === "string" ? props.label : undefined
                  }
                  payload={
                    props.payload as unknown as
                      | TooltipPayloadEntry[]
                      | undefined
                  }
                  peakClose={peakClose}
                />
              )}
            />
            <Line
              type="monotone"
              dataKey="close"
              name={ticker}
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {drawdown ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            현재 낙폭{" "}
            <strong className="font-semibold text-foreground">
              −{(drawdown.drawdownPct * 100).toFixed(1)}%
            </strong>
          </span>
          <span aria-hidden>·</span>
          <span>고점 이후 {drawdown.daysSincePeak}일</span>
          <span aria-hidden>·</span>
          <span>
            기간 내 최대 낙폭 −{(drawdown.maxDrawdownPct * 100).toFixed(1)}% (
            {drawdown.maxDrawdownTroughDate})
          </span>
        </div>
      ) : null}
    </div>
  );
}
