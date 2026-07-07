import { describe, expect, it } from "vitest";

import { computeWowDelta, type IndicatorSeriesPoint } from "./series";

function dailySeries(values: number[], startDay = 1): IndicatorSeriesPoint[] {
  return values.map((value, i) => ({
    date: `2026-06-${String(startDay + i).padStart(2, "0")}`,
    value,
  }));
}

describe("computeWowDelta", () => {
  it("returns latest minus the closest observation ≥7 days older", () => {
    // 10 daily points 01..10; latest = 10th (06-10), cutoff = 06-03.
    const series = dailySeries([4.0, 4.1, 4.2, 4.5, 4.8, 5.0, 4.9, 4.7, 4.6, 4.5]);
    // Closest point ≤ 06-03 is index 2 (06-03, 4.2) → 4.5 - 4.2.
    expect(computeWowDelta(series)).toBeCloseTo(0.3, 10);
  });

  it("skips weekend/holiday gaps: picks the nearest observation past the cutoff", () => {
    const series: IndicatorSeriesPoint[] = [
      { date: "2026-06-01", value: 3.0 },
      { date: "2026-06-05", value: 3.4 }, // 9 days before latest
      { date: "2026-06-12", value: 3.9 }, // 2 days before latest — too recent
      { date: "2026-06-14", value: 4.1 },
    ];
    expect(computeWowDelta(series)).toBeCloseTo(4.1 - 3.4, 10);
  });

  it("returns null when nothing is old enough to cover the lookback", () => {
    const series = dailySeries([4.0, 4.1, 4.2]); // spans 2 days
    expect(computeWowDelta(series)).toBeNull();
  });

  it("returns null on empty / single-point series", () => {
    expect(computeWowDelta([])).toBeNull();
    expect(computeWowDelta(dailySeries([4.2]))).toBeNull();
  });

  it("honors a custom lookback window", () => {
    const series = dailySeries([1, 2, 3, 4, 5]);
    // lookback 2: latest 06-05 → cutoff 06-03 → value 3 → delta 2.
    expect(computeWowDelta(series, 2)).toBe(2);
  });

  it("returns null on malformed dates instead of guessing", () => {
    const series: IndicatorSeriesPoint[] = [
      { date: "not-a-date", value: 1 },
      { date: "also-bad", value: 2 },
    ];
    expect(computeWowDelta(series)).toBeNull();
  });
});
