import { describe, expect, it } from "vitest";

import { computeCompositeV2 } from "./composite-v2";
import type { CategoryScores } from "./types";

/**
 * Helper — builds a full {@link CategoryScores} with all categories
 * null by default, so tests can express "everything null except the
 * ones I care about" concisely.
 */
function scores(partial: Partial<CategoryScores>): CategoryScores {
  return {
    macro: null,
    technical: null,
    onchain: null,
    sentiment: null,
    valuation: null,
    regional_overlay: null,
    ...partial,
  };
}

describe("computeCompositeV2", () => {
  // -------------------------------------------------------------------
  // Happy paths
  // -------------------------------------------------------------------

  it("equal scores across all applicable categories give back that score", () => {
    // US equity applies to macro, technical, sentiment, valuation.
    // Onchain / regional_overlay are not-applicable — passing 70 there
    // should be ignored entirely.
    const result = computeCompositeV2(
      scores({
        macro: 70,
        technical: 70,
        onchain: 70,
        sentiment: 70,
        valuation: 70,
        regional_overlay: 70,
      }),
      "us_equity",
    );
    expect(result.score0to100).toBeCloseTo(70, 5);
    expect(result.missingCategories).toEqual([]);
    expect(Object.keys(result.contributing).sort()).toEqual([
      "macro",
      "sentiment",
      "technical",
      "valuation",
    ]);
  });

  it("us_equity — hand-computed weighted sum matches CATEGORY_WEIGHTS", () => {
    // weights: macro 45, technical 35, sentiment 10, valuation 10
    // scores : 80,       60,          40,           50 (valuation pinned)
    // = (45*80 + 35*60 + 10*40 + 10*50) / 100
    // = (3600 + 2100 + 400 + 500) / 100 = 6600 / 100 = 66
    const result = computeCompositeV2(
      scores({ macro: 80, technical: 60, sentiment: 40, valuation: 50 }),
      "us_equity",
    );
    expect(result.score0to100).toBeCloseTo(66, 5);

    const sumWeights = Object.values(result.contributing).reduce(
      (acc, c) => acc + (c?.weight ?? 0),
      0,
    );
    expect(sumWeights).toBeCloseTo(1, 5);
  });

  it("crypto — hand-computed 4-category weighted sum", () => {
    // weights: macro 25, technical 25, onchain 35, sentiment 15 → 100
    // scores : 40,       60,          80,         50
    // = (25*40 + 25*60 + 35*80 + 15*50) / 100
    // = (1000 + 1500 + 2800 + 750) / 100 = 6050 / 100 = 60.5
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

  it("kr_equity — regional overlay is its own category at weight 20", () => {
    // weights: macro 45, technical 25, regional_overlay 20, sentiment 10 → 100
    // scores : 50,       100,          75,                  0
    // = (45*50 + 25*100 + 20*75 + 10*0) / 100
    // = (2250 + 2500 + 1500 + 0) / 100 = 62.5
    const result = computeCompositeV2(
      scores({
        macro: 50,
        technical: 100,
        regional_overlay: 75,
        sentiment: 0,
      }),
      "kr_equity",
    );
    expect(result.score0to100).toBeCloseTo(62.5, 5);
    expect(result.contributing.macro?.weight).toBeCloseTo(0.45, 5);
    expect(result.contributing.regional_overlay?.weight).toBeCloseTo(0.2, 5);
  });

  // -------------------------------------------------------------------
  // Null propagation + renormalization
  // -------------------------------------------------------------------

  it("macro-only rollout — composite equals macro score exactly (renormalization)", () => {
    // At Step 6 cutover, only macro is populated. Valuation is pinned
    // to 50 at us_equity (simulating the cron's Phase-2 behavior).
    // The composite must equal the weighted blend of macro + valuation
    // since those are the only two present categories.
    //
    // weights: macro 45, valuation 10 → subset sum 55
    // scores : 73,       50 (pinned)
    // = (45*73 + 10*50) / 55 = (3285 + 500) / 55 = 3785/55 = 68.8181...
    const result = computeCompositeV2(
      scores({ macro: 73, valuation: 50 }),
      "us_equity",
    );
    expect(result.score0to100).toBeCloseTo(3785 / 55, 5);
    expect(result.missingCategories.sort()).toEqual(["sentiment", "technical"]);
  });

  it("null sentiment on us_equity — macro+technical+valuation renormalize", () => {
    // weights: macro 45 + technical 35 + valuation 10 = 90 (sentiment excluded)
    // scores : 80,        40,           50
    // composite = (45*80 + 35*40 + 10*50) / 90
    //           = (3600 + 1400 + 500) / 90 = 5500 / 90 = 61.111...
    const result = computeCompositeV2(
      scores({
        macro: 80,
        technical: 40,
        sentiment: null,
        valuation: 50,
      }),
      "us_equity",
    );
    expect(result.score0to100).toBeCloseTo(5500 / 90, 5);
    expect(result.contributing.macro?.weight).toBeCloseTo(45 / 90, 5);
    expect(result.contributing.technical?.weight).toBeCloseTo(35 / 90, 5);
    expect(result.contributing.valuation?.weight).toBeCloseTo(10 / 90, 5);
    expect(result.missingCategories).toEqual(["sentiment"]);
    expect(result.contributing.sentiment).toBeUndefined();
  });

  it("crypto with only onchain present — composite equals onchain score", () => {
    const result = computeCompositeV2(scores({ onchain: 88 }), "crypto");
    expect(result.score0to100).toBeCloseTo(88, 5);
    expect(result.contributing.onchain?.weight).toBeCloseTo(1, 5);
    expect(result.missingCategories.sort()).toEqual([
      "macro",
      "sentiment",
      "technical",
    ]);
  });

  it("all applicable us_equity categories null — returns neutral 50 + empty contributing", () => {
    const result = computeCompositeV2(scores({}), "us_equity");
    expect(result.score0to100).toBe(50);
    expect(result.contributing).toEqual({});
    // us_equity has 4 applicable categories — onchain and
    // regional_overlay are not-applicable and must NOT appear here.
    expect(result.missingCategories.sort()).toEqual([
      "macro",
      "sentiment",
      "technical",
      "valuation",
    ]);
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

  it("kr_equity all-null — regional_overlay lands in missing list", () => {
    const result = computeCompositeV2(scores({}), "kr_equity");
    expect(result.missingCategories.sort()).toEqual([
      "macro",
      "regional_overlay",
      "sentiment",
      "technical",
    ]);
  });

  // -------------------------------------------------------------------
  // Not-applicable handling
  // -------------------------------------------------------------------

  it("not-applicable categories are NOT added to missingCategories", () => {
    // us_equity has no on-chain or regional_overlay weight. Null
    // scores there should be silently ignored.
    const result = computeCompositeV2(
      scores({
        macro: 50,
        technical: 50,
        sentiment: 50,
        valuation: 50,
        onchain: null,
        regional_overlay: null,
      }),
      "us_equity",
    );
    expect(result.missingCategories).toEqual([]);
    expect(result.contributing.onchain).toBeUndefined();
    expect(result.contributing.regional_overlay).toBeUndefined();
  });

  it("not-applicable category with a valid score is still ignored", () => {
    const withOnchain = computeCompositeV2(
      scores({
        macro: 50,
        technical: 50,
        sentiment: 50,
        valuation: 50,
        onchain: 100,
      }),
      "us_equity",
    );
    const withoutOnchain = computeCompositeV2(
      scores({ macro: 50, technical: 50, sentiment: 50, valuation: 50 }),
      "us_equity",
    );
    expect(withOnchain.score0to100).toBeCloseTo(
      withoutOnchain.score0to100,
      10,
    );
    expect(withOnchain.contributing.onchain).toBeUndefined();
  });

  // -------------------------------------------------------------------
  // Capped-sentiment invariant (blueprint §4.1 + PRD §8.4)
  // -------------------------------------------------------------------

  it("us_equity — sentiment=0 vs others=100 drops composite by EXACTLY sentiment's 10-pt share", () => {
    // Mirrors the Step 5 sentiment-capped test at the composite layer.
    // sentiment weight on us_equity = 10/100 = 0.10.
    //
    // base = (45+35+10+10)*100/100 = 100
    // low  = (45*100 + 35*100 + 10*0 + 10*100)/100 = 90
    // drop = 10 — exactly sentiment's weight share, NOT 20 (which would
    // violate the capped-sentiment invariant by letting sentiment drag
    // the composite past its prescribed §4.1 influence).
    const allMax = computeCompositeV2(
      scores({ macro: 100, technical: 100, sentiment: 100, valuation: 100 }),
      "us_equity",
    );
    const sentimentZero = computeCompositeV2(
      scores({ macro: 100, technical: 100, sentiment: 0, valuation: 100 }),
      "us_equity",
    );
    expect(allMax.score0to100).toBeCloseTo(100, 5);
    expect(sentimentZero.score0to100).toBeCloseTo(90, 5);
    expect(allMax.score0to100 - sentimentZero.score0to100).toBeCloseTo(10, 5);
  });

  it("us_equity — sentiment=100 vs others=0 lifts composite by EXACTLY sentiment's 10-pt share", () => {
    // Inverse check: sentiment CANNOT lift the composite above its
    // weight share. "보조 지표로만 사용" (PRD §8.4 line 172) both
    // directions.
    const allZero = computeCompositeV2(
      scores({ macro: 0, technical: 0, sentiment: 0, valuation: 0 }),
      "us_equity",
    );
    const sentimentMax = computeCompositeV2(
      scores({ macro: 0, technical: 0, sentiment: 100, valuation: 0 }),
      "us_equity",
    );
    expect(allZero.score0to100).toBeCloseTo(0, 5);
    expect(sentimentMax.score0to100).toBeCloseTo(10, 5);
  });

  // -------------------------------------------------------------------
  // contributing shape invariants
  // -------------------------------------------------------------------

  it("contributing weights sum to 1 across any subset of present categories", () => {
    const result = computeCompositeV2(
      scores({ onchain: 50, sentiment: 50 }),
      "crypto",
    );
    const sumWeights = Object.values(result.contributing).reduce(
      (acc, c) => acc + (c?.weight ?? 0),
      0,
    );
    expect(sumWeights).toBeCloseTo(1, 5);
    // onchain 35, sentiment 15 → subset sum 50
    //   onchain normalized = 35/50 = 0.7
    //   sentiment normalized = 15/50 = 0.3
    expect(result.contributing.onchain?.weight).toBeCloseTo(0.7, 5);
    expect(result.contributing.sentiment?.weight).toBeCloseTo(0.3, 5);
    expect(result.missingCategories.sort()).toEqual(["macro", "technical"]);
  });

  it("contribution = score × normalized weight for every present category", () => {
    const result = computeCompositeV2(
      scores({ macro: 80, technical: 60, sentiment: 40, valuation: 50 }),
      "us_equity",
    );
    for (const [, entry] of Object.entries(result.contributing)) {
      if (!entry) continue;
      expect(entry.contribution).toBeCloseTo(entry.score * entry.weight, 10);
    }
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
    // Missing categories renormalize over remaining. valuation=50
    // pinned, macro=80, technical=NaN → missing, sentiment=40.
    // subset: macro 45 + sentiment 10 + valuation 10 = 65
    // composite = (45*80 + 10*40 + 10*50)/65 = (3600+400+500)/65 = 4500/65
    const result = computeCompositeV2(
      scores({
        macro: 80,
        technical: Number.NaN,
        sentiment: 40,
        valuation: 50,
      }),
      "us_equity",
    );
    expect(result.missingCategories).toEqual(["technical"]);
    expect(result.score0to100).toBeCloseTo(4500 / 65, 5);
    expect(result.contributing.technical).toBeUndefined();
  });

  it("coerces Infinity category score to missing", () => {
    const result = computeCompositeV2(
      scores({
        macro: Number.POSITIVE_INFINITY,
        technical: 50,
        sentiment: 50,
        valuation: 50,
      }),
      "us_equity",
    );
    expect(result.missingCategories).toContain("macro");
    expect(Number.isFinite(result.score0to100)).toBe(true);
    // subset: technical 35 + sentiment 10 + valuation 10 = 55
    // composite = (35*50 + 10*50 + 10*50)/55 = 50
    expect(result.score0to100).toBeCloseTo(50, 5);
  });

  // -------------------------------------------------------------------
  // kr_equity populated regional_overlay (Phase C Step 7 wiring)
  // -------------------------------------------------------------------

  it("kr_equity — macro + regional_overlay populated (Step 7 ingest-macro path)", () => {
    // Simulates the state of the cron between Step 7 (this commit) and
    // Step 8: macro category fully computed from 7 FRED series, and
    // regional_overlay averaged from DTWEXBGS + DEXKOUS scores.
    // Technical + sentiment remain null until their ingest endpoints
    // land at Step 7 (hourly workflow, Agents A/B).
    //
    // weights: macro 45, regional_overlay 20 → subset sum 65
    //          (technical 25 + sentiment 10 land in missingCategories)
    // scores : macro 60,  regional_overlay 40
    // = (45*60 + 20*40) / 65 = (2700 + 800) / 65 = 3500 / 65
    const result = computeCompositeV2(
      scores({ macro: 60, regional_overlay: 40 }),
      "kr_equity",
    );
    expect(result.score0to100).toBeCloseTo(3500 / 65, 5);
    expect(result.contributing.macro?.weight).toBeCloseTo(45 / 65, 5);
    expect(result.contributing.regional_overlay?.weight).toBeCloseTo(
      20 / 65,
      5,
    );
    expect(result.missingCategories.sort()).toEqual(["sentiment", "technical"]);
  });
});
