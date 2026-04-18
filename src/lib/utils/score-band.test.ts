import { describe, expect, it } from "vitest";

import { scoreToBand } from "./score-band";

describe("scoreToBand", () => {
  it.each([
    [100, "강한 비중 확대", "strong_overweight"],
    [80, "강한 비중 확대", "strong_overweight"],
    [79.999, "비중 확대", "overweight"],
    [60, "비중 확대", "overweight"],
    [59.999, "유지", "neutral"],
    [50, "유지", "neutral"],
    [40, "유지", "neutral"],
    [39.999, "비중 축소", "underweight"],
    [20, "비중 축소", "underweight"],
    [19.999, "강한 비중 축소", "strong_underweight"],
    [0, "강한 비중 축소", "strong_underweight"],
  ])("score %f → %s (%s)", (score, expectedLabel, expectedIntensity) => {
    const band = scoreToBand(score);
    expect(band.label).toBe(expectedLabel);
    expect(band.intensity).toBe(expectedIntensity);
  });

  describe("robustness", () => {
    it("NaN collapses to neutral, not a false strong signal", () => {
      expect(scoreToBand(Number.NaN)).toEqual({
        label: "유지",
        intensity: "neutral",
      });
    });

    it("Infinity collapses to neutral", () => {
      expect(scoreToBand(Number.POSITIVE_INFINITY)).toEqual({
        label: "유지",
        intensity: "neutral",
      });
      expect(scoreToBand(Number.NEGATIVE_INFINITY)).toEqual({
        label: "유지",
        intensity: "neutral",
      });
    });

    it("scores above 100 still read as 강한 비중 확대 (rounding slack)", () => {
      expect(scoreToBand(110).intensity).toBe("strong_overweight");
    });

    it("scores below 0 still read as 강한 비중 축소 (rounding slack)", () => {
      expect(scoreToBand(-10).intensity).toBe("strong_underweight");
    });
  });
});
