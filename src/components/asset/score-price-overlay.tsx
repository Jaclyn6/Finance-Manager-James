"use client";

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Combined score + price overlay for `/asset/[slug]` (blueprint §9
 * Step 10, PRD §11.6).
 *
 * Two series on a shared X axis:
 * - Left Y (0–100) : composite score (`score_0_100`).
 * - Right Y ($USD) : the representative ticker's daily close.
 *
 * The tooltip composes both values plus — when a `referenceDate` is
 * provided — the Δ% of the hovered day's close relative to the close
 * on that reference date (PRD §11.6 line 312: "그때 점수 72점 → 이후
 * 30일 +2.3%" semantics).
 *
 * Graceful fallback: if `priceData` is empty we render a score-only
 * line (the score axis only — same semantics as the retired
 * `ScoreTrendLine` from Step 6) so the page still works during the
 * first day of price-ingest bootstrapping or when a ticker simply has
 * no rows.
 */

/**
 * Merged point after `mergeByDate`. Either axis may be null — Recharts
 * interprets `null` as "no point here", which draws a gap rather than
 * a connected-to-zero misreading.
 */
export interface MergedPoint {
  date: string;
  score: number | null;
  price: number | null;
}

export interface ScorePriceOverlayProps {
  /** Pre-fetched ascending-date score series. */
  scoreData: Array<{ snapshot_date: string; score_0_100: number }>;
  /** Pre-fetched ascending-date price series. May be empty. */
  priceData: Array<{ price_date: string; close: number }>;
  /** Rolling window length in days (display label + empty-state text). */
  rangeDays: number;
  /** v1→v2 `MODEL_VERSION` cutover; null/out-of-window skips the line. */
  cutoverDate: string | null;
  /**
   * Optional baseline for Δ% in the tooltip. Typically the
   * `?date=YYYY-MM-DD` query param when the user is scrubbing
   * history. When null, the tooltip shows only the current close, no
   * percent change.
   */
  referenceDate?: string | null;
  /** Display ticker for aria-label + legend. */
  ticker: string;
}

/**
 * Merges score + price rows into a union-by-date series. Dates that
 * appear in only one source get `null` on the other axis.
 *
 * Pure function — exported for unit testing without mounting the
 * chart. Duplicates within a source: the LAST row wins, consistent
 * with the ORDER BY price_date ASC used upstream (a same-day duplicate
 * from upstream dedup failure would keep the most recently inserted
 * row, matching expected "latest wins" behavior).
 */
export function mergeByDate(
  scoreRows: Array<{ snapshot_date: string; score_0_100: number }>,
  priceRows: Array<{ price_date: string; close: number }>,
): MergedPoint[] {
  const byDate = new Map<string, MergedPoint>();
  for (const s of scoreRows) {
    byDate.set(s.snapshot_date, {
      date: s.snapshot_date,
      score: s.score_0_100,
      price: null,
    });
  }
  for (const p of priceRows) {
    const existing = byDate.get(p.price_date);
    if (existing) {
      existing.price = p.close;
    } else {
      byDate.set(p.price_date, {
        date: p.price_date,
        score: null,
        price: p.close,
      });
    }
  }
  return Array.from(byDate.values()).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
}

/**
 * Δ% helper — returns `(price - referencePrice) / referencePrice * 100`.
 *
 * Edge cases (covered by unit tests):
 * - `referencePrice === 0` → `null` (division by zero; not meaningful).
 * - Either input `NaN` or `Infinity` → `null`.
 * - `price === null` or `referencePrice === null` → `null`.
 */
export function computeDeltaPercent(
  price: number | null,
  referencePrice: number | null,
): number | null {
  if (price === null || referencePrice === null) return null;
  if (!Number.isFinite(price) || !Number.isFinite(referencePrice)) return null;
  if (referencePrice === 0) return null;
  return ((price - referencePrice) / referencePrice) * 100;
}

/**
 * Finds the reference close at `referenceDate`. If the exact date
 * isn't present (e.g. weekend in AV data, or selectedDate is a
 * holiday), walks backwards to the nearest earlier price bar — that's
 * the most honest baseline because that's the last close the user
 * could have actually observed. Returns `null` if nothing earlier.
 *
 * Returns null when referenceDate strictly exceeds the latest bar
 * (symmetric with the strictly-before-first-bar null path) — otherwise
 * the tooltip would show a misleading Δ% ≈ 0% across the whole chart
 * because every hovered bar would compare against itself (the last bar).
 */
export function findReferencePrice(
  priceRows: Array<{ price_date: string; close: number }>,
  referenceDate: string | null | undefined,
): number | null {
  if (!referenceDate) return null;
  if (priceRows.length === 0) return null;
  const lastDate = priceRows[priceRows.length - 1].price_date;
  if (referenceDate > lastDate) return null;
  // Rows assumed ASC by date (matches reader contract).
  let match: number | null = null;
  for (const row of priceRows) {
    if (row.price_date <= referenceDate) {
      match = row.close;
    } else {
      break;
    }
  }
  return match;
}

/** Compact US-dollar tick formatter for the right axis. */
function formatPriceTick(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  if (Math.abs(value) >= 10) {
    return `$${value.toFixed(0)}`;
  }
  return `$${value.toFixed(2)}`;
}

interface TooltipPayloadEntry {
  dataKey?: string | number;
  value?: number | string;
  payload?: MergedPoint;
}

function CustomTooltip({
  active,
  label,
  payload,
  ticker,
  referencePrice,
}: {
  active?: boolean;
  label?: string;
  payload?: TooltipPayloadEntry[];
  ticker: string;
  referencePrice: number | null;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const point = payload[0]?.payload;
  const score = point?.score;
  const price = point?.price;
  const delta = computeDeltaPercent(price ?? null, referencePrice);

  return (
    <div
      className="rounded-md border bg-popover p-2 text-xs shadow-md"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="mb-1 font-medium">{label}</div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">점수</span>
          <span className="tabular-nums">
            {typeof score === "number" && Number.isFinite(score)
              ? score.toFixed(1)
              : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">{ticker}</span>
          <span className="tabular-nums">
            {typeof price === "number" && Number.isFinite(price)
              ? formatPriceTick(price)
              : "—"}
          </span>
        </div>
        {delta !== null ? (
          <div className="flex items-center justify-between gap-4 border-t pt-0.5">
            <span className="text-muted-foreground">Δ% (기준일 대비)</span>
            <span
              className={`tabular-nums ${
                delta > 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : delta < 0
                    ? "text-rose-600 dark:text-rose-400"
                    : ""
              }`}
            >
              {delta > 0 ? "+" : ""}
              {delta.toFixed(2)}%
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ScorePriceOverlay({
  scoreData,
  priceData,
  rangeDays,
  cutoverDate,
  referenceDate = null,
  ticker,
}: ScorePriceOverlayProps) {
  if (scoreData.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground md:p-12">
        최근 {rangeDays}일 동안 수집된 점수가 없습니다.
      </div>
    );
  }

  const merged = mergeByDate(scoreData, priceData);
  const isSparse = merged.length < 2;
  const hasPrice = priceData.length > 0;

  const firstDate = merged[0].date;
  const lastDate = merged[merged.length - 1].date;

  const showCutoverLine =
    typeof cutoverDate === "string" &&
    cutoverDate.length > 0 &&
    cutoverDate >= firstDate &&
    cutoverDate <= lastDate;

  const referencePrice = findReferencePrice(priceData, referenceDate);

  // Aria summary. Inherits the aria-label conventions from the retired
  // single-axis `ScoreTrendLine` (Step 6) so screen-reader users get a
  // consistent read of score min/max, latest price, and cutover info.
  const scores = scoreData.map((d) => d.score_0_100);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const latestPrice = priceData.at(-1)?.close;
  const priceFragment =
    typeof latestPrice === "number"
      ? `${ticker} 최근가 ${formatPriceTick(latestPrice)}`
      : `${ticker} 가격 데이터 없음`;
  const cutoverFragment = showCutoverLine
    ? ` ${cutoverDate}에 모델 v2.0.0 전환.`
    : "";
  const ariaLabel = `점수와 ${ticker} 가격 추이. 점수 ${minScore.toFixed(1)}~${maxScore.toFixed(1)}, ${priceFragment}.${cutoverFragment}`;

  return (
    <div className="rounded-2xl border bg-card p-4 md:p-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-heading text-base leading-snug font-medium">
          최근 {rangeDays}일 점수 · {ticker} 추이
        </h2>
        <span className="text-xs text-muted-foreground">
          {scoreData.length}일 기록
        </span>
      </div>
      {/* h-80 chosen over the more common h-72 to give the right-axis
          price ticks vertical room: this is a two-axis ComposedChart
          (score + price) and the extra height prevents the right-side
          tick labels from crowding. */}
      <div
        role="img"
        aria-label={ariaLabel}
        className="h-64 w-full md:h-80"
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={merged}
            margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
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
              minTickGap={40}
            />
            <YAxis
              yAxisId="score"
              orientation="left"
              domain={[0, 100]}
              ticks={[0, 20, 40, 60, 80, 100]}
              tickLine={false}
              axisLine={false}
              className="fill-muted-foreground text-[10px]"
              width={36}
            />
            <YAxis
              yAxisId="price"
              orientation="right"
              domain={["auto", "auto"]}
              tickFormatter={formatPriceTick}
              tickLine={false}
              axisLine={false}
              className="fill-muted-foreground text-[10px]"
              width={48}
              hide={!hasPrice}
            />
            <ReferenceLine
              yAxisId="score"
              y={80}
              stroke="currentColor"
              strokeOpacity={0.15}
            />
            <ReferenceLine
              yAxisId="score"
              y={60}
              stroke="currentColor"
              strokeOpacity={0.15}
            />
            <ReferenceLine
              yAxisId="score"
              y={40}
              stroke="currentColor"
              strokeOpacity={0.15}
            />
            <ReferenceLine
              yAxisId="score"
              y={20}
              stroke="currentColor"
              strokeOpacity={0.15}
            />
            {showCutoverLine ? (
              <ReferenceLine
                yAxisId="score"
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
            {referenceDate &&
            referenceDate >= firstDate &&
            referenceDate <= lastDate ? (
              <ReferenceLine
                yAxisId="score"
                x={referenceDate}
                stroke="var(--brand, currentColor)"
                strokeOpacity={0.35}
                label={{
                  value: "기준일",
                  position: "insideTopLeft",
                  fill: "currentColor",
                  fontSize: 10,
                  opacity: 0.7,
                }}
              />
            ) : null}
            <Tooltip
              content={(props) => (
                <CustomTooltip
                  active={props.active}
                  label={typeof props.label === "string" ? props.label : undefined}
                  payload={
                    props.payload as unknown as
                      | TooltipPayloadEntry[]
                      | undefined
                  }
                  ticker={ticker}
                  referencePrice={referencePrice}
                />
              )}
            />
            {/*
              Palette: `--chart-1` for score, `--chart-2` for price.
              Using the theme's chart tokens (same as
              `category-contribution-bar.tsx`) keeps the two series
              reliably distinct in light + dark mode — the previous
              `var(--brand, currentColor)` + bare `currentColor` pair
              could collapse to the same foreground color in dark mode,
              rendering two indistinguishable lines.
            */}
            <Line
              yAxisId="score"
              type="monotone"
              dataKey="score"
              name="점수"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={isSparse ? { r: 3 } : false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls={false}
            />
            {hasPrice ? (
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="price"
                name={ticker}
                stroke="var(--chart-2)"
                strokeOpacity={0.8}
                strokeWidth={1.5}
                strokeDasharray="4 2"
                dot={false}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
                connectNulls={false}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {/* Compact custom legend — Recharts' default legend is big and
          re-renders awkwardly on mobile. A static swatch row beneath
          the chart is cheaper and integrates with Tailwind tokens. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {/* Swatch mirrors the score Line stroke (`--chart-1`). */}
          <span
            aria-hidden
            className="inline-block h-0.5 w-4 bg-[var(--chart-1)]"
          />
          점수 (0–100, 왼쪽 축)
        </span>
        {hasPrice ? (
          <span className="inline-flex items-center gap-1.5">
            {/* Swatch mirrors the price Line stroke (`--chart-2`), dashed to
                match strokeDasharray="4 2" on the chart line. */}
            <span
              aria-hidden
              className="inline-block h-0.5 w-4 border-t border-dashed"
              style={{ borderColor: "var(--chart-2)" }}
            />
            {ticker} 종가 (오른쪽 축)
          </span>
        ) : (
          <span className="italic">가격 데이터 수집 중</span>
        )}
      </div>
    </div>
  );
}
