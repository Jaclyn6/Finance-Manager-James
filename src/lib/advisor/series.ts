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
