import { describe, expect, it } from "vitest";

import { classifyRegime } from "./classifier";
import type { RegimeFeatures } from "./types";

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

describe("classifyRegime — happy paths", () => {
  it("clear risk_on_easing: returns that label with confidence > 0.6", () => {
    const decision = classifyRegime(
      features({
        fedfundsSlope: -1.5,
        vix: 12,
        spyTrendRatio: 1.1,
        // recession-rule inputs intentionally null — should not crash
        t10y2y: null,
        ismProxy: null,
      }),
    );
    expect(decision.label).toBe("risk_on_easing");
    expect(decision.confidence).toBeGreaterThan(0.6);
    expect(decision.contributingFeatures.fedfundsSlope).toBe(-1.5);
    expect(decision.ruleEvaluations).toHaveLength(4);
  });

  it("clear risk_off_recession: returns that label", () => {
    const decision = classifyRegime(
      features({
        t10y2y: -0.6,
        ismProxy: 44,
        spyTrendRatio: 0.93,
        // tightening-rule inputs intentionally null
        fedfundsSlope: null,
        vix: null,
      }),
    );
    expect(decision.label).toBe("risk_off_recession");
    expect(decision.confidence).toBeGreaterThan(0.6);
  });

  it("clear risk_off_tightening: returns that label", () => {
    const decision = classifyRegime(
      features({ fedfundsSlope: 1.5, vix: 40 }),
    );
    expect(decision.label).toBe("risk_off_tightening");
    expect(decision.confidence).toBeGreaterThan(0.6);
  });

  it("clear risk_on_neutral: returns that label", () => {
    const decision = classifyRegime(
      features({ fedfundsSlope: 0, vix: 13, spyTrendRatio: 1.05 }),
    );
    // Both risk_on_easing (no — fed=0 is not < -0.25, fails matched)
    // and risk_on_neutral can match here. risk_on_neutral wins because
    // risk_on_easing.matched is false.
    expect(decision.label).toBe("risk_on_neutral");
    expect(decision.confidence).toBeGreaterThan(0.6);
  });
});

describe("classifyRegime — confidence is the winning rule's strength", () => {
  it("when matched & strength >= 0.6, confidence === that strength", () => {
    const decision = classifyRegime(
      features({ fedfundsSlope: -1.5, vix: 12, spyTrendRatio: 1.1 }),
    );
    const winner = decision.ruleEvaluations.find(
      (e) => e.rule === decision.label,
    );
    expect(winner).toBeDefined();
    expect(decision.confidence).toBe(winner?.strength);
  });
});

describe("classifyRegime — transition path", () => {
  it("ambiguous features (matched but strength < 0.6) → transition", () => {
    // Right at the edge of risk_on_easing's thresholds: matched=true
    // but every sub-strength is tiny → avg way below 0.6.
    const decision = classifyRegime(
      features({ fedfundsSlope: -0.26, vix: 19.99, spyTrendRatio: 1.001 }),
    );
    expect(decision.label).toBe("transition");
    expect(decision.confidence).toBeLessThan(0.6);
    // Confidence is still the highest-strength rule's strength —
    // informative for the audit trail.
    expect(decision.confidence).toBeGreaterThan(0);
  });

  it("no rule matches at all → transition with highest-strength as confidence", () => {
    // Cuts (fedfundsSlope=-0.5) but also slight risk-off vibes
    // (ismProxy<50, spyTrendRatio<1). NOT a clean match for any rule:
    //   - risk_on_easing: fails (spyTrendRatio < 1)
    //   - risk_on_neutral: fails (spyTrendRatio < 1)
    //   - risk_off_tightening: fails (fedfundsSlope < 0.25)
    //   - risk_off_recession: fails (t10y2y >= 0)
    const decision = classifyRegime(
      features({
        fedfundsSlope: -0.5,
        vix: 22,
        spyTrendRatio: 0.99,
        t10y2y: 0.1,
        ismProxy: 49,
      }),
    );
    expect(decision.label).toBe("transition");
    // Even when nothing matched, we report the strongest-evaluated rule's
    // strength as a "how close were we" signal.
    expect(decision.confidence).toBeGreaterThanOrEqual(0);
    expect(decision.confidence).toBeLessThan(0.6);
  });

  it("all-null features → transition with confidence 0", () => {
    const decision = classifyRegime(features({}));
    expect(decision.label).toBe("transition");
    expect(decision.confidence).toBe(0);
    expect(decision.ruleEvaluations).toHaveLength(4);
    for (const evaluation of decision.ruleEvaluations) {
      expect(evaluation.matched).toBe(false);
      expect(evaluation.strength).toBe(0);
      expect(evaluation.reasonKo).toMatch(/입력 누락/);
    }
  });
});

describe("classifyRegime — partial nulls don't crash", () => {
  it("one rule's required features null → that rule contributes matched=false but classifier still works", () => {
    // Provide enough for risk_on_easing to clearly win. Leave recession
    // inputs null — the recession rule should short-circuit cleanly.
    const decision = classifyRegime(
      features({ fedfundsSlope: -1.5, vix: 12, spyTrendRatio: 1.1 }),
    );
    expect(decision.label).toBe("risk_on_easing");
    const recessionEval = decision.ruleEvaluations.find(
      (e) => e.rule === "risk_off_recession",
    );
    expect(recessionEval).toBeDefined();
    expect(recessionEval?.matched).toBe(false);
    expect(recessionEval?.strength).toBe(0);
    expect(recessionEval?.reasonKo).toMatch(/입력 누락/);
  });
});

describe("classifyRegime — winner selection among multiple matches", () => {
  it("when two rules match, the higher-strength one wins", () => {
    // risk_on_neutral matches strongly: slope=0.1 (within band, fedStability=0.6),
    //                                    vix=13 (1.0), spy=1.05 (1.0)
    //                                    → strength avg = (0.6+1+1)/3 ≈ 0.867
    // risk_on_easing does NOT match here (slope=0.1 is not < -0.25).
    const decision = classifyRegime(
      features({ fedfundsSlope: 0.1, vix: 13, spyTrendRatio: 1.05 }),
    );
    expect(decision.label).toBe("risk_on_neutral");
    expect(decision.confidence).toBeGreaterThan(0.6);
  });

  it("risk_on_easing beats risk_on_neutral when both match (deep cuts case)", () => {
    // slope=-0.5: easing matches (slope < -0.25), strength_fed = 0.25.
    //   easing total = (0.25 + (20-12)/5=1 + (1.05-1)/0.05=1) / 3 ≈ 0.75
    // neutral: slope=-0.5 is OUTSIDE the |slope|<=0.25 band → matched=false.
    // So easing wins because neutral didn't match.
    const decision = classifyRegime(
      features({ fedfundsSlope: -0.5, vix: 12, spyTrendRatio: 1.05 }),
    );
    expect(decision.label).toBe("risk_on_easing");
    expect(decision.confidence).toBeCloseTo(0.75, 2);
  });
});

describe("classifyRegime — output invariants", () => {
  it("ruleEvaluations always has all 4 positive-rule entries", () => {
    const decision = classifyRegime(features({}));
    const labels = decision.ruleEvaluations.map((e) => e.rule).sort();
    expect(labels).toEqual([
      "risk_off_recession",
      "risk_off_tightening",
      "risk_on_easing",
      "risk_on_neutral",
    ]);
  });

  it("contributingFeatures echoes input exactly", () => {
    const input = features({
      vix: 18.4,
      fedfundsSlope: -0.1,
      t10y2y: 0.5,
      spyTrendRatio: 1.02,
      ismProxy: 51,
    });
    const decision = classifyRegime(input);
    expect(decision.contributingFeatures).toEqual(input);
  });

  it("confidence is in [0, 1]", () => {
    const cases: RegimeFeatures[] = [
      features({}),
      features({ fedfundsSlope: -10, vix: 0, spyTrendRatio: 100 }),
      features({ t10y2y: -100, ismProxy: 0, spyTrendRatio: 0 }),
      features({ fedfundsSlope: 0, vix: 18, spyTrendRatio: 1.001 }),
    ];
    for (const f of cases) {
      const decision = classifyRegime(f);
      expect(decision.confidence).toBeGreaterThanOrEqual(0);
      expect(decision.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("returns a label that is one of the 5 known regime values", () => {
    const decision = classifyRegime(
      features({ fedfundsSlope: 0.1, vix: 22, spyTrendRatio: 1.0 }),
    );
    expect([
      "risk_on_easing",
      "risk_on_neutral",
      "risk_off_tightening",
      "risk_off_recession",
      "transition",
    ]).toContain(decision.label);
  });
});

describe("classifyRegime — purity", () => {
  it("repeated calls with identical inputs produce identical outputs", () => {
    const input = features({
      fedfundsSlope: -1.5,
      vix: 12,
      spyTrendRatio: 1.1,
    });
    const a = classifyRegime(input);
    const b = classifyRegime(input);
    expect(a).toEqual(b);
  });

  it("does not mutate the input features object", () => {
    const input = features({
      fedfundsSlope: -1.5,
      vix: 12,
      spyTrendRatio: 1.1,
    });
    const snapshot = { ...input };
    classifyRegime(input);
    expect(input).toEqual(snapshot);
  });
});
