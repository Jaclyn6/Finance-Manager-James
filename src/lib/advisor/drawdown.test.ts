import { describe, expect, it } from "vitest";

import { computeDrawdownState, MIN_SAMPLES } from "./drawdown";
import type { DailyClose } from "./types";

/** Builds a daily series (28-day pseudo-months keep date math trivial). */
function series(closes: number[]): DailyClose[] {
  return closes.map((close, i) => {
    const month = String(Math.floor(i / 28) + 1).padStart(2, "0");
    const dayOfMonth = String((i % 28) + 1).padStart(2, "0");
    return { date: `2026-${month}-${dayOfMonth}`, close };
  });
}

/** Flat series of `n` days at the given price. */
function flat(n: number, price = 100): DailyClose[] {
  return series(Array.from({ length: n }, () => price));
}

describe("computeDrawdownState", () => {
  it("returns null for an empty series", () => {
    expect(computeDrawdownState([])).toBeNull();
  });

  it(`returns null below MIN_SAMPLES (${MIN_SAMPLES}) valid rows`, () => {
    expect(computeDrawdownState(flat(MIN_SAMPLES - 1))).toBeNull();
    expect(computeDrawdownState(flat(MIN_SAMPLES))).not.toBeNull();
  });

  it("drops non-finite and non-positive closes before counting", () => {
    const dirty = [
      ...flat(MIN_SAMPLES - 1),
      { date: "2026-12-01", close: NaN },
      { date: "2026-12-02", close: 0 },
      { date: "2026-12-03", close: -5 },
    ];
    expect(computeDrawdownState(dirty)).toBeNull();
  });

  it("flat series: zero drawdown, peak = first day", () => {
    const state = computeDrawdownState(flat(40))!;
    expect(state.drawdownPct).toBe(0);
    expect(state.maxDrawdownPct).toBe(0);
    expect(state.peakClose).toBe(100);
    expect(state.peakDate).toBe("2026-01-01");
    expect(state.sampleCount).toBe(40);
  });

  it("computes current drawdown from the window peak", () => {
    // 35 days at 100, then peak 200, then fall to 150 → dd = 25%
    const closes = [...Array.from({ length: 35 }, () => 100), 200, 150];
    const state = computeDrawdownState(series(closes))!;
    expect(state.peakClose).toBe(200);
    expect(state.currentClose).toBe(150);
    expect(state.drawdownPct).toBeCloseTo(0.25, 10);
  });

  it("MDD captures a deeper intra-window trough than the current drawdown", () => {
    // peak 200 → trough 100 (MDD 50%) → recover to 180 (current dd 10%)
    const closes = [
      ...Array.from({ length: 30 }, () => 150),
      200,
      100,
      180,
    ];
    const state = computeDrawdownState(series(closes))!;
    expect(state.maxDrawdownPct).toBeCloseTo(0.5, 10);
    expect(state.drawdownPct).toBeCloseTo(0.1, 10);
  });

  it("records the trough date of the MDD", () => {
    const closes = [...Array.from({ length: 30 }, () => 150), 200, 100, 180];
    const state = computeDrawdownState(series(closes))!;
    // trough (100) is the 32nd point → index 31 → day 32 → 2026-02-04
    expect(state.maxDrawdownTroughDate).toBe("2026-02-04");
  });

  it("sorts unsorted input by date before computing", () => {
    const ordered = series([
      ...Array.from({ length: 35 }, () => 100),
      200,
      150,
    ]);
    const shuffled = [...ordered].reverse();
    const state = computeDrawdownState(shuffled)!;
    expect(state.drawdownPct).toBeCloseTo(0.25, 10);
    expect(state.currentClose).toBe(150);
  });

  it("new all-time high resets the peak (drawdown 0 at fresh high)", () => {
    const closes = [
      ...Array.from({ length: 30 }, () => 100),
      120,
      90,
      130, // fresh high
    ];
    const state = computeDrawdownState(series(closes))!;
    expect(state.drawdownPct).toBe(0);
    expect(state.peakClose).toBe(130);
    expect(state.daysSincePeak).toBe(0);
  });

  it("daysSincePeak counts calendar days between peak and last sample", () => {
    const closes = [...Array.from({ length: 30 }, () => 100), 200, 150, 140, 130];
    const state = computeDrawdownState(series(closes))!;
    // peak at index 30, last at index 33 → 3 days apart
    expect(state.daysSincePeak).toBe(3);
  });
});
