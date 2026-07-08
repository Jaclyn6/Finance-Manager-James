import { describe, expect, it } from "vitest";

import type { IndicatorSeriesPoint } from "./series";
import {
  computeStockFgProxy,
  JUNK_PERCENTILE_MIN_SAMPLES,
  MOMENTUM_MA_BARS,
  RETURN_WINDOW_BARS,
  VIX_MA_BARS,
} from "./stock-fg-proxy";

/** n points ending at `end`, linearly ramped from `start`. */
function ramp(n: number, start: number, end: number): IndicatorSeriesPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `d${String(i).padStart(4, "0")}`,
    value: start + ((end - start) * i) / Math.max(1, n - 1),
  }));
}

function flat(n: number, value: number): IndicatorSeriesPoint[] {
  return ramp(n, value, value);
}

const CALM: Parameters<typeof computeStockFgProxy>[0] = {
  // SPY grinding up: last close ~8% above the 125d mean → momentum greed.
  spyCloses: ramp(MOMENTUM_MA_BARS + RETURN_WINDOW_BARS, 100, 130),
  // TLT flat → SPY outperforms → safe-haven greed.
  tltCloses: flat(RETURN_WINDOW_BARS + 1, 100),
  // VIX well below its 50d MA → volatility greed.
  vixSeries: [...flat(VIX_MA_BARS, 20), { date: "dz", value: 14 }],
  // HY spread at the low end of its window → junk-demand greed.
  hySeries: [...ramp(JUNK_PERCENTILE_MIN_SAMPLES + 40, 3.0, 5.0), { date: "dz", value: 2.8 }],
};

const PANIC: Parameters<typeof computeStockFgProxy>[0] = {
  // SPY collapsing: last close far below the 125d mean.
  spyCloses: ramp(MOMENTUM_MA_BARS + RETURN_WINDOW_BARS, 130, 95),
  // TLT rallying while SPY falls → safe-haven fear.
  tltCloses: ramp(RETURN_WINDOW_BARS + 1, 100, 108),
  // VIX 60% above its 50d MA → volatility fear.
  vixSeries: [...flat(VIX_MA_BARS, 20), { date: "dz", value: 32 }],
  // HY spread at the top of its window → junk-demand fear.
  hySeries: [...ramp(JUNK_PERCENTILE_MIN_SAMPLES + 40, 3.0, 5.0), { date: "dz", value: 5.4 }],
};

describe("computeStockFgProxy", () => {
  it("greed-side regime scores well above 50 with all 4 components", () => {
    const result = computeStockFgProxy(CALM);
    expect(result.missing).toEqual([]);
    expect(result.components).toHaveLength(4);
    expect(result.value).not.toBeNull();
    expect(result.value!).toBeGreaterThan(65);
  });

  it("panic regime scores well below 50", () => {
    const result = computeStockFgProxy(PANIC);
    expect(result.missing).toEqual([]);
    expect(result.value).not.toBeNull();
    expect(result.value!).toBeLessThan(35);
  });

  it("each component stays within 0-100 under extreme inputs", () => {
    const extreme = computeStockFgProxy({
      spyCloses: ramp(MOMENTUM_MA_BARS + RETURN_WINDOW_BARS, 1, 1000),
      tltCloses: ramp(RETURN_WINDOW_BARS + 1, 1000, 1),
      vixSeries: [...flat(VIX_MA_BARS, 15), { date: "dz", value: 90 }],
      hySeries: [...flat(JUNK_PERCENTILE_MIN_SAMPLES, 3), { date: "dz", value: 20 }],
    });
    for (const c of extreme.components) {
      if (c.score !== null) {
        expect(c.score).toBeGreaterThanOrEqual(0);
        expect(c.score).toBeLessThanOrEqual(100);
      }
    }
  });

  it("missing ingredients drop their component and renormalize, not zero-fill", () => {
    const result = computeStockFgProxy({
      ...CALM,
      vixSeries: flat(10, 20), // too thin for the 50d MA
      tltCloses: [], // kills safeHaven
    });
    expect(result.missing.sort()).toEqual(["safeHaven", "volatility"]);
    expect(result.value).not.toBeNull();
    // Remaining components are the two greed-side ones → still > 50.
    expect(result.value!).toBeGreaterThan(50);
  });

  it("all ingredients missing → value null, all components missing", () => {
    const result = computeStockFgProxy({
      spyCloses: [],
      tltCloses: [],
      vixSeries: [],
      hySeries: [],
    });
    expect(result.value).toBeNull();
    expect(result.missing).toHaveLength(4);
  });

  it("every component carries a Korean detail line either way", () => {
    for (const result of [computeStockFgProxy(CALM), computeStockFgProxy({
      spyCloses: [], tltCloses: [], vixSeries: [], hySeries: [],
    })]) {
      for (const c of result.components) {
        expect(c.detailKo.length).toBeGreaterThan(0);
      }
    }
  });
});
