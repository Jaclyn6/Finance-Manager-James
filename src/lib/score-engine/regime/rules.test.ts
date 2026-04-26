import { describe, expect, it } from "vitest";

import { RULES } from "./rules";
import type { RegimeFeatures, RegimeLabel } from "./types";

/**
 * Helper — builds a {@link RegimeFeatures} with all fields null by
 * default, so each test can express the inputs it cares about.
 */
function features(partial: Partial<RegimeFeatures>): RegimeFeatures {
  return {
    vix: null,
    fedfundsSlope: null,
    t10y2y: null,
    spyTrendRatio: null,
    ismProxy: null,
    ...partial,
  };
}

function ruleFor(label: RegimeLabel) {
  const rule = RULES.find((r) => r.label === label);
  if (!rule) throw new Error(`No rule registered for label: ${label}`);
  return rule;
}

describe("RULES registry", () => {
  it("registers exactly the 4 positive-rule labels (transition is residual)", () => {
    const labels = RULES.map((r) => r.label).sort();
    expect(labels).toEqual([
      "risk_off_recession",
      "risk_off_tightening",
      "risk_on_easing",
      "risk_on_neutral",
    ]);
  });

  it("does not include `transition` (it has no positive rule)", () => {
    expect(RULES.find((r) => r.label === "transition")).toBeUndefined();
  });
});

describe("risk_on_easing rule", () => {
  const rule = ruleFor("risk_on_easing");

  it("clear match: deep cuts, low vol, strong uptrend → matched, strength near 1", () => {
    const result = rule.evaluate(
      features({ fedfundsSlope: -1.5, vix: 12, spyTrendRatio: 1.1 }),
    );
    expect(result.matched).toBe(true);
    expect(result.strength).toBeCloseTo(1, 5);
    expect(result.rule).toBe("risk_on_easing");
  });

  it("clear miss: hiking, high vol, downtrend → not matched, strength 0", () => {
    const result = rule.evaluate(
      features({ fedfundsSlope: 2.0, vix: 30, spyTrendRatio: 0.9 }),
    );
    expect(result.matched).toBe(false);
    expect(result.strength).toBe(0);
  });

  it("just above threshold: matched=true, low strength", () => {
    // fedfundsSlope=-0.26 (just below -0.25), vix=19.99, spyTrendRatio=1.001
    const result = rule.evaluate(
      features({ fedfundsSlope: -0.26, vix: 19.99, spyTrendRatio: 1.001 }),
    );
    expect(result.matched).toBe(true);
    // fed: 0.01, vix: 0.002, spy: 0.02 → avg ≈ 0.0107
    expect(result.strength).toBeGreaterThan(0);
    expect(result.strength).toBeLessThan(0.05);
  });

  it("at exact threshold: not matched (strict <, > inequalities per blueprint)", () => {
    const result = rule.evaluate(
      features({ fedfundsSlope: -0.25, vix: 20, spyTrendRatio: 1.0 }),
    );
    expect(result.matched).toBe(false);
  });

  it("all-null features: matched=false, strength=0, reason names missing inputs", () => {
    const result = rule.evaluate(features({}));
    expect(result.matched).toBe(false);
    expect(result.strength).toBe(0);
    expect(result.reasonKo).toMatch(/입력 누락/);
    expect(result.reasonKo).toContain("fedfundsSlope");
    expect(result.reasonKo).toContain("vix");
    expect(result.reasonKo).toContain("spyTrendRatio");
  });

  it("partial null (one required input missing): matched=false, strength=0", () => {
    const result = rule.evaluate(
      features({ fedfundsSlope: -1.0, vix: 12 /* spyTrendRatio missing */ }),
    );
    expect(result.matched).toBe(false);
    expect(result.strength).toBe(0);
    expect(result.reasonKo).toContain("spyTrendRatio");
  });
});

describe("risk_on_neutral rule", () => {
  const rule = ruleFor("risk_on_neutral");

  it("clear match: stable rates, low vol, uptrend → matched, strength near 1", () => {
    // slope=0 → fedStability = (0.25-0)/0.25 = 1
    // vix=13 → (18-13)/5 = 1
    // spy=1.05 → (1.05-1.0)/0.05 = 1
    const result = rule.evaluate(
      features({ fedfundsSlope: 0, vix: 13, spyTrendRatio: 1.05 }),
    );
    expect(result.matched).toBe(true);
    expect(result.strength).toBeCloseTo(1, 5);
  });

  it("slope outside band: not matched", () => {
    const result = rule.evaluate(
      features({ fedfundsSlope: 0.3, vix: 13, spyTrendRatio: 1.05 }),
    );
    expect(result.matched).toBe(false);
  });

  it("vix above ceiling: not matched", () => {
    const result = rule.evaluate(
      features({ fedfundsSlope: 0, vix: 19, spyTrendRatio: 1.05 }),
    );
    expect(result.matched).toBe(false);
  });

  it("at boundary slope=0.25 (inclusive): matched", () => {
    const result = rule.evaluate(
      features({ fedfundsSlope: 0.25, vix: 13, spyTrendRatio: 1.05 }),
    );
    // |0.25| <= 0.25 (inclusive per spec) → matched
    expect(result.matched).toBe(true);
  });

  it("clear miss with all-feature failure: strength=0 across the board", () => {
    const result = rule.evaluate(
      features({ fedfundsSlope: 1.0, vix: 30, spyTrendRatio: 0.9 }),
    );
    expect(result.matched).toBe(false);
    expect(result.strength).toBe(0);
  });

  it("all-null: matched=false, strength=0, reason mentions missing", () => {
    const result = rule.evaluate(features({}));
    expect(result.matched).toBe(false);
    expect(result.strength).toBe(0);
    expect(result.reasonKo).toMatch(/입력 누락/);
  });
});

describe("risk_off_tightening rule", () => {
  const rule = ruleFor("risk_off_tightening");

  it("clear match: sharp hikes + spike vol → matched, strength near 1", () => {
    // fed=1.5 → (1.5-0.25)/1.0 = 1.25 → clamp 1
    // vix=40 → (40-25)/10 = 1.5 → clamp 1
    const result = rule.evaluate(features({ fedfundsSlope: 1.5, vix: 40 }));
    expect(result.matched).toBe(true);
    expect(result.strength).toBeCloseTo(1, 5);
  });

  it("clear miss: cuts + calm vol → strength 0", () => {
    const result = rule.evaluate(features({ fedfundsSlope: -0.5, vix: 14 }));
    expect(result.matched).toBe(false);
    expect(result.strength).toBe(0);
  });

  it("just above threshold: matched=true, low strength", () => {
    // fed=0.26 → 0.01, vix=25.5 → 0.05 → avg = 0.03
    const result = rule.evaluate(features({ fedfundsSlope: 0.26, vix: 25.5 }));
    expect(result.matched).toBe(true);
    expect(result.strength).toBeGreaterThan(0);
    expect(result.strength).toBeLessThan(0.1);
  });

  it("at exact threshold: not matched (strict >)", () => {
    const result = rule.evaluate(features({ fedfundsSlope: 0.25, vix: 25 }));
    expect(result.matched).toBe(false);
  });

  it("does NOT require spyTrendRatio / t10y2y / ismProxy (only 2 inputs)", () => {
    // Provide ONLY the two required inputs — leave others null. Should
    // still produce a meaningful evaluation, not short-circuit on "missing".
    const result = rule.evaluate(features({ fedfundsSlope: 1.5, vix: 40 }));
    expect(result.matched).toBe(true);
    expect(result.reasonKo).not.toMatch(/입력 누락/);
  });

  it("all-null: matched=false, strength=0, reason mentions missing", () => {
    const result = rule.evaluate(features({}));
    expect(result.matched).toBe(false);
    expect(result.strength).toBe(0);
    expect(result.reasonKo).toMatch(/입력 누락/);
    expect(result.reasonKo).toContain("fedfundsSlope");
    expect(result.reasonKo).toContain("vix");
  });
});

describe("risk_off_recession rule", () => {
  const rule = ruleFor("risk_off_recession");

  it("clear match: deep inversion, ISM crater, downtrend → matched, strength near 1", () => {
    // t10y2y=-1.1 → 1.1/1.0 = 1.1 → clamp 1
    // ism=44 → (50-44)/5 = 1.2 → clamp 1
    // spy=0.93 → (1-0.93)/0.05 = 1.4 → clamp 1
    const result = rule.evaluate(
      features({ t10y2y: -1.1, ismProxy: 44, spyTrendRatio: 0.93 }),
    );
    expect(result.matched).toBe(true);
    expect(result.strength).toBeCloseTo(1, 5);
  });

  it("mid-strength: shallow inversion gives gradient signal (calibrated for the historical -0.5 to -1.1 range)", () => {
    // t10y2y=-0.5 (typical mild inversion) → 0.5/1.0 = 0.5 (mid-gradient)
    // ism=47 → (50-47)/5 = 0.6
    // spy=0.97 → (1-0.97)/0.05 = 0.6
    // strength = (0.5 + 0.6 + 0.6) / 3 ≈ 0.567
    const result = rule.evaluate(
      features({ t10y2y: -0.5, ismProxy: 47, spyTrendRatio: 0.97 }),
    );
    expect(result.matched).toBe(true);
    expect(result.strength).toBeGreaterThan(0.5);
    expect(result.strength).toBeLessThan(0.7);
  });

  it("clear miss: positive curve, expansion, uptrend → strength 0", () => {
    const result = rule.evaluate(
      features({ t10y2y: 1.0, ismProxy: 56, spyTrendRatio: 1.08 }),
    );
    expect(result.matched).toBe(false);
    expect(result.strength).toBe(0);
  });

  it("just past threshold: matched, low strength", () => {
    // t10y2y=-0.01 → 0.02
    // ism=49.95 → 0.01
    // spy=0.999 → 0.02 → avg ≈ 0.0167
    const result = rule.evaluate(
      features({ t10y2y: -0.01, ismProxy: 49.95, spyTrendRatio: 0.999 }),
    );
    expect(result.matched).toBe(true);
    expect(result.strength).toBeGreaterThan(0);
    expect(result.strength).toBeLessThan(0.05);
  });

  it("at exact threshold: not matched (strict <)", () => {
    const result = rule.evaluate(
      features({ t10y2y: 0, ismProxy: 50, spyTrendRatio: 1.0 }),
    );
    expect(result.matched).toBe(false);
  });

  it("partial null (ismProxy missing): matched=false, strength=0", () => {
    const result = rule.evaluate(
      features({ t10y2y: -0.5, spyTrendRatio: 0.9 }),
    );
    expect(result.matched).toBe(false);
    expect(result.strength).toBe(0);
    expect(result.reasonKo).toContain("ismProxy");
  });

  it("all-null: matched=false, strength=0, reason mentions missing", () => {
    const result = rule.evaluate(features({}));
    expect(result.matched).toBe(false);
    expect(result.strength).toBe(0);
    expect(result.reasonKo).toMatch(/입력 누락/);
  });
});

describe("strength clamping invariants", () => {
  it("never returns strength < 0 or > 1 for any rule across extreme inputs", () => {
    const extremes: RegimeFeatures[] = [
      features({
        vix: 1e6,
        fedfundsSlope: 1e6,
        t10y2y: 1e6,
        spyTrendRatio: 1e6,
        ismProxy: 1e6,
      }),
      features({
        vix: -1e6,
        fedfundsSlope: -1e6,
        t10y2y: -1e6,
        spyTrendRatio: -1e6,
        ismProxy: -1e6,
      }),
      features({
        vix: 0,
        fedfundsSlope: 0,
        t10y2y: 0,
        spyTrendRatio: 0,
        ismProxy: 0,
      }),
    ];
    for (const f of extremes) {
      for (const rule of RULES) {
        const result = rule.evaluate(f);
        expect(result.strength).toBeGreaterThanOrEqual(0);
        expect(result.strength).toBeLessThanOrEqual(1);
      }
    }
  });
});
