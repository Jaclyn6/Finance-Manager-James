import { describe, expect, it } from "vitest";

import {
  collapseToDaily,
  computeWowDelta,
  percentileRank,
  type IndicatorSeriesPoint,
} from "./series";

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

describe("percentileRank", () => {
  const flat300 = (v: number): IndicatorSeriesPoint[] =>
    Array.from({ length: 300 }, (_, i) => ({
      date: `d${i}`,
      value: v,
    }));

  it("ranks the current value against the window", () => {
    // 300 points: values 1..300; value 270 sits at rank 270/300 = 0.9
    const series: IndicatorSeriesPoint[] = Array.from(
      { length: 300 },
      (_, i) => ({ date: `d${i}`, value: i + 1 }),
    );
    expect(percentileRank(series, 270)).toBeCloseTo(0.9, 10);
    expect(percentileRank(series, 300)).toBe(1);
    expect(percentileRank(series, 0.5)).toBe(0);
  });

  it("returns null below the minimum sample floor", () => {
    const thin: IndicatorSeriesPoint[] = Array.from(
      { length: 100 },
      (_, i) => ({ date: `d${i}`, value: i }),
    );
    expect(percentileRank(thin, 50)).toBeNull();
    expect(percentileRank(thin, 50, 100)).not.toBeNull();
  });

  it("returns null for non-finite values, never guesses", () => {
    expect(percentileRank(flat300(10), Number.NaN)).toBeNull();
    expect(percentileRank(flat300(10), Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("collapseToDaily", () => {
  it("keeps the LAST point of each calendar date (hourly → daily)", () => {
    const series: IndicatorSeriesPoint[] = [
      { date: "2026-07-01", value: 40 },
      { date: "2026-07-01", value: 44 },
      { date: "2026-07-01", value: 42 },
      { date: "2026-07-02", value: 50 },
      { date: "2026-07-02", value: 55 },
    ];
    expect(collapseToDaily(series)).toEqual([
      { date: "2026-07-01", value: 42 },
      { date: "2026-07-02", value: 55 },
    ]);
  });

  it("passes an already-daily series through unchanged", () => {
    const series = dailySeries([1, 2, 3]);
    expect(collapseToDaily(series)).toEqual(series);
  });

  it("handles empty input", () => {
    expect(collapseToDaily([])).toEqual([]);
  });
});
