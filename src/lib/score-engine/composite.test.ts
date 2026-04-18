import { describe, expect, it } from "vitest";

import { computeComposite } from "./composite";
import type { IndicatorScore } from "./types";

const uniformWeight = { us_equity: 1, kr_equity: 1, crypto: 1, global_etf: 1, common: 1 };

function score(key: string, score0to100: number, weight = 1): IndicatorScore {
  return {
    key,
    score0to100,
    weights: {
      us_equity: weight,
      kr_equity: weight,
      crypto: weight,
      global_etf: weight,
      common: weight,
    },
  };
}

describe("computeComposite", () => {
  it("with a single indicator returns that indicator's score", () => {
    const result = computeComposite([score("FEDFUNDS", 72)], "us_equity");
    expect(result.score0to100).toBeCloseTo(72, 5);
  });

  it("averages equal-weight indicators", () => {
    const result = computeComposite(
      [score("A", 80), score("B", 40)],
      "us_equity",
    );
    expect(result.score0to100).toBeCloseTo(60, 5);
  });

  it("honors weight differences — heavier indicator dominates", () => {
    const result = computeComposite(
      [
        { key: "heavy", score0to100: 80, weights: { ...uniformWeight, us_equity: 3 } },
        { key: "light", score0to100: 40, weights: { ...uniformWeight, us_equity: 1 } },
      ],
      "us_equity",
    );
    // (80*3 + 40*1) / (3+1) = 280/4 = 70
    expect(result.score0to100).toBeCloseTo(70, 5);
  });

  it("reports contributing indicators with normalized weights summing to 1", () => {
    const result = computeComposite(
      [
        { key: "A", score0to100: 80, weights: { ...uniformWeight, us_equity: 3 } },
        { key: "B", score0to100: 40, weights: { ...uniformWeight, us_equity: 1 } },
      ],
      "us_equity",
    );

    const sumWeights = Object.values(result.contributing).reduce(
      (acc, c) => acc + c.weight,
      0,
    );
    expect(sumWeights).toBeCloseTo(1, 5);

    expect(result.contributing.A.weight).toBeCloseTo(0.75, 5);
    expect(result.contributing.B.weight).toBeCloseTo(0.25, 5);
    expect(result.contributing.A.contribution).toBeCloseTo(60, 5);
    expect(result.contributing.B.contribution).toBeCloseTo(10, 5);
  });

  it("renormalizes active weights when one indicator lacks a weight for the asset", () => {
    // B has no kr_equity weight → composite should be A's score alone,
    // not diluted by an implicit zero.
    const result = computeComposite(
      [
        { key: "A", score0to100: 80, weights: { us_equity: 1, kr_equity: 1 } },
        { key: "B", score0to100: 20, weights: { us_equity: 1 } },
      ],
      "kr_equity",
    );
    expect(result.score0to100).toBeCloseTo(80, 5);
    expect(Object.keys(result.contributing)).toEqual(["A"]);
  });

  it("returns neutral 50 when no indicator has a weight for the asset type", () => {
    const result = computeComposite(
      [{ key: "A", score0to100: 80, weights: { us_equity: 1 } }],
      "crypto",
    );
    expect(result).toEqual({ score0to100: 50, contributing: {} });
  });

  it("returns neutral 50 when given an empty indicator list", () => {
    const result = computeComposite([], "us_equity");
    expect(result).toEqual({ score0to100: 50, contributing: {} });
  });

  it("ignores zero-weight indicators (prevents them from distorting contributions)", () => {
    const result = computeComposite(
      [
        { key: "real", score0to100: 80, weights: { us_equity: 1 } },
        { key: "zero", score0to100: 0, weights: { us_equity: 0 } },
      ],
      "us_equity",
    );
    expect(result.score0to100).toBeCloseTo(80, 5);
    expect(result.contributing.zero).toBeUndefined();
  });

  it("averages the extremes of the scale to the midpoint", () => {
    // 0 and 100 with equal weights should land exactly at 50 — anything
    // else means the weighting math drifted (or returned a constant).
    const result = computeComposite(
      [score("A", 0), score("B", 100)],
      "us_equity",
    );
    expect(result.score0to100).toBeCloseTo(50, 5);
  });

  describe("robustness against bad input", () => {
    it("coerces a NaN indicator score to neutral 50 inside the composite", () => {
      // A misbehaving upstream path might hand us NaN despite
      // zScoreTo0100's own guard. The composite should survive.
      const result = computeComposite(
        [
          { key: "broken", score0to100: Number.NaN, weights: { us_equity: 1 } },
          score("ok", 80),
        ],
        "us_equity",
      );
      // broken is treated as 50; expected = (50*1 + 80*1) / 2 = 65
      expect(result.score0to100).toBeCloseTo(65, 5);
      // The contributing map should reflect the neutralized value too.
      expect(result.contributing.broken.score).toBe(50);
    });

    it("ignores indicators whose weight is Infinity", () => {
      // An Infinity weight would blow up normalization; the filter
      // must drop it in favor of the well-defined weights.
      const result = computeComposite(
        [
          {
            key: "wild",
            score0to100: 80,
            weights: { us_equity: Number.POSITIVE_INFINITY },
          },
          score("A", 40),
        ],
        "us_equity",
      );
      // Only A survives → composite = 40
      expect(result.score0to100).toBeCloseTo(40, 5);
      expect(result.contributing.wild).toBeUndefined();
    });

    it("ignores indicators whose weight is NaN", () => {
      const result = computeComposite(
        [
          { key: "wild", score0to100: 80, weights: { us_equity: Number.NaN } },
          score("A", 40),
        ],
        "us_equity",
      );
      expect(result.score0to100).toBeCloseTo(40, 5);
      expect(result.contributing.wild).toBeUndefined();
    });
  });
});
