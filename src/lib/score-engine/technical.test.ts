import { describe, expect, it } from "vitest";

import {
  bollingerBands,
  bollingerToScore,
  disparity,
  disparityToScore,
  exponentialMovingAverage,
  exponentialMovingAverageSeries,
  isDislocated,
  macd,
  macdBullishCrossWithin,
  macdSeries,
  macdToScore,
  rollingStdDev,
  rsi,
  rsiToScore,
  simpleMovingAverage,
  type MacdResult,
} from "./technical";

// ---------------------------------------------------------------------------
// Building-block helpers
// ---------------------------------------------------------------------------

describe("simpleMovingAverage", () => {
  it("computes SMA(5) on [1,2,3,4,5] as 3.0", () => {
    expect(simpleMovingAverage([1, 2, 3, 4, 5], 5)).toBe(3);
  });

  it("uses the LAST `period` values, not the first", () => {
    // Last 3 of [1..10] are [8,9,10] → mean 9.
    expect(simpleMovingAverage([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3)).toBe(9);
  });

  it("returns null when insufficient data", () => {
    expect(simpleMovingAverage([1, 2], 5)).toBeNull();
  });

  it("returns null for zero or negative period", () => {
    expect(simpleMovingAverage([1, 2, 3], 0)).toBeNull();
    expect(simpleMovingAverage([1, 2, 3], -1)).toBeNull();
  });
});

describe("exponentialMovingAverage", () => {
  it("seeds with SMA over the first `period` closes, then smooths", () => {
    // closes = [2,4,6,8,10], period = 3
    //   seed = SMA(2,4,6) = 4; k = 2/(3+1) = 0.5
    //   i=3: ema = 8*0.5 + 4*0.5 = 6
    //   i=4: ema = 10*0.5 + 6*0.5 = 8
    expect(exponentialMovingAverage([2, 4, 6, 8, 10], 3)).toBe(8);
  });

  it("equals the SMA seed when closes.length === period", () => {
    // No smoothing steps — just the seed.
    expect(exponentialMovingAverage([2, 4, 6], 3)).toBe(4);
  });

  it("returns null when insufficient data", () => {
    expect(exponentialMovingAverage([1, 2], 5)).toBeNull();
  });
});

describe("exponentialMovingAverageSeries", () => {
  it("null-pads the first `period - 1` entries, then emits the SMA seed", () => {
    const out = exponentialMovingAverageSeries([2, 4, 6, 8, 10], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBe(4); // seed = SMA(2,4,6)
    expect(out[3]).toBe(6);
    expect(out[4]).toBe(8);
  });

  it("returns all nulls when insufficient data", () => {
    expect(exponentialMovingAverageSeries([1, 2], 5)).toEqual([null, null]);
  });
});

describe("rollingStdDev", () => {
  it("returns 0 on a flat window", () => {
    expect(rollingStdDev([5, 5, 5, 5, 5], 5)).toBe(0);
  });

  it("computes sample stddev over the last `period` closes", () => {
    // [1,2,3,4,5]: mean=3, sq deviations sum = 10, sample var = 10/4 = 2.5
    // σ = sqrt(2.5) ≈ 1.5811388
    const result = rollingStdDev([1, 2, 3, 4, 5], 5);
    expect(result).not.toBeNull();
    expect(result as number).toBeCloseTo(Math.sqrt(2.5), 7);
  });

  it("returns null when insufficient data", () => {
    expect(rollingStdDev([1, 2], 5)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RSI
// ---------------------------------------------------------------------------

describe("rsi", () => {
  it("returns 100 on a strictly increasing series (no down moves)", () => {
    const closes = Array.from({ length: 15 }, (_, i) => i + 1);
    expect(rsi(closes, 14)).toBe(100);
  });

  it("returns 0 on a strictly decreasing series (no up moves)", () => {
    const closes = Array.from({ length: 15 }, (_, i) => 15 - i);
    expect(rsi(closes, 14)).toBe(0);
  });

  it("returns ~50 on alternating ±1 moves (equal gains and losses)", () => {
    // 15 closes: [10,11,10,11,...,10] gives 7 gains of 1 and 7 losses of 1.
    const closes: number[] = [];
    for (let i = 0; i < 15; i++) closes.push(i % 2 === 0 ? 10 : 11);
    expect(rsi(closes, 14)).toBeCloseTo(50, 5);
  });

  it("returns null when closes.length < period + 1", () => {
    // Need 15 closes for RSI(14); 10 is insufficient.
    expect(rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 14)).toBeNull();
  });

  it("returns null for zero period", () => {
    expect(rsi([1, 2, 3], 0)).toBeNull();
  });

  it("returns 50 (neutral) on a flat / zero-volatility series", () => {
    // All closes identical → avgGain=0, avgLoss=0. No directional
    // movement means neutral, NOT overbought. A previous buggy branch
    // order hit `if (avgLoss === 0) return 100` first and mis-classified
    // halted / untraded symbols as extreme overbought.
    const closes = Array.from({ length: 20 }, () => 100);
    expect(rsi(closes, 14)).toBe(50);
  });
});

describe("rsiToScore (piecewise per blueprint §4.3)", () => {
  it("is continuous at the RSI = 30 boundary (no step discontinuity)", () => {
    // Piecewise slopes are -20/30 below 30 and -25/20 above — ~0.67 and
    // 1.25 respectively — so within 0.01 of the breakpoint the score
    // differs by at most ~0.02 from the boundary value. `toBeCloseTo(x, 1)`
    // checks |diff| < 0.05, which catches a step discontinuity but
    // tolerates the expected linear slope difference.
    const below = rsiToScore(29.99);
    const at = rsiToScore(30);
    const above = rsiToScore(30.01);
    expect(below).toBeCloseTo(at, 1);
    expect(above).toBeCloseTo(at, 1);
    // Exact value at the breakpoint.
    expect(at).toBe(80);
  });

  it("is continuous at the RSI = 70 boundary (no step discontinuity)", () => {
    const below = rsiToScore(69.99);
    const at = rsiToScore(70);
    const above = rsiToScore(70.01);
    expect(below).toBeCloseTo(at, 1);
    expect(above).toBeCloseTo(at, 1);
    // Exact value at the breakpoint.
    expect(at).toBe(30);
  });

  it("maps endpoints: 0→100, 30→80, 50→55, 70→30, 100→5", () => {
    expect(rsiToScore(0)).toBe(100);
    expect(rsiToScore(30)).toBe(80);
    expect(rsiToScore(50)).toBe(55);
    expect(rsiToScore(70)).toBe(30);
    expect(rsiToScore(100)).toBe(5);
  });

  it("clamps beyond [0, 100] to endpoint scores", () => {
    expect(rsiToScore(-10)).toBe(100);
    expect(rsiToScore(150)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// MACD
// ---------------------------------------------------------------------------

describe("macd / macdSeries", () => {
  it("returns null for too-short input", () => {
    // Need at least slowPeriod + signalPeriod - 1 = 26 + 9 - 1 = 34 closes.
    const closes = Array.from({ length: 33 }, (_, i) => 100 + i);
    expect(macd(closes)).toBeNull();
  });

  it("produces positive MACD on a clean linear uptrend", () => {
    // On a perfectly linear uptrend the MACD line stabilises at a
    // positive constant (fast EMA leads, slow EMA lags) and the signal
    // EMA converges to that constant — histogram → 0 asymptotically.
    // So we only assert the directional invariant (MACD > 0) here; the
    // accelerating-uptrend test below covers the histogram > 0 case.
    const closes = Array.from({ length: 50 }, (_, i) => 100 + i);
    const result = macd(closes);
    expect(result).not.toBeNull();
    const r = result as MacdResult;
    expect(r.macd).toBeGreaterThan(0);
  });

  it("produces positive histogram on an accelerating uptrend", () => {
    // Quadratic growth → slope of the close series keeps increasing
    // → MACD line keeps climbing → signal EMA lags below → histogram
    // stays strictly positive.
    const closes = Array.from({ length: 50 }, (_, i) => 100 + i * i * 0.05);
    const result = macd(closes);
    expect(result).not.toBeNull();
    const r = result as MacdResult;
    expect(r.macd).toBeGreaterThan(0);
    expect(r.histogram).toBeGreaterThan(0);
    expect(r.macd).toBeGreaterThan(r.signal);
  });

  it("produces negative MACD on a clean downtrend", () => {
    const closes = Array.from({ length: 50 }, (_, i) => 150 - i);
    const result = macd(closes);
    expect(result).not.toBeNull();
    const r = result as MacdResult;
    expect(r.macd).toBeLessThan(0);
  });

  it("emits nulls before the signal-line SMA seed is available", () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + i);
    const series = macdSeries(closes);
    // First 33 entries (indices 0..32) must be null; index 33 is the
    // signal-EMA seed (slowPeriod=26 + signalPeriod=9 - 2 = 33).
    for (let i = 0; i < 33; i++) expect(series[i]).toBeNull();
    expect(series[33]).not.toBeNull();
  });
});

describe("macdToScore", () => {
  it("returns null when history has fewer than 2 observations", () => {
    const current: MacdResult = { macd: 1, signal: 0, histogram: 1 };
    expect(macdToScore(current, [])).toBeNull();
    expect(macdToScore(current, [0.5])).toBeNull();
  });

  it("returns > 50 when current histogram is above the historical mean", () => {
    const current: MacdResult = { macd: 2, signal: 1, histogram: 3 };
    const history = [0, 0.1, -0.1, 0.2, -0.2, 0.05, -0.05];
    const score = macdToScore(current, history);
    expect(score).not.toBeNull();
    expect(score as number).toBeGreaterThan(50);
  });

  it("returns < 50 when current histogram is below the historical mean", () => {
    const current: MacdResult = { macd: -2, signal: 1, histogram: -3 };
    const history = [0, 0.1, -0.1, 0.2, -0.2, 0.05, -0.05];
    const score = macdToScore(current, history);
    expect(score).not.toBeNull();
    expect(score as number).toBeLessThan(50);
  });

  it("internally caps the rolling-stddev window at 90 entries per blueprint §4.3", () => {
    // Caller passes 200 entries; result should be identical to passing
    // only the last 90. Anything older is ignored per §4.3.
    const current: MacdResult = { macd: 1, signal: 0, histogram: 0.5 };
    const last90 = Array.from({ length: 90 }, (_, i) =>
      Math.sin(i / 10) * 0.5,
    );
    // Prepend 110 distinctly-distributed old values that would shift
    // the mean/stddev if naively included.
    const ancientNoise = Array.from({ length: 110 }, (_, i) =>
      Math.cos(i / 5) * 10,
    );
    const fullHistory = [...ancientNoise, ...last90];

    const scoreFull = macdToScore(current, fullHistory);
    const scoreCapped = macdToScore(current, last90);
    expect(scoreFull).toBe(scoreCapped);
  });
});

describe("macdBullishCrossWithin", () => {
  /**
   * Fixtures use a "flat-then-down-then-up" shape. The leading flat
   * segment lets the fast + slow EMAs anchor at the same level so the
   * subsequent decline cleanly drives macd < signal (signal lags above),
   * and the reversal produces a visible, well-positioned cross. A raw
   * monotonic linear series won't work: the fast/slow EMAs converge to
   * a constant slope × lag, macd stabilises, and the signal-EMA seed
   * (SMA over the first 9 macd values) coincides with macd at the seed
   * index to within floating-point noise — so the only "cross" that
   * shows up is the FP-noise seed artifact at the very first signal
   * bar, not a trading-signal cross.
   */

  it("returns false on an all-null series", () => {
    const series: (MacdResult | null)[] = [null, null, null, null];
    expect(macdBullishCrossWithin(series, 7)).toBe(false);
  });

  it("detects a bullish cross within lookback = 7", () => {
    // flat(30) + down(12) + up(8) → the cross lands near the end.
    const closes: number[] = [];
    for (let i = 0; i < 30; i++) closes.push(200);
    for (let i = 0; i < 12; i++) closes.push(199 - i * 3);
    const lastDown = closes[closes.length - 1];
    for (let i = 0; i < 8; i++) closes.push(lastDown + (i + 1) * 5);
    const series = macdSeries(closes);
    expect(macdBullishCrossWithin(series, 7)).toBe(true);
  });

  it("returns false when there is no bullish cross at all (flat + downtrend)", () => {
    // flat(30) + down(30): macd declines and stays below signal
    // throughout; signal lags above. No cross anywhere.
    const closes: number[] = [];
    for (let i = 0; i < 30; i++) closes.push(200);
    for (let i = 0; i < 30; i++) closes.push(199 - i * 2);
    const series = macdSeries(closes);
    expect(macdBullishCrossWithin(series, 7)).toBe(false);
    // Stronger: no cross even over the whole visible tail.
    expect(macdBullishCrossWithin(series, 100)).toBe(false);
  });

  it("returns false when the cross happened BEFORE the lookback window", () => {
    // flat(30) + down(12) + up(18): the cross happens ~14 bars before
    // the end. lookback = 7 is outside that window; lookback = 60 covers
    // the whole tail.
    const closes: number[] = [];
    for (let i = 0; i < 30; i++) closes.push(200);
    for (let i = 0; i < 12; i++) closes.push(199 - i * 3);
    const lastDown = closes[closes.length - 1];
    for (let i = 0; i < 18; i++) closes.push(lastDown + (i + 1) * 5);
    const series = macdSeries(closes);
    // Sanity: with lookback covering the whole tail, we DO see the cross.
    expect(macdBullishCrossWithin(series, 60)).toBe(true);
    // With lookback = 7, the cross is outside the window.
    expect(macdBullishCrossWithin(series, 7)).toBe(false);
  });

  it("returns false for non-positive lookback", () => {
    const series: (MacdResult | null)[] = [
      { macd: -1, signal: 0, histogram: -1 },
      { macd: 1, signal: 0, histogram: 1 },
    ];
    expect(macdBullishCrossWithin(series, 0)).toBe(false);
    expect(macdBullishCrossWithin(series, -5)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bollinger Bands
// ---------------------------------------------------------------------------

describe("bollingerBands", () => {
  it("collapses to the middle on a constant series (σ = 0)", () => {
    const closes = Array.from({ length: 20 }, () => 100);
    const bands = bollingerBands(closes, 20, 2);
    expect(bands).not.toBeNull();
    const b = bands as NonNullable<typeof bands>;
    expect(b.middle).toBe(100);
    expect(b.upper).toBe(100);
    expect(b.lower).toBe(100);
  });

  it("returns null when insufficient data", () => {
    expect(bollingerBands([1, 2, 3], 20)).toBeNull();
  });

  it("widens symmetrically around the SMA", () => {
    const closes = Array.from({ length: 20 }, (_, i) => i + 1);
    const bands = bollingerBands(closes, 20, 2);
    expect(bands).not.toBeNull();
    const b = bands as NonNullable<typeof bands>;
    // SMA([1..20]) = 10.5
    expect(b.middle).toBe(10.5);
    expect(b.upper - b.middle).toBeCloseTo(b.middle - b.lower, 10);
  });
});

describe("bollingerToScore", () => {
  it("returns 0 at or above the upper band", () => {
    const bands = { middle: 100, upper: 110, lower: 90 };
    expect(bollingerToScore(110, bands)).toBe(0);
    expect(bollingerToScore(115, bands)).toBe(0);
  });

  it("returns 100 at or below the lower band", () => {
    const bands = { middle: 100, upper: 110, lower: 90 };
    expect(bollingerToScore(90, bands)).toBe(100);
    expect(bollingerToScore(85, bands)).toBe(100);
  });

  it("returns 50 at the middle (SMA)", () => {
    const bands = { middle: 100, upper: 110, lower: 90 };
    expect(bollingerToScore(100, bands)).toBe(50);
  });

  it("returns 50 on a collapsed band envelope (σ = 0)", () => {
    const bands = { middle: 100, upper: 100, lower: 100 };
    expect(bollingerToScore(100, bands)).toBe(50);
  });

  it("interpolates linearly between middle and upper", () => {
    const bands = { middle: 100, upper: 110, lower: 90 };
    // Halfway from middle to upper → halfway from 50 to 0 = 25.
    expect(bollingerToScore(105, bands)).toBe(25);
  });

  it("interpolates linearly between lower and middle", () => {
    const bands = { middle: 100, upper: 110, lower: 90 };
    // Halfway from lower to middle → halfway from 100 to 50 = 75.
    expect(bollingerToScore(95, bands)).toBe(75);
  });

  it("is monotonically decreasing as currentClose rises within the lower half", () => {
    // A previous implementation flipped the lerp t-argument so that
    // close=91 scored 55 and close=99 scored 95 — the opposite of the
    // intended direction. The midpoint test above (close=95 → 75) passes
    // regardless of inversion due to symmetry. These off-center fixtures
    // pin down the monotonicity explicitly.
    const bands = { middle: 100, upper: 110, lower: 90 };
    // close near lower → close to 100 (oversold = favorable)
    expect(bollingerToScore(91, bands)).toBeCloseTo(95, 5);
    // close near middle → close to 50 (neutral)
    expect(bollingerToScore(99, bands)).toBeCloseTo(55, 5);
    // Strict monotonicity: as close rises, score should fall.
    expect(bollingerToScore(91, bands)).toBeGreaterThan(
      bollingerToScore(95, bands),
    );
    expect(bollingerToScore(95, bands)).toBeGreaterThan(
      bollingerToScore(99, bands),
    );
  });

  it("is monotonically decreasing as currentClose rises within the upper half", () => {
    // Sanity pair for the upper half too, so a future accidental
    // inversion there would also be caught.
    const bands = { middle: 100, upper: 110, lower: 90 };
    expect(bollingerToScore(101, bands)).toBeGreaterThan(
      bollingerToScore(105, bands),
    );
    expect(bollingerToScore(105, bands)).toBeGreaterThan(
      bollingerToScore(109, bands),
    );
  });
});

// ---------------------------------------------------------------------------
// Disparity
// ---------------------------------------------------------------------------

describe("disparity", () => {
  it("computes price/ma200 - 1 correctly", () => {
    expect(disparity(75, 100)).toBeCloseTo(-0.25, 10);
    expect(disparity(100, 100)).toBe(0);
    expect(disparity(125, 100)).toBeCloseTo(0.25, 10);
  });

  it("returns null when ma200 is null", () => {
    expect(disparity(100, null)).toBeNull();
  });

  it("returns null when ma200 is zero (would divide by zero)", () => {
    expect(disparity(100, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Alpha Vantage `compact` (100-bar) regression — 2026-04-25
//
// AV moved `outputsize=full` behind a paid plan; free TIME_SERIES_DAILY
// returns 100 bars. Phase 2's MA(200) + Disparity must gracefully null
// on that input, not throw and not silently produce an MA-of-fewer-bars.
// ---------------------------------------------------------------------------
describe("MA(200) + Disparity on a 100-bar AV `compact` window", () => {
  // 100 strictly-increasing closes — same shape AV sends back to a
  // free key calling outputsize=compact. Anything stable / monotonic
  // works; the point is `closes.length === 100 < 200`.
  const compactCloses = Array.from({ length: 100 }, (_, i) => 100 + i);

  it("MA(200) returns null on a 100-bar input (does NOT silently average fewer bars)", () => {
    expect(simpleMovingAverage(compactCloses, 200)).toBeNull();
  });

  it("MA(50) still computes on the same 100-bar input (sanity — only 200 should null)", () => {
    expect(simpleMovingAverage(compactCloses, 50)).not.toBeNull();
  });

  it("Disparity is null when MA200 is null (null-propagation per blueprint §2.2 tenet 1)", () => {
    const latestClose = compactCloses[compactCloses.length - 1];
    const ma200 = simpleMovingAverage(compactCloses, 200);
    expect(ma200).toBeNull();
    expect(disparity(latestClose, ma200)).toBeNull();
  });
});

describe("disparityToScore (blueprint §4.3)", () => {
  it("hits the -0.25 boundary exactly at score 85", () => {
    expect(disparityToScore(-0.25)).toBeCloseTo(85, 10);
  });

  it("clamps -0.30 (beyond boundary) to 85", () => {
    expect(disparityToScore(-0.3)).toBeCloseTo(85, 10);
    expect(disparityToScore(-1)).toBeCloseTo(85, 10);
  });

  it("returns 50 at disparity 0 (price at trend)", () => {
    expect(disparityToScore(0)).toBe(50);
  });

  it("returns 15 at +0.25 and clamps beyond to 15", () => {
    expect(disparityToScore(0.25)).toBeCloseTo(15, 10);
    expect(disparityToScore(0.5)).toBeCloseTo(15, 10);
  });
});

describe("isDislocated", () => {
  it("is true at exactly -0.25 (boundary is inclusive)", () => {
    expect(isDislocated(-0.25)).toBe(true);
  });

  it("is true at -0.30 (more dislocated than the threshold)", () => {
    expect(isDislocated(-0.3)).toBe(true);
  });

  it("is false at -0.24 (just above the threshold)", () => {
    expect(isDislocated(-0.24)).toBe(false);
  });

  it("is false at 0 (price at trend)", () => {
    expect(isDislocated(0)).toBe(false);
  });

  it("honors a custom threshold override", () => {
    expect(isDislocated(-0.15, -0.1)).toBe(true);
    expect(isDislocated(-0.05, -0.1)).toBe(false);
  });
});
