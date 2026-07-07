import type { DailyClose, DrawdownState } from "./types";

/**
 * Drawdown math for the advisor engine — pure, deterministic.
 *
 * Given a window of daily closes (caller decides the window; the
 * product uses ~52 weeks), computes:
 *
 *  - where the current price sits vs the window peak (the "discount"
 *    magnitude the verdict engine judges), and
 *  - the window's maximum drawdown (MDD) — deepest peak-to-trough
 *    decline anywhere in the window — as historical context ("현재
 *    낙폭이 이번 1년 MDD 대비 어느 수준인가").
 *
 * Input hygiene: rows with non-finite closes or closes <= 0 are
 * dropped (a zero/negative close is upstream garbage and would break
 * the ratio math); the series is sorted by date. Returns null when
 * fewer than MIN_SAMPLES valid rows remain — a two-point series can
 * technically produce a drawdown but the number would be noise, and
 * the loud-failure tenet prefers "insufficient data" over a confident
 * verdict on garbage.
 */

/** Minimum valid samples before drawdown output is meaningful. */
export const MIN_SAMPLES = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function computeDrawdownState(
  series: ReadonlyArray<DailyClose>,
): DrawdownState | null {
  const cleaned = series
    .filter((p) => Number.isFinite(p.close) && p.close > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (cleaned.length < MIN_SAMPLES) return null;

  let peakClose = -Infinity;
  let peakDate = "";
  let maxDrawdownPct = 0;
  let maxDrawdownTroughDate = cleaned[0]!.date;

  for (const point of cleaned) {
    if (point.close > peakClose) {
      peakClose = point.close;
      peakDate = point.date;
    }
    const dd = 1 - point.close / peakClose;
    if (dd > maxDrawdownPct) {
      maxDrawdownPct = dd;
      maxDrawdownTroughDate = point.date;
    }
  }

  const last = cleaned[cleaned.length - 1]!;
  const drawdownPct = 1 - last.close / peakClose;

  const peakMs = Date.parse(`${peakDate}T00:00:00Z`);
  const currentMs = Date.parse(`${last.date}T00:00:00Z`);
  const daysSincePeak =
    Number.isFinite(peakMs) && Number.isFinite(currentMs)
      ? Math.max(0, Math.round((currentMs - peakMs) / MS_PER_DAY))
      : 0;

  return {
    currentDate: last.date,
    currentClose: last.close,
    peakDate,
    peakClose,
    drawdownPct,
    daysSincePeak,
    maxDrawdownPct,
    maxDrawdownTroughDate,
    sampleCount: cleaned.length,
  };
}
