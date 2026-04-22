/**
 * Pure-math technical-indicator engine.
 *
 * Consumed by:
 * - The per-snapshot score pipeline (Step 6 — `composite.ts` extension)
 * - The signal alignment engine (Step 7.5 — `signals.ts` extension), via
 *   the exported flag helpers `macdBullishCrossWithin` and `isDislocated`
 *   (blueprint §4.5: `MOMENTUM_TURN` and `DISLOCATION` inputs)
 * - The Phase 1 / Phase 2 backfill tooling under `scripts/`, which is why
 *   this file is pure-math — no `import "server-only"`, no Next.js, no
 *   Supabase, no React.
 *
 * Normalization formulas copy the blueprint §4.3 spec verbatim:
 * - RSI: piecewise linear 0→30→50→70→100 mapping to 100→80→55→30→5
 *   (PRD §9.1 calibration; oversold = high favorability)
 * - MACD: sign × magnitude of (MACD − Signal) histogram, magnitude-
 *   normalized by the 90-day rolling stddev of the histogram itself,
 *   then piped through `zScoreTo0100(z, inverted=true)` because a
 *   higher histogram means a more bullish momentum, which is more
 *   favorable.
 * - Disparity (`price/MA200 − 1`): linear-clamped [-0.25, +0.25] →
 *   [85, 15]. Dislocation (price 25% below trend) → 85 (high favorability
 *   for mean reversion); price 25% above trend → 15.
 *
 * TA-Lib reference choices (reviewer: cross-check against TA-Lib docs
 * or the `technicalindicators` npm package on the fixtures below):
 * - **RSI** uses Wilder's smoothing (α = 1/period, not α = 2/(period+1)).
 *   Seeds the first RSI after exactly `period` changes with the simple
 *   average of the first `period` gains and losses. This matches
 *   TA-Lib's `RSI` (default, `RSI_EMA` mode), NOT `RSI_SMA`.
 * - **MACD** uses standard EMA (α = 2/(period+1)). Seeds each EMA with
 *   an SMA over the first `period` closes. This matches TA-Lib's
 *   `MACD` (default, `MACD_EMA` mode).
 * - **Bollinger** uses sample standard deviation (denominator `n - 1`),
 *   consistent with `normalize.ts`'s `computeZScore`. The default
 *   multiplier is `2σ`, per Bollinger's original 1983 paper.
 *
 * All exports return `null` — never throw — on valid-but-insufficient
 * input (matches the Phase 1 `findObservationAsOf` convention and lets
 * upstream code render a "waiting for data" state instead of crashing).
 */

import { clamp, computeZScore, zScoreTo0100 } from "./normalize";

// ---------------------------------------------------------------------------
// Building-block helpers
// ---------------------------------------------------------------------------

/**
 * Simple moving average over the most recent `period` closes.
 * Returns `null` if `closes.length < period`.
 */
export function simpleMovingAverage(
  closes: number[],
  period: number,
): number | null {
  if (period <= 0) return null;
  if (closes.length < period) return null;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    sum += closes[i];
  }
  return sum / period;
}

/**
 * Exponential moving average with standard smoothing factor
 * `k = 2 / (period + 1)`. Seeds with an SMA over the first `period`
 * closes — the industry-standard approach TA-Lib uses in `MACD_EMA`
 * mode. Returns `null` if `closes.length < period`.
 */
export function exponentialMovingAverage(
  closes: number[],
  period: number,
): number | null {
  if (period <= 0) return null;
  if (closes.length < period) return null;

  // Seed with SMA of first `period` closes.
  let ema = 0;
  for (let i = 0; i < period; i++) ema += closes[i];
  ema /= period;

  const k = 2 / (period + 1);
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

/**
 * Full EMA series — one value per input close. The first `period - 1`
 * entries are `null` (EMA undefined until the SMA seed), index
 * `period - 1` holds the SMA seed, and subsequent indices hold the
 * standard EMA recursion. Consumed by `macdSeries` to compute the
 * signal-line EMA over the MACD-line series.
 */
export function exponentialMovingAverageSeries(
  closes: number[],
  period: number,
): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (period <= 0 || closes.length < period) return out;

  let ema = 0;
  for (let i = 0; i < period; i++) ema += closes[i];
  ema /= period;
  out[period - 1] = ema;

  const k = 2 / (period + 1);
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

/**
 * Sample standard deviation of the most recent `period` closes.
 * Matches `computeZScore`'s convention (denominator `n - 1`). Returns
 * `null` if `closes.length < period` or `period < 2` (no variance in
 * a single observation).
 */
export function rollingStdDev(
  closes: number[],
  period: number,
): number | null {
  if (period < 2) return null;
  if (closes.length < period) return null;

  const start = closes.length - period;
  let sum = 0;
  for (let i = start; i < closes.length; i++) sum += closes[i];
  const mean = sum / period;

  let sqSum = 0;
  for (let i = start; i < closes.length; i++) {
    sqSum += (closes[i] - mean) ** 2;
  }
  return Math.sqrt(sqSum / (period - 1));
}

// ---------------------------------------------------------------------------
// RSI (Relative Strength Index)
// ---------------------------------------------------------------------------

/**
 * RSI(period) using Wilder's smoothing (α = 1/period). Requires
 * `closes.length >= period + 1` to form `period` changes; returns
 * `null` otherwise.
 *
 * Algorithm:
 * 1. Compute `period` changes from the first `period + 1` closes.
 * 2. Seed `avgGain` / `avgLoss` with the simple average of gains and
 *    losses over that first window.
 * 3. For each subsequent change, apply Wilder's recurrence:
 *    `avg = (avg_prev * (period - 1) + current) / period`.
 * 4. `RS = avgGain / avgLoss`, `RSI = 100 - 100 / (1 + RS)`.
 *    If `avgLoss === 0` → RSI = 100 (no downward movement).
 *    If `avgGain === 0` AND `avgLoss > 0` → RSI = 0.
 *
 * Reference: Wilder, J.W. (1978), "New Concepts in Technical Trading
 * Systems". Matches TA-Lib `RSI_EMA` mode.
 */
export function rsi(closes: number[], period: number): number | null {
  if (period <= 0) return null;
  if (closes.length < period + 1) return null;

  // Seed: simple average of first `period` gains and losses.
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gainSum += change;
    else lossSum -= change; // change <= 0, so -change >= 0
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  // Wilder smoothing for each subsequent close.
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Map raw RSI to a 0-100 favorability score per blueprint §4.3
 * (derived from PRD §9.1 calibration):
 *
 * ```
 * RSI  0 ..  30  →  100 →  80   (oversold = high favorability)
 * RSI 30 ..  50  →   80 →  55   (neutral-low)
 * RSI 50 ..  70  →   55 →  30   (neutral-high)
 * RSI 70 .. 100  →   30 →   5   (overbought = low favorability)
 * ```
 *
 * Piecewise-linear; the breakpoints at 30, 50, and 70 are continuous
 * (same value at the boundary from either side). Inputs below 0 are
 * clamped at 100; above 100 clamped at 5.
 */
export function rsiToScore(rsiValue: number): number {
  if (!Number.isFinite(rsiValue)) return 50;
  const r = clamp(rsiValue, 0, 100);
  if (r <= 30) return lerp(100, 80, r / 30);
  if (r <= 50) return lerp(80, 55, (r - 30) / 20);
  if (r <= 70) return lerp(55, 30, (r - 50) / 20);
  return lerp(30, 5, (r - 70) / 30);
}

// ---------------------------------------------------------------------------
// MACD (Moving Average Convergence Divergence)
// ---------------------------------------------------------------------------

export interface MacdResult {
  /** `EMA(fast) − EMA(slow)` at this bar. */
  macd: number;
  /** `EMA(signalPeriod)` of the MACD series. */
  signal: number;
  /** `macd − signal`. Positive = bullish momentum, negative = bearish. */
  histogram: number;
}

/**
 * MACD at the last close. Returns `null` if there aren't enough closes
 * to compute the signal EMA (`slowPeriod + signalPeriod - 1` minimum).
 */
export function macd(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdResult | null {
  const series = macdSeries(closes, fastPeriod, slowPeriod, signalPeriod);
  const last = series[series.length - 1];
  return last ?? null;
}

/**
 * Full MACD series, one entry per input close. Entries before the
 * signal line's first available value are `null`. Exposes the full
 * history so callers can:
 * - Detect bullish/bearish crosses (see `macdBullishCrossWithin`).
 * - Build the histogram history for `macdToScore`'s rolling-stdev
 *   magnitude normalization.
 */
export function macdSeries(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): (MacdResult | null)[] {
  const n = closes.length;
  const out: (MacdResult | null)[] = new Array(n).fill(null);
  if (fastPeriod <= 0 || slowPeriod <= 0 || signalPeriod <= 0) return out;
  if (fastPeriod >= slowPeriod) return out;

  const fastSeries = exponentialMovingAverageSeries(closes, fastPeriod);
  const slowSeries = exponentialMovingAverageSeries(closes, slowPeriod);

  // MACD line is defined starting at index `slowPeriod - 1` (both EMAs
  // have a value). For the signal EMA we need its own SMA seed over
  // `signalPeriod` MACD-line values, i.e. starting at
  // `slowPeriod - 1 + signalPeriod - 1 = slowPeriod + signalPeriod - 2`.
  const macdLine: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const f = fastSeries[i];
    const s = slowSeries[i];
    if (f === null || s === null) continue;
    macdLine[i] = f - s;
  }

  // Find the first non-null MACD index.
  const firstMacdIdx = slowPeriod - 1;
  if (n < firstMacdIdx + signalPeriod) return out;

  // Seed the signal EMA with an SMA over the first `signalPeriod`
  // values of the MACD line.
  let signalSum = 0;
  for (let i = firstMacdIdx; i < firstMacdIdx + signalPeriod; i++) {
    const v = macdLine[i];
    if (v === null) return out; // defensive; shouldn't happen
    signalSum += v;
  }
  let signalEma = signalSum / signalPeriod;
  const signalSeedIdx = firstMacdIdx + signalPeriod - 1;
  {
    const m = macdLine[signalSeedIdx];
    if (m !== null) {
      out[signalSeedIdx] = {
        macd: m,
        signal: signalEma,
        histogram: m - signalEma,
      };
    }
  }

  const k = 2 / (signalPeriod + 1);
  for (let i = signalSeedIdx + 1; i < n; i++) {
    const m = macdLine[i];
    if (m === null) continue;
    signalEma = m * k + signalEma * (1 - k);
    out[i] = { macd: m, signal: signalEma, histogram: m - signalEma };
  }

  return out;
}

/**
 * MACD score per blueprint §4.3: sign × magnitude of the current
 * histogram, magnitude-normalized by the 90-day rolling stddev of
 * the histogram series, then mapped via `zScoreTo0100(z, true)` —
 * inverted because a larger positive histogram is more bullish and
 * therefore more favorable.
 *
 * `histogramHistory` should be the histogram values excluding the
 * current bar. Returns `null` if fewer than 2 history values (no
 * meaningful variance).
 */
export function macdToScore(
  current: MacdResult,
  histogramHistory: number[],
): number | null {
  if (histogramHistory.length < 2) return null;
  const z = computeZScore(histogramHistory, current.histogram);
  return zScoreTo0100(z, true);
}

/**
 * Returns `true` if the MACD crossed ABOVE its signal line within the
 * last `lookbackDays` bars. A cross is defined as:
 *   `previous.macd <= previous.signal AND current.macd > current.signal`.
 *
 * Drives the `MOMENTUM_TURN` signal (blueprint §4.5, `N = 7`). Ignores
 * `null` entries and `null`-adjacent transitions (a cross requires
 * valid MacdResult on both sides of the transition).
 */
export function macdBullishCrossWithin(
  series: (MacdResult | null)[],
  lookbackDays: number,
): boolean {
  if (lookbackDays <= 0) return false;
  const n = series.length;
  // Check transitions ending at index (n-lookbackDays) .. (n-1).
  const start = Math.max(1, n - lookbackDays);
  for (let i = start; i < n; i++) {
    const prev = series[i - 1];
    const curr = series[i];
    if (prev === null || curr === null) continue;
    if (prev.macd <= prev.signal && curr.macd > curr.signal) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Bollinger Bands
// ---------------------------------------------------------------------------

export interface BollingerResult {
  /** SMA over the window — the "middle" band. */
  middle: number;
  /** `middle + stdDevMultiplier * σ`. */
  upper: number;
  /** `middle − stdDevMultiplier * σ`. */
  lower: number;
}

/**
 * Bollinger Bands(period, stdDevMultiplier). Returns `null` if
 * `closes.length < period`. On a constant series (σ = 0) all three
 * bands collapse to the same value, which is the correct degenerate
 * answer.
 */
export function bollingerBands(
  closes: number[],
  period = 20,
  stdDevMultiplier = 2,
): BollingerResult | null {
  const middle = simpleMovingAverage(closes, period);
  if (middle === null) return null;
  const sigma = rollingStdDev(closes, period);
  if (sigma === null) return null;
  return {
    middle,
    upper: middle + stdDevMultiplier * sigma,
    lower: middle - stdDevMultiplier * sigma,
  };
}

/**
 * Score the current close against a Bollinger band envelope:
 *
 * ```
 *   close ≥ upper  →   0   (max overbought, unfavorable)
 *   close = middle →  50   (neutral)
 *   close ≤ lower  → 100   (max oversold, favorable)
 * ```
 *
 * Linearly interpolated within each half-band; clamped at extremes.
 * If the bands have collapsed (upper == lower == middle, i.e. a flat
 * series), returns 50.
 */
export function bollingerToScore(
  currentClose: number,
  bands: BollingerResult,
): number {
  const { middle, upper, lower } = bands;
  if (upper === lower) return 50; // degenerate flat series
  if (currentClose >= upper) return 0;
  if (currentClose <= lower) return 100;
  if (currentClose >= middle) {
    // Map [middle, upper] → [50, 0].
    return lerp(50, 0, (currentClose - middle) / (upper - middle));
  }
  // Map [lower, middle] → [100, 50].
  return lerp(100, 50, (middle - currentClose) / (middle - lower));
}

// ---------------------------------------------------------------------------
// Disparity (price vs 200-day moving average)
// ---------------------------------------------------------------------------

/**
 * Disparity = `close / ma200 − 1`. Positive = price above the trend;
 * negative = below. Returns `null` if `ma200` is `null` or `0`
 * (division undefined).
 */
export function disparity(
  currentClose: number,
  ma200: number | null,
): number | null {
  if (ma200 === null) return null;
  if (ma200 === 0) return null;
  return currentClose / ma200 - 1;
}

/**
 * Score disparity per blueprint §4.3: linear-clamped
 * `[-0.25, +0.25] → [85, 15]`; beyond the endpoints clamped.
 *
 * - `-0.25` (price 25% below MA200) → `85` (high favorability —
 *   classic dislocation / mean-reversion opportunity)
 * - ` 0.00`                          → `50` (at trend, neutral)
 * - `+0.25`                          → `15`
 */
export function disparityToScore(disparityValue: number): number {
  if (!Number.isFinite(disparityValue)) return 50;
  const d = clamp(disparityValue, -0.25, 0.25);
  // Map [-0.25, +0.25] → [85, 15] linearly.
  //   score = 85 + (d - (-0.25)) / (0.25 - (-0.25)) * (15 - 85)
  //         = 85 + (d + 0.25) / 0.5 * -70
  //         = 85 - 140 * (d + 0.25)
  return 85 - 140 * (d + 0.25);
}

/**
 * Hard boolean: is disparity at or below the `DISLOCATION` threshold?
 * Blueprint §4.5: `DISLOCATION = SPY.disparity ≤ -0.25 || QQQ.disparity
 * ≤ -0.25`. Default `threshold = -0.25` matches the spec; parameterised
 * so a signal-tuning sweep in Phase 3 can revisit without code churn.
 */
export function isDislocated(
  disparityValue: number,
  threshold = -0.25,
): boolean {
  return disparityValue <= threshold;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
