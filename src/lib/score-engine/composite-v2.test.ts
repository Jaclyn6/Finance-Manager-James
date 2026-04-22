import { describe, expect, it } from "vitest";

import { computeCompositeV2 } from "./composite-v2";
import type { CategoryScores } from "./types";

/**
 * Helper — builds a full {@link CategoryScores} with defaults, so
 * tests can express "everything null except the one I care about"
 * concisely.
 */
function scores(partial: Partial<CategoryScores>): CategoryScores {
  return {
    macro: null,
    technical: null,
    onchain: null,
    sentiment: null,
    ...partial,
  };
}

describe("computeCompositeV2", () => {
  // -------------------------------------------------------------------
  // Happy paths
  // -------------------------------------------------------------------

  it("equal scores across all applicable categories give back that score", () => {
    // US equity applies to macro, technical, sentiment. Onchain is
    // not-applicable — passing 70 there should be ignored entirely.
    const result = computeCompositeV2(
      scores({ macro: 70, technical: 70, onchain: 70, sentiment: 70 }),
      "us_equity",
    );
    expect(result.score0to100).toBeCloseTo(70, 5);
    expect(result.missingCategories).toEqual([]);
    expect(Object.keys(result.contributing)).toEqual([
      "macro",
      "technical",
      "sentiment",
    ]);
  });

  it("us_equity — hand-computed weighted sum matches CATEGORY_WEIGHTS", () => {
    // macro 45 * 80 + technical 35 * 60 + sentiment 20 * 40, all / 100
    //  = 3600 + 2100 + 800 / 100 = 6500 / 100 = 65
    const result = computeCompositeV2(
      scores({ macro: 80, technical: 60, sentiment: 40 }),
      "us_equity",
    );
    expect(result.score0to100).toBeCloseTo(65, 5);

    // Weights should sum to 1 across present categories.
    const sumWeights = Object.values(result.contributing).reduce(
      (acc, c) => acc + (c?.weight ?? 0),
      0,
    );
    expect(sumWeights).toBeCloseTo(1, 5);
  });

  it("crypto — hand-computed 4-category weighted sum", () => {
    // weights: macro 25, technical 25, onchain 35, sentiment 15
    //  sum = 100
    // scores: macro 40, technical 60, onchain 80, sentiment 50
    //  = (25*40 + 25*60 + 35*80 + 15*50) / 100
    //  = (1000 + 1500 + 2800 + 750) / 100 = 6050/100 = 60.5
    const result = computeCompositeV2(
      scores({ macro: 40, technical: 60, onchain: 80, sentiment: 50 }),
      "crypto",
    );
    expect(result.score0to100).toBeCloseTo(60.5, 5);
    expect(result.missingCategories).toEqual([]);
    expect(Object.keys(result.contributing).sort()).toEqual([
      "macro",
      "onchain",
      "sentiment",
      "technical",
    ]);
  });

  it("kr_equity — regional overlay folds into macro (weight 65)", () => {
    // weights: macro 65, technical 25, sentiment 10 → sum 100
    // scores: macro 50, technical 100, sentiment 0
    // = (65*50 + 25*100 + 10*0) / 100 = (3250 + 2500 + 0)/100 = 57.5
    const result = computeCompositeV2(
      scores({ macro: 50, technical: 100, sentiment: 0 }),
      "kr_equity",
    );
    expect(result.score0to100).toBeCloseTo(57.5, 5);
    // macro must dominate kr_equity (65/100)
    expect(result.contributing.macro?.weight).toBeCloseTo(0.65, 5);
  });

  // -------------------------------------------------------------------
  // Null propagation + renormalization
  // -------------------------------------------------------------------

  it("macro-only rollout — composite equals macro score exactly (renormalization)", () => {
    // At Step 6 cutover, only macro is populated. The composite must
    // equal macro exactly — NOT be diluted toward 50 by the three null
    // categories.
    const result = computeCompositeV2(scores({ macro: 73 }), "us_equity");
    expect(result.score0to100).toBeCloseTo(73, 5);
    expect(result.contributing.macro?.weight).toBeCloseTo(1, 5);
    expect(result.contributing.macro?.contribution).toBeCloseTo(73, 5);
    expect(result.missingCategories.sort()).toEqual([
      "sentiment",
      "technical",
    ]);
  });

  it("null sentiment on us_equity — only macro+technical renormalize (45+35=80)", () => {
    // macro 45/80 + technical 35/80 = 0.5625 + 0.4375 = 1.0
    // scores: macro 80, technical 40, sentiment null
    // composite = 80 * 0.5625 + 40 * 0.4375 = 45 + 17.5 = 62.5
    const result = computeCompositeV2(
      scores({ macro: 80, technical: 40, sentiment: null }),
      "us_equity",
    );
    expect(result.score0to100).toBeCloseTo(62.5, 5);
    expect(result.contributing.macro?.weight).toBeCloseTo(45 / 80, 5);
    expect(result.contributing.technical?.weight).toBeCloseTo(35 / 80, 5);
    expect(result.missingCategories).toEqual(["sentiment"]);
    expect(result.contributing.sentiment).toBeUndefined();
  });

  it("crypto with only onchain present — composite equals onchain score", () => {
    // Even though onchain is "just" one of four crypto categories, if
    // the other three are null, onchain's renormalized weight is 1.0
    // and the composite equals the onchain score.
    const result = computeCompositeV2(scores({ onchain: 88 }), "crypto");
    expect(result.score0to100).toBeCloseTo(88, 5);
    expect(result.contributing.onchain?.weight).toBeCloseTo(1, 5);
    expect(result.missingCategories.sort()).toEqual([
      "macro",
      "sentiment",
      "technical",
    ]);
  });

  it("all applicable categories null — returns neutral 50 + empty contributing", () => {
    const result = computeCompositeV2(scores({}), "us_equity");
    expect(result).toEqual({
      score0to100: 50,
      contributing: {},
      // us_equity has 3 applicable categories — onchain is not-
      // applicable and must NOT appear in missingCategories.
      missingCategories: ["macro", "technical", "sentiment"],
    });
  });

  it("crypto all-null — all 4 categories show as missing", () => {
    const result = computeCompositeV2(scores({}), "crypto");
    expect(result.score0to100).toBe(50);
    expect(result.contributing).toEqual({});
    expect(result.missingCategories.sort()).toEqual([
      "macro",
      "onchain",
      "sentiment",
      "technical",
    ]);
  });

  // -------------------------------------------------------------------
  // Not-applicable handling
  // -------------------------------------------------------------------

  it("not-applicable categories are NOT added to missingCategories", () => {
    // us_equity has no on-chain weight. A null onchain score should
    // be silently ignored — not surfaced as missing.
    const result = computeCompositeV2(
      scores({ macro: 50, technical: 50, sentiment: 50, onchain: null }),
      "us_equity",
    );
    expect(result.missingCategories).toEqual([]);
    expect(result.contributing.onchain).toBeUndefined();
  });

  it("not-applicable category with a valid score is still ignored", () => {
    // Someone passes 100 for onchain on us_equity. That category has
    // no weight → it should not affect the composite.
    const withOnchain = computeCompositeV2(
      scores({ macro: 50, technical: 50, sentiment: 50, onchain: 100 }),
      "us_equity",
    );
    const withoutOnchain = computeCompositeV2(
      scores({ macro: 50, technical: 50, sentiment: 50 }),
      "us_equity",
    );
    expect(withOnchain.score0to100).toBeCloseTo(
      withoutOnchain.score0to100,
      10,
    );
    expect(withOnchain.contributing.onchain).toBeUndefined();
  });

  // -------------------------------------------------------------------
  // Phase-1-parity invariant: capped sentiment (§0.5 trade-off)
  // -------------------------------------------------------------------

  it("us_equity — sentiment=0 vs others=100 drops composite by EXACTLY sentiment's 20-point share", () => {
    // Mirrors the Step 5 sentiment-capped test at the composite layer.
    // sentiment weight on us_equity = 20/100 = 0.20.
    // All 100s vs sentiment-0 scenario:
    //   base = (45+35+20)*100/100 = 100
    //   low  = (45*100 + 35*100 + 20*0)/100 = 80
    // drop = 20, which is exactly sentiment's share of the total.
    const allMax = computeCompositeV2(
      scores({ macro: 100, technical: 100, sentiment: 100 }),
      "us_equity",
    );
    const sentimentZero = computeCompositeV2(
      scores({ macro: 100, technical: 100, sentiment: 0 }),
      "us_equity",
    );
    expect(allMax.score0to100).toBeCloseTo(100, 5);
    expect(sentimentZero.score0to100).toBeCloseTo(80, 5);
    expect(allMax.score0to100 - sentimentZero.score0to100).toBeCloseTo(20, 5);
  });

  it("us_equity — sentiment=100 vs others=0 lifts composite by EXACTLY sentiment's 20-point share", () => {
    // Inverse check — sentiment CANNOT drag the composite above its
    // weight share. The "보조 지표로만 사용" guarantee (PRD §8.4 line
    // 172) holds both directions.
    const allZero = computeCompositeV2(
      scores({ macro: 0, technical: 0, sentiment: 0 }),
      "us_equity",
    );
    const sentimentMax = computeCompositeV2(
      scores({ macro: 0, technical: 0, sentiment: 100 }),
      "us_equity",
    );
    expect(allZero.score0to100).toBeCloseTo(0, 5);
    expect(sentimentMax.score0to100).toBeCloseTo(20, 5);
  });

  // -------------------------------------------------------------------
  // contributing shape invariants
  // -------------------------------------------------------------------

  it("contributing weights sum to 1 across any subset of present categories", () => {
    // Arbitrary subset — onchain + sentiment only for crypto.
    const result = computeCompositeV2(
      scores({ onchain: 50, sentiment: 50 }),
      "crypto",
    );
    const sumWeights = Object.values(result.contributing).reduce(
      (acc, c) => acc + (c?.weight ?? 0),
      0,
    );
    expect(sumWeights).toBeCloseTo(1, 5);
    // Crypto weights: onchain 35, sentiment 15. Subset sum 50.
    //   onchain normalized = 35/50 = 0.7
    //   sentiment normalized = 15/50 = 0.3
    expect(result.contributing.onchain?.weight).toBeCloseTo(0.7, 5);
    expect(result.contributing.sentiment?.weight).toBeCloseTo(0.3, 5);
    expect(result.missingCategories.sort()).toEqual(["macro", "technical"]);
  });

  it("contribution = score × normalized weight for every present category", () => {
    const result = computeCompositeV2(
      scores({ macro: 80, technical: 60, sentiment: 40 }),
      "us_equity",
    );
    for (const [, entry] of Object.entries(result.contributing)) {
      if (!entry) continue;
      expect(entry.contribution).toBeCloseTo(entry.score * entry.weight, 10);
    }
    // And composite = sum of contributions.
    const sumContrib = Object.values(result.contributing).reduce(
      (acc, c) => acc + (c?.contribution ?? 0),
      0,
    );
    expect(result.score0to100).toBeCloseTo(sumContrib, 10);
  });

  // -------------------------------------------------------------------
  // Defensive: NaN / Infinity category scores
  // -------------------------------------------------------------------

  it("coerces NaN category score to missing (not to neutral)", () => {
    // A misbehaving upstream path might send NaN. Treat as missing —
    // renormalize around the remaining present categories rather than
    // silently injecting a neutral 50 (that would violate §4.5 tenet 1).
    const result = computeCompositeV2(
      {
        macro: 80,
        technical: Number.NaN,
        onchain: null,
        sentiment: 40,
      },
      "us_equity",
    );
    expect(result.missingCategories).toContain("technical");
    // composite = (45*80 + 20*40) / (45+20) = (3600+800)/65 = 67.692...
    expect(result.score0to100).toBeCloseTo(4400 / 65, 5);
    expect(result.contributing.technical).toBeUndefined();
  });

  it("coerces Infinity category score to missing", () => {
    const result = computeCompositeV2(
      {
        macro: Number.POSITIVE_INFINITY,
        technical: 50,
        onchain: null,
        sentiment: 50,
      },
      "us_equity",
    );
    expect(result.missingCategories).toContain("macro");
    expect(Number.isFinite(result.score0to100)).toBe(true);
    // Remaining: technical 35/55 * 50 + sentiment 20/55 * 50
    // = (35 + 20) * 50 / 55 = 50
    expect(result.score0to100).toBeCloseTo(50, 5);
  });
});
