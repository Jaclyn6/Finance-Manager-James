import { describe, expect, it } from "vitest";

import {
  ALL_SIGNALS,
  BASE_SIGNALS,
  computeSignals,
  evaluateCapitulation,
  evaluateCryptoUndervalued,
  evaluateDislocation,
  evaluateEconomyIntact,
  evaluateExtremeFear,
  evaluateLiquidityEasing,
  evaluateMomentumTurn,
  evaluateSpreadReversal,
  signalsForAssetType,
  type SignalInputs,
} from "./signals";
import { SIGNAL_RULES_VERSION } from "./weights";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_NULL_INPUTS: SignalInputs = {
  vix: null,
  cnnFg: null,
  spyDisparity: null,
  qqqDisparity: null,
  icsa: null,
  sahmCurrent: null,
  bamlH0A0HYM2Today: null,
  bamlH0A0HYM2History: [],
  wdtgalToday: null,
  wdtgalHistory: [],
  spyMacdLine: [],
  spyMacdSignal: [],
  mvrvZ: null,
  sopr: null,
};

// ---------------------------------------------------------------------------
// EXTREME_FEAR — VIX >= 35 || CNN_FG < 25
// ---------------------------------------------------------------------------

describe("evaluateExtremeFear", () => {
  it("fires active via VIX-only arm when VIX >= 35 (CNN null)", () => {
    const result = evaluateExtremeFear(37.2, null);
    expect(result.state).toBe("active");
  });

  it("fires active via CNN-only arm when CNN_FG < 25 (VIX null)", () => {
    const result = evaluateExtremeFear(null, 15);
    expect(result.state).toBe("active");
  });

  it("inactive when both present and both below their thresholds", () => {
    const result = evaluateExtremeFear(20, 50);
    expect(result.state).toBe("inactive");
  });

  it("unknown when both inputs are null", () => {
    const result = evaluateExtremeFear(null, null);
    expect(result.state).toBe("unknown");
  });

  it("unknown when one arm is non-firing and the other is null (loud-failure bias)", () => {
    // VIX present + non-firing, CNN null → can't rule out CNN firing the OR.
    expect(evaluateExtremeFear(20, null).state).toBe("unknown");
    expect(evaluateExtremeFear(null, 50).state).toBe("unknown");
  });

  it("inclusive boundary on VIX (35 fires; 34.999 does not)", () => {
    expect(evaluateExtremeFear(35, 50).state).toBe("active");
    expect(evaluateExtremeFear(34.999, 50).state).toBe("inactive");
  });

  it("strict boundary on CNN_FG (24 fires; 25 does not)", () => {
    expect(evaluateExtremeFear(20, 24).state).toBe("active");
    expect(evaluateExtremeFear(20, 25).state).toBe("inactive");
  });
});

// ---------------------------------------------------------------------------
// DISLOCATION — SPY.disparity <= -0.25 || QQQ.disparity <= -0.25
// ---------------------------------------------------------------------------

describe("evaluateDislocation", () => {
  it("fires active via SPY-only arm (QQQ null)", () => {
    expect(evaluateDislocation(-0.3, null).state).toBe("active");
  });

  it("fires active via QQQ-only arm (SPY null)", () => {
    expect(evaluateDislocation(null, -0.26).state).toBe("active");
  });

  it("inactive when both present and both above -0.25", () => {
    expect(evaluateDislocation(-0.1, -0.1).state).toBe("inactive");
  });

  it("unknown when both null", () => {
    expect(evaluateDislocation(null, null).state).toBe("unknown");
  });

  it("inclusive boundary at -0.25 (fires; -0.249 does not)", () => {
    expect(evaluateDislocation(-0.25, 0).state).toBe("active");
    expect(evaluateDislocation(-0.249, 0).state).toBe("inactive");
  });
});

// ---------------------------------------------------------------------------
// ECONOMY_INTACT — ICSA < 300k && SAHM < 0.5 (AND)
// ---------------------------------------------------------------------------

describe("evaluateEconomyIntact", () => {
  it("active when both conditions satisfied", () => {
    expect(evaluateEconomyIntact(220_000, 0.2).state).toBe("active");
  });

  it("inactive when ICSA crosses 300k", () => {
    expect(evaluateEconomyIntact(310_000, 0.2).state).toBe("inactive");
  });

  it("inactive when SAHM crosses 0.5", () => {
    expect(evaluateEconomyIntact(250_000, 0.6).state).toBe("inactive");
  });

  it("unknown when ICSA is null (AND needs both)", () => {
    expect(evaluateEconomyIntact(null, 0.2).state).toBe("unknown");
  });

  it("unknown when SAHMCURRENT is null (AND needs both)", () => {
    expect(evaluateEconomyIntact(250_000, null).state).toBe("unknown");
  });

  it("strict boundary on ICSA at 300_000 (below/at/above triplet)", () => {
    // ICSA threshold is `< 300_000`. 299_999 fires (active), 300_000 does
    // not (strict `<`), 300_001 does not.
    expect(evaluateEconomyIntact(299_999, 0.2).state).toBe("active");
    expect(evaluateEconomyIntact(300_000, 0.2).state).toBe("inactive");
    expect(evaluateEconomyIntact(300_001, 0.2).state).toBe("inactive");
  });

  it("strict boundary on SAHMCURRENT at 0.5 (below/at/above triplet)", () => {
    // SAHM threshold is `< 0.5`. 0.499 fires (active given ICSA also
    // active-side), 0.5 does not (strict `<`), 0.501 does not.
    expect(evaluateEconomyIntact(220_000, 0.499).state).toBe("active");
    expect(evaluateEconomyIntact(220_000, 0.5).state).toBe("inactive");
    expect(evaluateEconomyIntact(220_000, 0.501).state).toBe("inactive");
  });
});

// ---------------------------------------------------------------------------
// SPREAD_REVERSAL — BAML_today >= 4 && BAML_today < max(last_7d)
// ---------------------------------------------------------------------------

describe("evaluateSpreadReversal", () => {
  it("active when today >= 4 and today < max(7d)", () => {
    // today=4.5, max(5.2,5.0,4.9,4.8,4.7,4.6,4.5) = 5.2 → 4.5 < 5.2 ✓
    const history = [5.2, 5.0, 4.9, 4.8, 4.7, 4.6, 4.5];
    expect(evaluateSpreadReversal(4.5, history).state).toBe("active");
  });

  it("inactive when today < 4", () => {
    const history = [5.2, 5.0, 4.9, 4.8, 4.7, 4.6, 4.5];
    expect(evaluateSpreadReversal(3.5, history).state).toBe("inactive");
  });

  it("inactive when today equals the 7d max (not strictly below)", () => {
    // today=5.2, max=5.2 → 5.2 < 5.2 is false
    const history = [5.2, 5.0, 4.9, 4.8, 4.7, 4.6, 4.5];
    expect(evaluateSpreadReversal(5.2, history).state).toBe("inactive");
  });

  it("unknown when today is null", () => {
    const history = [5.2, 5.0, 4.9, 4.8, 4.7, 4.6, 4.5];
    expect(evaluateSpreadReversal(null, history).state).toBe("unknown");
  });

  it("unknown when history shorter than 7", () => {
    expect(evaluateSpreadReversal(4.5, [5.0, 4.9, 4.8]).state).toBe("unknown");
  });

  it("unknown when history contains a null entry", () => {
    const history = [5.2, null, 4.9, 4.8, 4.7, 4.6, 4.5];
    expect(evaluateSpreadReversal(4.5, history).state).toBe("unknown");
  });

  it("inclusive boundary on today >= 4 with history max > 4", () => {
    // `today >= 4` is inclusive. today=4 with max=5 → active.
    // today=3.99 with same history → inactive (fails `>= 4`).
    const history = [5.0, 4.9, 4.8, 4.7, 4.6, 4.5, 4.4];
    expect(evaluateSpreadReversal(4, history).state).toBe("active");
    expect(evaluateSpreadReversal(3.99, history).state).toBe("inactive");
  });

  it("strict boundary on today < max (today=max(4) → inactive)", () => {
    // When max(last_7d) == 4 and today == 4, `today < max` is false →
    // inactive. Covers the `strict <` half of the AND.
    const history = [4, 3.9, 3.8, 3.7, 3.6, 3.5, 3.4];
    expect(evaluateSpreadReversal(4, history).state).toBe("inactive");
  });
});

// ---------------------------------------------------------------------------
// LIQUIDITY_EASING — TGA_today < SMA20(TGA)
// ---------------------------------------------------------------------------

describe("evaluateLiquidityEasing", () => {
  // 20 values averaging to 500 → today=400 < 500 → active
  const history20 = Array.from({ length: 20 }, () => 500);

  it("active when today is below the 20-day SMA", () => {
    expect(evaluateLiquidityEasing(400, history20).state).toBe("active");
  });

  it("inactive when today equals or exceeds the SMA", () => {
    expect(evaluateLiquidityEasing(500, history20).state).toBe("inactive");
    expect(evaluateLiquidityEasing(600, history20).state).toBe("inactive");
  });

  it("unknown when usable history fewer than 20 entries", () => {
    // 15 usable (5 nulls excluded) → can't form a 20-day SMA
    const short = [
      100,
      200,
      300,
      400,
      500,
      null,
      null,
      null,
      null,
      null,
      600,
      700,
      800,
      900,
      1000,
    ];
    expect(evaluateLiquidityEasing(400, short).state).toBe("unknown");
  });

  it("unknown when today is null", () => {
    expect(evaluateLiquidityEasing(null, history20).state).toBe("unknown");
  });

  it("takes the last 20 usable values when history is longer", () => {
    // 25 values ascending 1..25, last 20 = 6..25, mean = 15.5 → today=10 < 15.5 → active
    const long = Array.from({ length: 25 }, (_, i) => i + 1);
    expect(evaluateLiquidityEasing(10, long).state).toBe("active");
    // today=20 > 15.5 → inactive
    expect(evaluateLiquidityEasing(20, long).state).toBe("inactive");
  });
});

// ---------------------------------------------------------------------------
// MOMENTUM_TURN — SPY MACD bullish cross within last N=7
// ---------------------------------------------------------------------------

describe("evaluateMomentumTurn", () => {
  it("active when a bullish cross occurred within last 7 daily transitions", () => {
    // Construct a series where on the last day MACD crosses above signal.
    // 8 days total (7 transitions). Prev: line<=signal, curr: line>signal.
    const line = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.9];
    const signal = [0.5, 0.6, 0.7, 0.8, 0.8, 0.8, 0.8, 0.8];
    expect(evaluateMomentumTurn(line, signal).state).toBe("active");
  });

  it("inactive when line is below signal throughout the window", () => {
    const line = [0.1, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2];
    const signal = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    expect(evaluateMomentumTurn(line, signal).state).toBe("inactive");
  });

  it("unknown when history shorter than withinDays + 1", () => {
    const line = [0.1, 0.2, 0.3]; // only 3 entries
    const signal = [0.5, 0.5, 0.5];
    expect(evaluateMomentumTurn(line, signal).state).toBe("unknown");
  });

  it("unknown when histories have different lengths", () => {
    const line = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    const signal = [0.5, 0.5];
    expect(evaluateMomentumTurn(line, signal).state).toBe("unknown");
  });

  it("unknown when all recent pairs include a null (no adjacent valid pair)", () => {
    const line = [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ] as (number | null)[];
    const signal = [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ] as (number | null)[];
    expect(evaluateMomentumTurn(line, signal).state).toBe("unknown");
  });

  it("respects a custom withinDays parameter (N=3)", () => {
    // Cross at last transition; withinDays=3 still sees it.
    const line = [0.1, 0.2, 0.3, 0.9];
    const signal = [0.5, 0.5, 0.5, 0.5];
    expect(evaluateMomentumTurn(line, signal, 3).state).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// CRYPTO_UNDERVALUED — MVRV_Z <= 0
// ---------------------------------------------------------------------------

describe("evaluateCryptoUndervalued", () => {
  it("active when MVRV_Z is negative", () => {
    expect(evaluateCryptoUndervalued(-0.5).state).toBe("active");
  });

  it("active at the inclusive boundary MVRV_Z = 0", () => {
    expect(evaluateCryptoUndervalued(0).state).toBe("active");
  });

  it("inactive when MVRV_Z > 0", () => {
    expect(evaluateCryptoUndervalued(2.5).state).toBe("inactive");
  });

  it("unknown when input is null", () => {
    expect(evaluateCryptoUndervalued(null).state).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// CAPITULATION — SOPR < 1
// ---------------------------------------------------------------------------

describe("evaluateCapitulation", () => {
  it("active when SOPR < 1 (selling at a loss)", () => {
    expect(evaluateCapitulation(0.95).state).toBe("active");
  });

  it("inactive at the strict boundary SOPR = 1 (break-even)", () => {
    expect(evaluateCapitulation(1).state).toBe("inactive");
  });

  it("inactive when SOPR > 1", () => {
    expect(evaluateCapitulation(1.05).state).toBe("inactive");
  });

  it("unknown when SOPR is null", () => {
    expect(evaluateCapitulation(null).state).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// computeSignals — end-to-end integration
// ---------------------------------------------------------------------------

describe("computeSignals", () => {
  it("returns 8 perSignal entries matching SIGNAL_RULES_VERSION on an all-present fixture", () => {
    const inputs: SignalInputs = {
      // EXTREME_FEAR: VIX=38 fires
      vix: 38,
      cnnFg: 30,
      // DISLOCATION: SPY disparity -0.3 fires
      spyDisparity: -0.3,
      qqqDisparity: -0.1,
      // ECONOMY_INTACT: 220k + 0.2 → active
      icsa: 220_000,
      sahmCurrent: 0.2,
      // SPREAD_REVERSAL: today=4.5, max=5.2 → active
      bamlH0A0HYM2Today: 4.5,
      bamlH0A0HYM2History: [5.2, 5.0, 4.9, 4.8, 4.7, 4.6, 4.5],
      // LIQUIDITY_EASING: today=400, SMA=500 → active
      wdtgalToday: 400,
      wdtgalHistory: Array.from({ length: 20 }, () => 500),
      // MOMENTUM_TURN: bullish cross at last transition
      spyMacdLine: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.9],
      spyMacdSignal: [0.5, 0.6, 0.7, 0.8, 0.8, 0.8, 0.8, 0.8],
      // CRYPTO_UNDERVALUED: -0.1 → active
      mvrvZ: -0.1,
      // CAPITULATION: 0.95 → active
      sopr: 0.95,
    };

    const result = computeSignals(inputs);
    expect(result.signalRulesVersion).toBe(SIGNAL_RULES_VERSION);
    expect(Object.keys(result.perSignal).length).toBe(8);
    // All 8 signals active, none unknown.
    expect(result.active).toEqual([
      "EXTREME_FEAR",
      "DISLOCATION",
      "ECONOMY_INTACT",
      "SPREAD_REVERSAL",
      "LIQUIDITY_EASING",
      "MOMENTUM_TURN",
      "CRYPTO_UNDERVALUED",
      "CAPITULATION",
    ]);
    expect(result.unknown).toEqual([]);
  });

  it("marks all 8 signals unknown when every input is null", () => {
    const result = computeSignals(ALL_NULL_INPUTS);
    expect(result.active).toEqual([]);
    expect(result.unknown).toEqual(Array.from(ALL_SIGNALS));
    expect(result.unknown.length).toBe(8);
  });

  it("mixes active/inactive/unknown correctly on a partial-input fixture", () => {
    const partial: SignalInputs = {
      ...ALL_NULL_INPUTS,
      // EXTREME_FEAR fires via VIX alone
      vix: 40,
      // ECONOMY_INTACT active (both inputs supplied)
      icsa: 200_000,
      sahmCurrent: 0.1,
      // CRYPTO_UNDERVALUED inactive (positive Z)
      mvrvZ: 2,
    };
    const result = computeSignals(partial);
    expect(result.active).toContain("EXTREME_FEAR");
    expect(result.active).toContain("ECONOMY_INTACT");
    expect(result.active).not.toContain("CRYPTO_UNDERVALUED");
    expect(result.unknown).toContain("DISLOCATION");
    expect(result.unknown).toContain("SPREAD_REVERSAL");
    expect(result.unknown).toContain("LIQUIDITY_EASING");
    expect(result.unknown).toContain("MOMENTUM_TURN");
    expect(result.unknown).toContain("CAPITULATION");
  });
});

// ---------------------------------------------------------------------------
// signalsForAssetType — per-asset membership
// ---------------------------------------------------------------------------

describe("signalsForAssetType", () => {
  it("us_equity gets all 6 base signals", () => {
    const list = signalsForAssetType("us_equity");
    expect(list.length).toBe(6);
    expect([...list]).toEqual(Array.from(BASE_SIGNALS));
  });

  it("common gets all 6 base signals (mirrors us_equity)", () => {
    const list = signalsForAssetType("common");
    expect(list.length).toBe(6);
    expect([...list]).toEqual(Array.from(BASE_SIGNALS));
  });

  it("crypto gets 7 signals (5 base minus MOMENTUM_TURN + 2 crypto-extra)", () => {
    // Blueprint §4.5 line 294: *"MOMENTUM_TURN replaced by crypto MACD on
    // BTC. ... Total 7 signals on the crypto asset page."* Phase C excludes
    // MOMENTUM_TURN outright; Phase 3 replaces it with a BTC-MACD variant.
    const list = signalsForAssetType("crypto");
    expect(list.length).toBe(7);
    expect(list).not.toContain("MOMENTUM_TURN");
    expect(list).toContain("CRYPTO_UNDERVALUED");
    expect(list).toContain("CAPITULATION");
    // Exact membership: 5 remaining base + 2 crypto extras (order per
    // BASE_SIGNALS followed by CRYPTO_EXTRA_SIGNALS).
    expect([...list]).toEqual([
      "EXTREME_FEAR",
      "DISLOCATION",
      "ECONOMY_INTACT",
      "SPREAD_REVERSAL",
      "LIQUIDITY_EASING",
      "CRYPTO_UNDERVALUED",
      "CAPITULATION",
    ]);
  });

  it("kr_equity gets 5 base signals (DISLOCATION excluded)", () => {
    const list = signalsForAssetType("kr_equity");
    expect(list.length).toBe(5);
    expect(list).not.toContain("DISLOCATION");
    expect(list).toContain("EXTREME_FEAR");
    expect(list).toContain("MOMENTUM_TURN");
  });

  it("global_etf gets 5 base signals (MOMENTUM_TURN excluded)", () => {
    const list = signalsForAssetType("global_etf");
    expect(list.length).toBe(5);
    expect(list).not.toContain("MOMENTUM_TURN");
    expect(list).toContain("EXTREME_FEAR");
    expect(list).toContain("DISLOCATION");
  });
});
