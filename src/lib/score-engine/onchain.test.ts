import { describe, expect, it } from "vitest";

import {
  ETF_FLOW_SCORE_WINDOW,
  cryptoFearGreedToScore,
  etfFlowToScore,
  isCapitulation,
  isCryptoUndervalued,
  mergeEtfFlowHistory,
  mvrvZScoreToScore,
  soprToScore,
} from "./onchain";

// ---------------------------------------------------------------------------
// MVRV Z-Score
// ---------------------------------------------------------------------------

describe("mvrvZScoreToScore", () => {
  // Anchor-point interpretation of blueprint §4.3:
  //   mvrvZ ≤  0 → 100 (flat floor)
  //   mvrvZ 0..3 → lerp 100 → 80
  //   mvrvZ 3..7 → lerp  80 → 40
  //   mvrvZ 7..10 → lerp 40 → 10
  //   mvrvZ ≥ 10 →  10 (flat ceiling)

  it("clamps at 100 below the capitulation floor (mvrvZ = -1)", () => {
    expect(mvrvZScoreToScore(-1)).toBe(100);
  });

  it("returns 100 at the lower anchor mvrvZ = 0", () => {
    expect(mvrvZScoreToScore(0)).toBe(100);
  });

  it("lerps to the midpoint between 100 and 80 at mvrvZ = 1.5", () => {
    // lerp(100, 80, 1.5/3) = lerp(100, 80, 0.5) = 90
    expect(mvrvZScoreToScore(1.5)).toBe(90);
  });

  it("returns 80 at the mid anchor mvrvZ = 3", () => {
    expect(mvrvZScoreToScore(3)).toBe(80);
  });

  it("lerps to 60 at the midpoint between 3 and 7", () => {
    // lerp(80, 40, (5-3)/4) = lerp(80, 40, 0.5) = 60
    expect(mvrvZScoreToScore(5)).toBe(60);
  });

  it("returns 40 at the upper anchor mvrvZ = 7", () => {
    expect(mvrvZScoreToScore(7)).toBe(40);
  });

  it("lerps to 10 at the extrapolated floor mvrvZ = 10", () => {
    // lerp(40, 10, (10-7)/3) = lerp(40, 10, 1) = 10
    expect(mvrvZScoreToScore(10)).toBe(10);
  });

  it("clamps at 10 above mvrvZ = 10 (mvrvZ = 20)", () => {
    expect(mvrvZScoreToScore(20)).toBe(10);
  });

  it("collapses non-finite input to neutral 50", () => {
    expect(mvrvZScoreToScore(Number.NaN)).toBe(50);
    expect(mvrvZScoreToScore(Number.POSITIVE_INFINITY)).toBe(50);
  });
});

describe("isCryptoUndervalued", () => {
  it("returns true for negative mvrvZ", () => {
    expect(isCryptoUndervalued(-0.5)).toBe(true);
  });

  it("is inclusive at the boundary: mvrvZ = 0 → true", () => {
    expect(isCryptoUndervalued(0)).toBe(true);
  });

  it("returns false just above the boundary (mvrvZ = 0.1)", () => {
    expect(isCryptoUndervalued(0.1)).toBe(false);
  });

  it("respects a custom threshold", () => {
    expect(isCryptoUndervalued(0.5, 1)).toBe(true);
    expect(isCryptoUndervalued(1.5, 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SOPR
// ---------------------------------------------------------------------------

describe("soprToScore", () => {
  // Below 1: 80 + (1 - sopr) * 20, clamped at 100.

  it("computes 81 at sopr = 0.95 (slight capitulation)", () => {
    // 80 + (1 - 0.95) * 20 = 80 + 1 = 81
    expect(soprToScore(0.95)).toBeCloseTo(81, 10);
  });

  it("computes 90 at sopr = 0.5 (deep capitulation)", () => {
    // 80 + (1 - 0.5) * 20 = 80 + 10 = 90
    expect(soprToScore(0.5)).toBe(90);
  });

  it("reaches 100 at the theoretical floor sopr = 0.0", () => {
    // 80 + (1 - 0) * 20 = 100
    expect(soprToScore(0)).toBe(100);
  });

  // Flat band [1, 1.05]: 55.

  it("enters the flat band at sopr = 1.0 → 55", () => {
    expect(soprToScore(1.0)).toBe(55);
  });

  it("stays flat at 55 in the middle of the band (sopr = 1.025)", () => {
    expect(soprToScore(1.025)).toBe(55);
  });

  it(
    "flat-band wins at the exact right boundary sopr = 1.05 → 55 " +
      "(blueprint §4.3 inclusive interval [1, 1.05]: 55)",
    () => {
      expect(soprToScore(1.05)).toBe(55);
    },
  );

  // Above 1.05: descending branch.

  it("descending branch: sopr = 1.10 → 35", () => {
    // 40 - min(40, (1.10 - 1.05) * 100) = 40 - 5 = 35
    expect(soprToScore(1.1)).toBeCloseTo(35, 10);
  });

  it("reaches 0 at sopr = 1.45 (penalty saturates)", () => {
    // 40 - min(40, (1.45 - 1.05) * 100) = 40 - 40 = 0
    // Use toBeCloseTo because (1.45 - 1.05) is not exactly 0.4 in IEEE-754.
    expect(soprToScore(1.45)).toBeCloseTo(0, 10);
  });

  it("clamps at 0 above sopr = 1.45 (sopr = 2.0)", () => {
    expect(soprToScore(2.0)).toBe(0);
  });

  it("collapses non-finite input to neutral 50", () => {
    expect(soprToScore(Number.NaN)).toBe(50);
  });
});

describe("isCapitulation", () => {
  it("returns true just below the boundary (sopr = 0.99)", () => {
    expect(isCapitulation(0.99)).toBe(true);
  });

  it("is strict at the boundary: sopr = 1.0 → false", () => {
    expect(isCapitulation(1.0)).toBe(false);
  });

  it("respects a custom threshold", () => {
    expect(isCapitulation(1.04, 1.05)).toBe(true);
    expect(isCapitulation(1.05, 1.05)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Crypto Fear & Greed (passthrough, inverted)
// ---------------------------------------------------------------------------

describe("cryptoFearGreedToScore", () => {
  it("inverts extreme fear (raw = 0) to max favorability (100)", () => {
    expect(cryptoFearGreedToScore(0)).toBe(100);
  });

  it("maps neutral (raw = 50) to itself (50)", () => {
    expect(cryptoFearGreedToScore(50)).toBe(50);
  });

  it("inverts extreme greed (raw = 100) to min favorability (0)", () => {
    expect(cryptoFearGreedToScore(100)).toBe(0);
  });

  it("clamps below-range input (raw = -10) to 100", () => {
    expect(cryptoFearGreedToScore(-10)).toBe(100);
  });

  it("clamps above-range input (raw = 110) to 0", () => {
    expect(cryptoFearGreedToScore(110)).toBe(0);
  });

  it("collapses non-finite input to neutral 50", () => {
    expect(cryptoFearGreedToScore(Number.NaN)).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// ETF Flow
// ---------------------------------------------------------------------------

describe("etfFlowToScore", () => {
  it("returns null for empty history (no variance)", () => {
    expect(etfFlowToScore(100_000_000, [])).toBeNull();
  });

  it("returns null for single-point history (no variance)", () => {
    expect(etfFlowToScore(100_000_000, [50_000_000])).toBeNull();
  });

  it("returns 50 when current equals the historical mean (z = 0)", () => {
    const history = [100, 200, 300, 400, 500]; // mean = 300
    expect(etfFlowToScore(300, history)).toBe(50);
  });

  it("returns > 50 when current is above the mean (positive inflow, inverted=true)", () => {
    const history = [100, 200, 300, 400, 500];
    const score = etfFlowToScore(1000, history);
    expect(score).not.toBeNull();
    expect(score as number).toBeGreaterThan(50);
  });

  it("returns < 50 when current is below the mean (outflow)", () => {
    const history = [100, 200, 300, 400, 500];
    const score = etfFlowToScore(-500, history);
    expect(score).not.toBeNull();
    expect(score as number).toBeLessThan(50);
  });

  it("returns null when currentNetFlow is non-finite (blueprint §4.5 tenet 1)", () => {
    // NaN / Infinity inputs must surface as null ("unknown" state),
    // never as a misleading neutral 50. Otherwise a missing feed
    // would look indistinguishable from a neutral reading on the UI.
    const history = Array.from({ length: 30 }, (_, i) => 1_000_000 + i * 10_000);
    expect(etfFlowToScore(Number.NaN, history)).toBeNull();
    expect(etfFlowToScore(Number.POSITIVE_INFINITY, history)).toBeNull();
    expect(etfFlowToScore(Number.NEGATIVE_INFINITY, history)).toBeNull();
  });

  it("returns null when the in-window history contains any non-finite value", () => {
    // A NaN in the rolling window would propagate silently through
    // computeZScore (mean/stddev become NaN), collapsing to 50 via
    // zScoreTo0100. Guard at the parser layer: surface null so the
    // caller treats it as unknown, not neutral.
    const good = Array.from({ length: 30 }, (_, i) => 1_000 + i);
    const withNaN = [...good, Number.NaN];
    expect(etfFlowToScore(1_500, withNaN)).toBeNull();
    const withInf = [...good, Number.POSITIVE_INFINITY];
    expect(etfFlowToScore(1_500, withInf)).toBeNull();
  });

  it("ignores non-finite values that fall OUTSIDE the 90-day window", () => {
    // The guard only fires for non-finite entries in the active
    // window. Old NaNs that would be sliced off are irrelevant.
    const ancientBadData = Array.from({ length: 10 }, () => Number.NaN);
    const recent = Array.from(
      { length: ETF_FLOW_SCORE_WINDOW },
      (_, i) => 1_000 + i,
    );
    const history = [...ancientBadData, ...recent];
    // Current = mean of recent window → z = 0 → score = 50.
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const score = etfFlowToScore(mean, history);
    expect(score).not.toBeNull();
    expect(score as number).toBeCloseTo(50, 5);
  });

  it(
    "slices history internally to the last ETF_FLOW_SCORE_WINDOW entries " +
      "(blueprint §4.3: 90-day rolling)",
    () => {
      // Build a history where the earliest 50 entries are wildly
      // different from the last 90. If the function widened the window
      // beyond 90 those earlier values would move the mean/stddev and
      // change the z-score. With correct slicing, only the last 90
      // matter — here all identical to 100, so any non-100 current
      // returns NaN-equivalent neutral 50 (degenerate stddev).
      const noise = Array.from({ length: 50 }, () => 10_000_000);
      const recent = Array.from({ length: ETF_FLOW_SCORE_WINDOW }, () => 100);
      const history = [...noise, ...recent];
      // computeZScore on a constant series returns NaN (not 0) when
      // current !== mean, which zScoreTo0100 collapses to 50.
      expect(etfFlowToScore(200, history)).toBe(50);
    },
  );
});

// ---------------------------------------------------------------------------
// mergeEtfFlowHistory — F-R2.1 Trigger 2 review regression test
// ---------------------------------------------------------------------------

describe("mergeEtfFlowHistory (F-R2.1 dedup regression)", () => {
  it("dedupes overlapping dates between DB rows and upstream observations (upstream wins)", () => {
    // Pre-fix shape: [...db, ...upstream] would yield 6 entries with
    // 2024-01-02 and 2024-01-03 each appearing twice. Mean/stddev
    // would be biased by the duplicates.
    const dbRows = [
      { date: "2024-01-01", netFlow: 100 },
      { date: "2024-01-02", netFlow: 200 },
      { date: "2024-01-03", netFlow: 300 },
    ];
    const upstream = [
      // Same dates as DB — upstream is closer to canonical, so its
      // values should win. 2024-01-02 db=200 → upstream=250.
      { date: "2024-01-02", netFlow: 250 },
      { date: "2024-01-03", netFlow: 350 },
      { date: "2024-01-04", netFlow: 400 },
    ];
    const merged = mergeEtfFlowHistory(dbRows, upstream, "2024-01-05");
    // Distinct dates only: 4 unique days. No duplicates.
    expect(merged).toHaveLength(4);
    // Chronological, upstream-wins on collisions.
    expect(merged).toEqual([100, 250, 350, 400]);
  });

  it("excludes observations on or after latestDate from both sources", () => {
    const dbRows = [
      { date: "2024-01-01", netFlow: 100 },
      { date: "2024-01-02", netFlow: 200 },
      // This row would never be queried in production (the DB lookup
      // applies `.lt("observed_at", latestDate)`) but the helper must
      // still defend against the same date appearing through the
      // upstream path or a misfit caller.
      { date: "2024-01-05", netFlow: 999 },
    ];
    const upstream = [
      { date: "2024-01-03", netFlow: 300 },
      // latestDate itself is excluded — that value is the
      // `currentNetFlow` argument to `etfFlowToScore`, not history.
      { date: "2024-01-05", netFlow: 500 },
      // Future dates also excluded as a defensive guard.
      { date: "2024-01-06", netFlow: 600 },
    ];
    const merged = mergeEtfFlowHistory(dbRows, upstream, "2024-01-05");
    expect(merged).toEqual([100, 200, 300]);
  });

  it("skips non-finite values from either source without throwing", () => {
    const dbRows = [
      { date: "2024-01-01", netFlow: 100 },
      { date: "2024-01-02", netFlow: Number.NaN },
    ];
    const upstream = [
      { date: "2024-01-03", netFlow: 300 },
      { date: "2024-01-04", netFlow: Number.POSITIVE_INFINITY },
    ];
    const merged = mergeEtfFlowHistory(dbRows, upstream, "2024-01-10");
    expect(merged).toEqual([100, 300]);
  });
});
