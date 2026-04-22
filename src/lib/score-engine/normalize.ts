/**
 * Pure normalization helpers used by the score engine.
 *
 * These functions are intentionally framework-agnostic — no React, no
 * Next.js, no Supabase. They take numbers and return numbers. That
 * makes them easy to unit-test (`normalize.test.ts`) and easy to reuse
 * in later phases (e.g. a backtest replay UI in Phase 3).
 */

/**
 * Sample-standard-deviation Z-Score.
 *
 *   Z = (current - mean) / stddev
 *
 * Edge cases:
 * - A series with fewer than two observations has no meaningful
 *   variance, so we return `NaN`. Callers should translate `NaN` into
 *   a neutral score (see {@link zScoreTo0100}).
 * - A constant series (σ = 0) returns 0 when `current` equals the mean
 *   — there's no deviation to measure — and `NaN` otherwise (you
 *   shouldn't trust a Z-score computed against a window where
 *   everything was identical).
 */
export function computeZScore(series: number[], current: number): number {
  const n = series.length;
  if (n < 2) return NaN;

  const mean = series.reduce((acc, x) => acc + x, 0) / n;
  const variance =
    series.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (n - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) {
    return current === mean ? 0 : NaN;
  }

  return (current - mean) / stdDev;
}

/**
 * Maps a Z-Score onto the 0-100 "favorability" scale used by the
 * product (band boundaries live in {@link "@/lib/utils/score-band"}).
 *
 * Contract (blueprint §4.1):
 *
 *   inverted = false (default, "lower raw value is better")
 *     Z = -3 → 100, Z =  0 → 50, Z = +3 → 0
 *
 *   inverted = true ("higher raw value is better")
 *     Z = -3 →   0, Z =  0 → 50, Z = +3 → 100
 *
 * Formula: `50 + k * z * (50/3)`, clamped to [0, 100], where
 * `k = +1` for inverted and `k = -1` for non-inverted. Linear between
 * ±3σ, flat outside — intentionally rough, not a sigmoid, so a
 * formula revision shows up clearly in the bumped MODEL_VERSION diffs.
 *
 * Non-finite Z (the `NaN` path from {@link computeZScore}) collapses
 * to the neutral score 50 rather than propagating NaN into composites
 * — a single missing indicator shouldn't poison the whole dashboard.
 */
export function zScoreTo0100(z: number, inverted = false): number {
  if (!Number.isFinite(z)) return 50;
  const k = inverted ? 1 : -1;
  const raw = 50 + k * z * (50 / 3);
  return clamp(raw, 0, 100);
}

/**
 * Clamp `value` into `[min, max]`. Exported so the technical- and
 * on-chain-indicator engines (`technical.ts`, `onchain.ts`) can reuse
 * the same bound helper the Z-score mapper already depends on — keeps
 * a single definition of "bounded linear interpolation" across the
 * score engine.
 */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Linear interpolation between `a` and `b` parameterized by `t`.
 *
 *   lerp(a, b, 0) === a
 *   lerp(a, b, 1) === b
 *   lerp(a, b, t) === a + (b - a) * t
 *
 * Does NOT clamp `t` to [0, 1]; callers that want bounded output
 * should wrap with {@link clamp}. This lets piecewise-linear score
 * transforms extrapolate explicitly rather than hide a silent bound.
 *
 * Exported for use across the score engine — Step 3 (`technical.ts`)
 * and Step 4 (`onchain.ts`) both needed the same 1-line helper;
 * pulling it into normalize.ts removes the two private copies that
 * would otherwise drift if one call site's formula ever changed.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
