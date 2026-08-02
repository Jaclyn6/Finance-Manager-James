/**
 * Pure time-series helpers for the advisor's direction inputs
 * (HY-spread "꺾임", VIX cooling). Kept OUTSIDE `src/lib/data/` so
 * Vitest can exercise them without the `server-only` import chain
 * that `lib/data/*` carries — same extraction rationale as
 * `fred-parse.ts`.
 */

/** One point of a raw indicator time series (FRED observation date). */
export interface IndicatorSeriesPoint {
  /** ISO `YYYY-MM-DD` observation date. */
  date: string;
  value: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Collapses a chronological series to one point per calendar date,
 * last-write-wins. Same-date duplicates arise when one date holds a
 * row per model_version (cutover days) — callers order so the row
 * that should win sorts last — and would also arise from any future
 * sub-daily writer. Direction math wants exactly one closing reading
 * per day.
 */
export function collapseToDaily(
  series: ReadonlyArray<IndicatorSeriesPoint>,
): IndicatorSeriesPoint[] {
  const out: IndicatorSeriesPoint[] = [];
  for (const point of series) {
    if (out.length > 0 && out[out.length - 1].date === point.date) {
      out[out.length - 1] = { ...point };
    } else {
      out.push({ ...point });
    }
  }
  return out;
}

/**
 * Minimum observations before a percentile rank is meaningful. ~1
 * trading year: below this, "5년 상위 X%" would be computed from a
 * few weeks of history and mislead — return null instead (loud-
 * failure tenet: absent context should look absent).
 */
export const PERCENTILE_MIN_SAMPLES = 250;

/**
 * Percentile rank of `value` within the series' historical values:
 * the fraction of observations ≤ value, in [0, 1]. 0.88 means the
 * current reading is higher than 88% of the window — the weather
 * strip renders that as "5년 상위 12%". Null when the series is
 * thinner than `minSamples` or the value is not finite.
 */
export function percentileRank(
  series: ReadonlyArray<IndicatorSeriesPoint>,
  value: number,
  minSamples = PERCENTILE_MIN_SAMPLES,
): number | null {
  if (!Number.isFinite(value)) return null;
  const values = series
    .map((p) => p.value)
    .filter((v) => Number.isFinite(v));
  if (values.length < minSamples) return null;
  let atOrBelow = 0;
  for (const v of values) {
    if (v <= value) atOrBelow++;
  }
  return atOrBelow / values.length;
}

/**
 * Two-sided Korean phrasing for a percentile rank (share of history
 * at or below the value). One-sided "상위 (1-p)%" made historically
 * LOW readings render as "상위 99%" — danger-sounding copy next to an
 * 안정 note (UX 실사 2026-08-03). Rules:
 * - 0.45 ≤ p ≤ 0.55 → "중간권" (either-sided % at the boundary flips
 *   wording at the same displayed number — say neither);
 * - p > 0.55 → "상위 X%", p < 0.45 → "하위 X%";
 * - a tail that rounds to 0% reads as a glitch → "1% 미만".
 * Callers prepend their own window label ("5년", "기간 내").
 */
export function formatPercentileBandKo(percentile: number): string {
  const p = Math.max(0, Math.min(1, percentile));
  if (p >= 0.45 && p <= 0.55) return "중간권";
  if (p > 0.55) {
    const top = (1 - p) * 100;
    return top < 1 ? "상위 1% 미만" : `상위 ${top.toFixed(0)}%`;
  }
  const bottom = p * 100;
  return bottom < 1 ? "하위 1% 미만" : `하위 ${bottom.toFixed(0)}%`;
}

/**
 * Week-over-week change of a series: latest value minus the value at
 * the most recent observation at least `lookbackDays` calendar days
 * older than the latest. Null when the series is too thin to cover
 * the lookback — a thin series means "direction unknown", never 0.
 *
 * Assumes chronological (oldest-first) input — the shape
 * `getIndicatorSeries` returns.
 */
export function computeWowDelta(
  series: ReadonlyArray<IndicatorSeriesPoint>,
  lookbackDays = 7,
): number | null {
  if (series.length < 2) return null;
  const latest = series[series.length - 1];
  const latestMs = Date.parse(`${latest.date}T00:00:00Z`);
  if (!Number.isFinite(latestMs)) return null;
  const cutoffMs = latestMs - lookbackDays * MS_PER_DAY;

  for (let i = series.length - 2; i >= 0; i--) {
    const ms = Date.parse(`${series[i].date}T00:00:00Z`);
    if (Number.isFinite(ms) && ms <= cutoffMs) {
      return latest.value - series[i].value;
    }
  }
  return null;
}

/**
 * Percentile rank + the actual span of series the rank was computed
 * over. Consumers need the span because a requested window is NOT a
 * coverage guarantee — e.g. BAMLH0A0HYM2 collection starts 2023-07,
 * so a "5년" window request yields a ~3y series and labeling it 5년
 * would overclaim (UX 실사 2026-08-03).
 */
export interface WindowedPercentile {
  rank: number;
  /** Calendar days between the series' first and last observation. */
  coverageDays: number;
}

/**
 * Korean window label for a percentile context line. Claims the full
 * requested window ("5년") only when coverage reaches ≥90% of it;
 * otherwise states the floored actual span ("3년"), floored at 1년
 * (percentileRank's sample floor keeps sub-year daily series from
 * reaching here anyway).
 */
export function formatWindowLabelKo(
  coverageDays: number,
  fullWindowDays: number,
): string {
  if (coverageDays >= fullWindowDays * 0.9) {
    return `${Math.round(fullWindowDays / 365)}년`;
  }
  return `${Math.max(1, Math.floor(coverageDays / 365))}년`;
}
