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
