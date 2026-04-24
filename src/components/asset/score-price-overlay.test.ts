import { describe, expect, it } from "vitest";

import {
  computeDeltaPercent,
  findReferencePrice,
  mergeByDate,
} from "./score-price-overlay";

/**
 * Pure-function tests for the price-overlay chart's merge/delta logic.
 *
 * The component itself is a Recharts render wrapper; rendering it
 * requires `@testing-library/react` + jsdom, which this project
 * deliberately avoids. All interesting logic lives in the exported
 * helpers below.
 */

describe("mergeByDate", () => {
  it("returns [] when both inputs are empty", () => {
    expect(mergeByDate([], [])).toEqual([]);
  });

  it("score-only days get price=null; price-only days get score=null", () => {
    const result = mergeByDate(
      [
        { snapshot_date: "2026-04-01", score_0_100: 60 },
        { snapshot_date: "2026-04-02", score_0_100: 62 },
      ],
      [
        { price_date: "2026-04-02", close: 500 },
        { price_date: "2026-04-03", close: 505 },
      ],
    );
    expect(result).toEqual([
      { date: "2026-04-01", score: 60, price: null },
      { date: "2026-04-02", score: 62, price: 500 },
      { date: "2026-04-03", score: null, price: 505 },
    ]);
  });

  it("preserves ascending date ordering regardless of input order", () => {
    const result = mergeByDate(
      [
        { snapshot_date: "2026-04-03", score_0_100: 70 },
        { snapshot_date: "2026-04-01", score_0_100: 65 },
      ],
      [{ price_date: "2026-04-02", close: 100 }],
    );
    expect(result.map((p) => p.date)).toEqual([
      "2026-04-01",
      "2026-04-02",
      "2026-04-03",
    ]);
  });

  it("merges matched dates into a single row with both axes populated", () => {
    const result = mergeByDate(
      [{ snapshot_date: "2026-04-10", score_0_100: 55 }],
      [{ price_date: "2026-04-10", close: 420.5 }],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      date: "2026-04-10",
      score: 55,
      price: 420.5,
    });
  });

  it("handles a score-only chart (no price rows) with all price=null", () => {
    // Fallback path — price ingest hasn't populated yet or ticker is
    // new. Chart should still render score-only.
    const result = mergeByDate(
      [
        { snapshot_date: "2026-04-01", score_0_100: 50 },
        { snapshot_date: "2026-04-02", score_0_100: 52 },
      ],
      [],
    );
    expect(result.every((p) => p.price === null)).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("duplicate price rows: last one wins (ASC-ordered input contract)", () => {
    const result = mergeByDate(
      [],
      [
        { price_date: "2026-04-05", close: 100 },
        { price_date: "2026-04-05", close: 101 },
      ],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      date: "2026-04-05",
      score: null,
      price: 101,
    });
  });
});

describe("computeDeltaPercent", () => {
  it("returns positive percent when price > reference", () => {
    // 110 vs 100 → +10%.
    expect(computeDeltaPercent(110, 100)).toBeCloseTo(10, 9);
  });

  it("returns negative percent when price < reference", () => {
    expect(computeDeltaPercent(95, 100)).toBeCloseTo(-5, 9);
  });

  it("returns 0 when price === reference", () => {
    expect(computeDeltaPercent(100, 100)).toBe(0);
  });

  it("returns null when reference is 0 (division-by-zero guard)", () => {
    expect(computeDeltaPercent(100, 0)).toBeNull();
  });

  it("returns null when either input is NaN or Infinity", () => {
    expect(computeDeltaPercent(Number.NaN, 100)).toBeNull();
    expect(computeDeltaPercent(100, Number.NaN)).toBeNull();
    expect(computeDeltaPercent(Number.POSITIVE_INFINITY, 100)).toBeNull();
    expect(computeDeltaPercent(100, Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it("returns null when either input is null (no reference or no price)", () => {
    expect(computeDeltaPercent(null, 100)).toBeNull();
    expect(computeDeltaPercent(100, null)).toBeNull();
    expect(computeDeltaPercent(null, null)).toBeNull();
  });

  it("handles fractional precision (tooltip shows 2 decimals)", () => {
    // 102.30 vs 100.00 → +2.30%, the exact PRD §11.6 example number.
    const delta = computeDeltaPercent(102.3, 100);
    expect(delta).not.toBeNull();
    expect((delta as number).toFixed(2)).toBe("2.30");
  });

  it("handles negative reference prices without throwing (unusual but valid)", () => {
    // Equities can't go negative but a reader bug could feed one in;
    // the math should still be well-defined, not a special-case null.
    // -50 vs -100 → (-50 - -100) / -100 * 100 = -50%.
    expect(computeDeltaPercent(-50, -100)).toBeCloseTo(-50, 9);
  });
});

describe("findReferencePrice", () => {
  const rows = [
    { price_date: "2026-04-01", close: 100 },
    { price_date: "2026-04-03", close: 105 },
    { price_date: "2026-04-05", close: 110 },
  ];

  it("returns null when referenceDate is null or undefined", () => {
    expect(findReferencePrice(rows, null)).toBeNull();
    expect(findReferencePrice(rows, undefined)).toBeNull();
  });

  it("returns the exact close when referenceDate matches a row", () => {
    expect(findReferencePrice(rows, "2026-04-03")).toBe(105);
  });

  it("walks back to nearest earlier date (weekend / holiday case)", () => {
    // 2026-04-04 has no bar (weekend); should fall back to 2026-04-03.
    expect(findReferencePrice(rows, "2026-04-04")).toBe(105);
  });

  it("returns null when referenceDate is before every bar", () => {
    expect(findReferencePrice(rows, "2026-03-15")).toBeNull();
  });

  it("returns null when referenceDate is strictly after every bar", () => {
    // Symmetric with the strictly-before-first-bar null path: a
    // reference date past the last bar would otherwise collapse Δ%
    // to ~0% across the whole chart (every hovered bar compared
    // against itself), which is semantically misleading.
    expect(findReferencePrice(rows, "2026-05-01")).toBeNull();
  });

  it("returns null for an empty price series regardless of date", () => {
    expect(findReferencePrice([], "2026-04-01")).toBeNull();
  });
});
