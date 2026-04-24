import { describe, expect, it } from "vitest";

import { parseContributing } from "./contributing-indicators";

/**
 * Pure parser tests — the component itself is a render-only Server
 * Component that doesn't bring enough testable logic to justify a
 * `@testing-library/react` dependency. The parse branch (v1 vs v2) is
 * where all the shape-detection judgment lives, so it's where tests
 * land.
 */

describe("parseContributing", () => {
  it("returns empty + v2 mode for null / non-object / array input", () => {
    // Defensive coverage: callers pass `Json` which could be any of
    // these. Zero-row output in all cases — UI shows empty state, no
    // crash.
    expect(parseContributing(null).categories).toEqual([]);
    expect(parseContributing("oops" as never).categories).toEqual([]);
    expect(parseContributing([] as never).categories).toEqual([]);
    expect(parseContributing(42 as never).categories).toEqual([]);
  });

  it("detects v1 flat FRED shape and wraps into synthetic macro category", () => {
    const v1Blob = {
      FEDFUNDS: { score: 40, weight: 0.2, contribution: 8 },
      CPIAUCSL: { score: 60, weight: 0.15, contribution: 9 },
    };
    const { mode, categories } = parseContributing(v1Blob);
    expect(mode).toBe("v1");
    expect(categories).toHaveLength(1);
    expect(categories[0].category).toBe("macro");
    expect(categories[0].indicators).toHaveLength(2);
    // CPIAUCSL has larger |contribution|, should sort first.
    expect(categories[0].indicators[0].key).toBe("CPIAUCSL");
    expect(categories[0].indicators[1].key).toBe("FEDFUNDS");
    // Category contribution is the sum for v1.
    expect(categories[0].contribution).toBeCloseTo(17, 5);
    expect(categories[0].weight).toBe(1);
    expect(categories[0].staleness).toBe("fresh");
  });

  it("detects v2 nested shape and surfaces categories in canonical order", () => {
    const v2Blob = {
      // Deliberately out-of-order keys to prove we sort by display order.
      onchain: { score: 70, weight: 0.35, contribution: 24.5 },
      macro: {
        score: 50,
        weight: 0.25,
        contribution: 12.5,
        indicators: {
          FEDFUNDS: { score: 40, weight: 0.2, contribution: 8 },
        },
      },
      sentiment: { score: 55, weight: 0.15, contribution: 8.25 },
    };
    const { mode, categories } = parseContributing(v2Blob);
    expect(mode).toBe("v2");
    // Canonical order: macro, technical(absent), onchain, sentiment, ...
    expect(categories.map((c) => c.category)).toEqual([
      "macro",
      "onchain",
      "sentiment",
    ]);
    // The macro category surfaces its nested FEDFUNDS indicator.
    expect(categories[0].indicators).toHaveLength(1);
    expect(categories[0].indicators[0].key).toBe("FEDFUNDS");
  });

  it("marks null-score categories as 'collecting' (staleness approximation)", () => {
    const v2Blob = {
      macro: { score: 50, weight: 0.45, contribution: 22.5 },
      technical: { score: null, weight: null, contribution: null },
    };
    const { categories } = parseContributing(v2Blob);
    expect(categories.find((c) => c.category === "macro")?.staleness).toBe(
      "fresh",
    );
    expect(categories.find((c) => c.category === "technical")?.staleness).toBe(
      "collecting",
    );
  });

  it("silently drops malformed indicators rather than crashing", () => {
    const mixed = {
      macro: {
        score: 50,
        weight: 0.45,
        contribution: 22.5,
        indicators: {
          GOOD: { score: 40, weight: 0.2, contribution: 8 },
          // Non-finite contribution — dropped.
          BAD: { score: 40, weight: 0.2, contribution: Infinity },
          // String values — dropped.
          WORSE: { score: "x", weight: "y", contribution: "z" },
          // Missing fields — dropped.
          WORST: { score: 40 },
        },
      },
    };
    const { categories } = parseContributing(mixed);
    expect(categories[0].indicators.map((i) => i.key)).toEqual(["GOOD"]);
  });

  it("treats v2 category with NO indicators block (valuation) gracefully", () => {
    // Phase 2 pins `valuation` to 50; the write path omits an indicators
    // sub-map. The UI must not double-count or render an empty nested
    // list as a layout bug.
    const v2Blob = {
      valuation: { score: 50, weight: 0.1, contribution: 5 },
    };
    const { categories } = parseContributing(v2Blob);
    expect(categories).toHaveLength(1);
    expect(categories[0].category).toBe("valuation");
    expect(categories[0].indicators).toEqual([]);
  });
});
