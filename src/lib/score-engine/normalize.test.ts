import { describe, expect, it } from "vitest";

import { computeZScore, zScoreTo0100 } from "./normalize";

describe("computeZScore", () => {
  it("returns 0 when current equals the series mean", () => {
    // [1,2,3,4,5] has mean 3 and sample stddev ~1.58; current=3 → 0σ.
    expect(computeZScore([1, 2, 3, 4, 5], 3)).toBe(0);
  });

  it("returns roughly +1 when current sits one stddev above the mean", () => {
    // Sample stddev of [0, 2] is sqrt((1+1)/1) = sqrt(2) ≈ 1.414.
    // Current 1 + 1.414 ≈ 2.414 → Z ≈ 1.
    const z = computeZScore([0, 2], 1 + Math.sqrt(2));
    expect(z).toBeCloseTo(1, 5);
  });

  it("returns a negative Z for values below the mean", () => {
    const z = computeZScore([10, 11, 12, 13, 14], 8);
    expect(z).toBeLessThan(0);
  });

  it("returns NaN when the series is empty", () => {
    expect(computeZScore([], 5)).toBeNaN();
  });

  it("returns NaN for a single-element series (no variance possible)", () => {
    expect(computeZScore([42], 42)).toBeNaN();
  });

  it("returns 0 when the series is constant and current matches", () => {
    // σ = 0, current = mean → 0σ is the only meaningful answer.
    expect(computeZScore([5, 5, 5, 5], 5)).toBe(0);
  });

  it("returns NaN when the series is constant but current differs", () => {
    // σ = 0, current ≠ mean — the Z-score is undefined (∞), safer to
    // bail out as NaN and let the caller fall back to neutral.
    expect(computeZScore([5, 5, 5, 5], 7)).toBeNaN();
  });

  it("handles a large series (260 obs, ~5y weekly)", () => {
    const series = Array.from({ length: 260 }, (_, i) => i);
    const z = computeZScore(series, 260);
    // Current is slightly above max; should be strongly positive.
    expect(z).toBeGreaterThan(1.5);
  });
});

describe("zScoreTo0100", () => {
  describe("default (non-inverted, lower raw = better)", () => {
    it("Z = 0 maps to 50 (neutral)", () => {
      expect(zScoreTo0100(0)).toBe(50);
    });

    it("Z = -3 maps to 100 (best)", () => {
      expect(zScoreTo0100(-3)).toBe(100);
    });

    it("Z = +3 maps to 0 (worst)", () => {
      expect(zScoreTo0100(3)).toBe(0);
    });

    it("clamps below -3 to 100", () => {
      expect(zScoreTo0100(-10)).toBe(100);
    });

    it("clamps above +3 to 0", () => {
      expect(zScoreTo0100(10)).toBe(0);
    });

    it("Z = -1.5 maps to 75 (linearly halfway to the best)", () => {
      expect(zScoreTo0100(-1.5)).toBeCloseTo(75, 5);
    });
  });

  describe("inverted (higher raw = better)", () => {
    it("Z = 0 still maps to 50", () => {
      expect(zScoreTo0100(0, true)).toBe(50);
    });

    it("Z = -3 maps to 0 under inversion (low is bad)", () => {
      expect(zScoreTo0100(-3, true)).toBe(0);
    });

    it("Z = +3 maps to 100 under inversion (high is good)", () => {
      expect(zScoreTo0100(3, true)).toBe(100);
    });

    it("is the mirror of non-inverted for the same magnitude", () => {
      for (const z of [-2, -1, 0, 1, 2]) {
        const normal = zScoreTo0100(z);
        const flipped = zScoreTo0100(z, true);
        expect(normal + flipped).toBeCloseTo(100, 5);
      }
    });
  });

  describe("non-finite input", () => {
    it("returns neutral 50 for NaN (single missing indicator shouldn't poison composite)", () => {
      expect(zScoreTo0100(Number.NaN)).toBe(50);
    });

    it("returns neutral 50 for Infinity", () => {
      expect(zScoreTo0100(Number.POSITIVE_INFINITY)).toBe(50);
      expect(zScoreTo0100(Number.NEGATIVE_INFINITY)).toBe(50);
    });
  });
});
