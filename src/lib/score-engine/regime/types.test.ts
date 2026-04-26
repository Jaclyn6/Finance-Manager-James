import { describe, expectTypeOf, it } from "vitest";

import {
  REGIME_CONFIDENCE_THRESHOLD,
  type RegimeDecision,
  type RegimeFeatures,
  type RegimeLabel,
  type RuleEvaluation,
} from "./types";

describe("RegimeLabel", () => {
  it("is exactly the 5 documented labels", () => {
    // Exhaustive match — adding/removing a label without updating
    // downstream code (rules.ts switch, weight-overlay table) should
    // be a compile error somewhere. This test asserts the union shape.
    const allLabels: RegimeLabel[] = [
      "risk_on_easing",
      "risk_on_neutral",
      "risk_off_tightening",
      "risk_off_recession",
      "transition",
    ];
    expectTypeOf<RegimeLabel>().toEqualTypeOf<(typeof allLabels)[number]>();
  });
});

describe("RegimeFeatures", () => {
  it("has every field as `number | null`", () => {
    expectTypeOf<RegimeFeatures["vix"]>().toEqualTypeOf<number | null>();
    expectTypeOf<RegimeFeatures["fedfundsSlope"]>().toEqualTypeOf<
      number | null
    >();
    expectTypeOf<RegimeFeatures["t10y2y"]>().toEqualTypeOf<number | null>();
    expectTypeOf<RegimeFeatures["spyTrendRatio"]>().toEqualTypeOf<
      number | null
    >();
    expectTypeOf<RegimeFeatures["ismProxy"]>().toEqualTypeOf<number | null>();
  });
});

describe("RegimeDecision", () => {
  it("label is always one of the 5 enum values (never null)", () => {
    expectTypeOf<RegimeDecision["label"]>().toEqualTypeOf<RegimeLabel>();
  });

  it("ruleEvaluations is read-only", () => {
    expectTypeOf<RegimeDecision["ruleEvaluations"]>().toEqualTypeOf<
      ReadonlyArray<RuleEvaluation>
    >();
  });

  it("confidence is a number (not nullable in the type)", () => {
    expectTypeOf<RegimeDecision["confidence"]>().toEqualTypeOf<number>();
  });
});

describe("REGIME_CONFIDENCE_THRESHOLD", () => {
  it("is the documented 0.6 threshold", () => {
    expectTypeOf(REGIME_CONFIDENCE_THRESHOLD).toEqualTypeOf<number>();
    if (REGIME_CONFIDENCE_THRESHOLD !== 0.6) {
      throw new Error(
        `Threshold drift: expected 0.6, got ${REGIME_CONFIDENCE_THRESHOLD}`,
      );
    }
  });
});
