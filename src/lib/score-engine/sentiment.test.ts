import { describe, expect, it } from "vitest";

import {
  MAX_SENTIMENT_WEIGHT_FRACTION,
  cnnFearGreedToScore,
  finnhubSentimentToScore,
  sentimentCategoryScore,
} from "./sentiment";

// ---------------------------------------------------------------------------
// Finnhub per-ticker → 0-100 score
// ---------------------------------------------------------------------------

describe("finnhubSentimentToScore", () => {
  it("returns 100 for fully bullish (bullish=1.0, bearish=0.0)", () => {
    // score = 50 + (1.0 - 0.0) * 50 = 100
    expect(finnhubSentimentToScore(1.0, 0.0, 100)).toBe(100);
  });

  it("returns 50 for balanced coverage (bullish=0.5, bearish=0.5)", () => {
    // score = 50 + (0.5 - 0.5) * 50 = 50
    expect(finnhubSentimentToScore(0.5, 0.5, 100)).toBe(50);
  });

  it("returns 0 for fully bearish (bullish=0.0, bearish=1.0)", () => {
    // score = 50 + (0.0 - 1.0) * 50 = 0
    expect(finnhubSentimentToScore(0.0, 1.0, 100)).toBe(0);
  });

  it("returns null when bullishPercent is null (data-missing)", () => {
    expect(finnhubSentimentToScore(null, 0.3, 100)).toBeNull();
  });

  it("returns null when bearishPercent is null (data-missing)", () => {
    expect(finnhubSentimentToScore(0.7, null, 100)).toBeNull();
  });

  it("returns null when bullishPercent is NaN (defensive non-finite guard)", () => {
    expect(finnhubSentimentToScore(Number.NaN, 0.3, 100)).toBeNull();
  });

  it("returns null when bearishPercent is +Infinity (defensive non-finite guard)", () => {
    expect(
      finnhubSentimentToScore(0.3, Number.POSITIVE_INFINITY, 100),
    ).toBeNull();
  });

  it("returns 50 when articleCount is 0 regardless of percents (no-news is info-neutral)", () => {
    // Per finnhub-parse.ts contract note 2 — zero articles is NOT
    // missing-data, it's "Finnhub ran and saw no news". Score is 50
    // (neutral) and non-null, so the composite treats it as a known
    // signal rather than an amber unknown.
    expect(finnhubSentimentToScore(0.5, 0.5, 0)).toBe(50);
    expect(finnhubSentimentToScore(1.0, 0.0, 0)).toBe(50);
    expect(finnhubSentimentToScore(0.0, 1.0, 0)).toBe(50);
  });

  it("returns null for negative articleCount (physically impossible — data error)", () => {
    // A negative article count cannot be produced by any legitimate
    // upstream source. Treat it as a data-bug indicator (missing /
    // corrupt) rather than masking it as the same "no news" neutral
    // as articleCount=0. Surfacing null lets the staleness pipeline
    // pick up the anomaly.
    expect(finnhubSentimentToScore(0.5, 0.5, -1)).toBeNull();
    expect(finnhubSentimentToScore(0.8, 0.2, -5)).toBeNull();
  });

  it("defensively clamps pathological upstream values to [0, 100]", () => {
    // If a parser-contract drift ever lets a >1 percent through, the
    // score engine must still return a bounded value — no composite
    // should see a sentiment score of 110 or -5.
    // bullish=1.2, bearish=0 would compute to 110 pre-clamp.
    expect(finnhubSentimentToScore(1.2, 0, 100)).toBe(100);
    // bullish=0, bearish=1.2 would compute to -10 pre-clamp.
    expect(finnhubSentimentToScore(0, 1.2, 100)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CNN Stock F&G (market-level) → 0-100 score
// ---------------------------------------------------------------------------

describe("cnnFearGreedToScore", () => {
  it("returns 100 for extreme fear (cnn=0) — maximally favorable entry", () => {
    expect(cnnFearGreedToScore(0)).toBe(100);
  });

  it("returns 50 for a neutral cnn=50", () => {
    expect(cnnFearGreedToScore(50)).toBe(50);
  });

  it("returns 0 for extreme greed (cnn=100) — maximally unfavorable", () => {
    expect(cnnFearGreedToScore(100)).toBe(0);
  });

  it("returns null for null input (data-missing)", () => {
    expect(cnnFearGreedToScore(null)).toBeNull();
  });

  it("returns null for NaN (defensive non-finite guard)", () => {
    expect(cnnFearGreedToScore(Number.NaN)).toBeNull();
  });

  it("returns null for -Infinity (defensive non-finite guard)", () => {
    expect(cnnFearGreedToScore(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it("clamps below-range input to 100 (cnn=-10)", () => {
    // Pre-clamp `100 - (-10) = 110`; clamp tops at 100.
    expect(cnnFearGreedToScore(-10)).toBe(100);
  });

  it("clamps above-range input to 0 (cnn=110)", () => {
    // Pre-clamp `100 - 110 = -10`; clamp floors at 0.
    expect(cnnFearGreedToScore(110)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Combined sentiment category score
// ---------------------------------------------------------------------------

describe("sentimentCategoryScore — NaN integration paths", () => {
  it("falls through to Finnhub when cnnFearGreedScore is NaN (treated as missing)", () => {
    // NaN reaches cnnFearGreedToScore → null. Combiner then sees
    // Finnhub=60 + CNN=null → passthrough Finnhub value.
    const score = sentimentCategoryScore({
      finnhubBullishPercent: 0.6,
      finnhubBearishPercent: 0.4,
      finnhubArticleCount: 50,
      cnnFearGreedScore: Number.NaN,
    });
    expect(score).toBe(60);
  });

  it("returns null when Finnhub is null AND cnnFearGreedScore is NaN", () => {
    // Both sources effectively missing (NaN CNN → null via converter).
    const score = sentimentCategoryScore({
      finnhubBullishPercent: null,
      finnhubBearishPercent: null,
      finnhubArticleCount: 0,
      cnnFearGreedScore: Number.NaN,
    });
    expect(score).toBeNull();
  });
});

describe("sentimentCategoryScore", () => {
  it("averages Finnhub and CNN when both are present", () => {
    // Finnhub: 50 + (0.6 - 0.4) * 50 = 60
    // CNN: 100 - 20 = 80
    // average: (60 + 80) / 2 = 70
    expect(
      sentimentCategoryScore({
        finnhubBullishPercent: 0.6,
        finnhubBearishPercent: 0.4,
        finnhubArticleCount: 50,
        cnnFearGreedScore: 20,
      }),
    ).toBe(70);
  });

  it("falls through to Finnhub-only when CNN is missing", () => {
    // Finnhub: 50 + (0.8 - 0.2) * 50 = 80
    expect(
      sentimentCategoryScore({
        finnhubBullishPercent: 0.8,
        finnhubBearishPercent: 0.2,
        finnhubArticleCount: 50,
        cnnFearGreedScore: null,
      }),
    ).toBe(80);
  });

  it("falls through to CNN-only when Finnhub is missing", () => {
    // CNN: 100 - 30 = 70
    expect(
      sentimentCategoryScore({
        finnhubBullishPercent: null,
        finnhubBearishPercent: null,
        finnhubArticleCount: 0,
        cnnFearGreedScore: 30,
      }),
    ).toBe(70);
  });

  it("returns null when both Finnhub and CNN are missing (fully-unknown category)", () => {
    // Per blueprint §4.5 tenet 1, a fully-unknown category MUST
    // surface as null so the composite can exclude it from the
    // weighted average (Step 6 pro-rata redistribution).
    expect(
      sentimentCategoryScore({
        finnhubBullishPercent: null,
        finnhubBearishPercent: null,
        finnhubArticleCount: 0,
        cnnFearGreedScore: null,
      }),
    ).toBeNull();
  });

  it("averages (Finnhub 80, CNN 40) → 60", () => {
    // Documented example from the plan spec — direct reproduction
    // so a future tweak of the combiner weighting shows up as a
    // test failure.
    expect(
      sentimentCategoryScore({
        finnhubBullishPercent: 0.8,
        finnhubBearishPercent: 0.2,
        finnhubArticleCount: 50,
        cnnFearGreedScore: 60, // cnnFearGreedToScore(60) = 40
      }),
    ).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// Capped-contribution invariant (the Step 5 acceptance test)
// ---------------------------------------------------------------------------
//
// Blueprint §4.1 + PRD §8.4 line 172: sentiment is a supplementary
// indicator ("보조 지표로만 사용") and MUST NOT drive the composite
// alone. This section directly asserts that for each asset class, a
// sentiment sub-score of 0 (against all-other-categories=100) can
// drop the composite by AT MOST the sentiment category weight — never
// more.
//
// Step 6 will own the real composite. Here we compute the weighted
// average inline so the invariant is pinned to the math, not to an
// implementation that doesn't yet exist.

describe("capped-contribution invariant (blueprint §4.1 + §4.2)", () => {
  /** Weighted-average helper — mirrors the composite's arithmetic. */
  function weightedAverage(
    weights: Record<string, number>,
    scores: Record<string, number>,
  ): number {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let sum = 0;
    for (const key of Object.keys(weights)) {
      sum += weights[key]! * scores[key]!;
    }
    return sum / total;
  }

  it("US equity composite: sentiment=0 drop is exactly the 10-weight cap", () => {
    // Blueprint §4.2 US equity row.
    const weights = { macro: 45, technical: 35, sentiment: 10, valuation: 10 };
    const allHundred = { macro: 100, technical: 100, sentiment: 100, valuation: 100 };
    const sentimentZeroed = { macro: 100, technical: 100, sentiment: 0, valuation: 100 };

    const baseline = weightedAverage(weights, allHundred);
    const withSentimentZero = weightedAverage(weights, sentimentZeroed);

    // With weights {45, 35, 10, 10} (total 100) and sentiment=0, all
    // others=100:
    //   (45*100 + 35*100 + 10*0 + 10*100) / 100 = 9000/100 = 90
    expect(baseline).toBe(100);
    expect(withSentimentZero).toBe(90);

    // The drop equals EXACTLY the sentiment weight — no more. This is
    // the blueprint §4.1 "sentiment cannot drive composite alone"
    // invariant expressed as an equality.
    const drop = baseline - withSentimentZero;
    const totalWeight =
      weights.macro + weights.technical + weights.sentiment + weights.valuation;
    const expectedCap = (weights.sentiment / totalWeight) * 100;
    expect(drop).toBe(expectedCap);
    expect(drop).toBe(10);
  });

  it("BTC/ETH composite: sentiment=0 drop is exactly the 15-weight cap", () => {
    // Blueprint §4.2 BTC/ETH row. Sentiment here includes ETF flows
    // (labelled "Sentiment (incl. ETF 수급)") so the cap is higher
    // than US equity.
    const weights = { onchain: 35, macro: 25, technical: 25, sentiment: 15 };
    const allHundred = { onchain: 100, macro: 100, technical: 100, sentiment: 100 };
    const sentimentZeroed = { onchain: 100, macro: 100, technical: 100, sentiment: 0 };

    const baseline = weightedAverage(weights, allHundred);
    const withSentimentZero = weightedAverage(weights, sentimentZeroed);

    // (35*100 + 25*100 + 25*100 + 15*0) / 100 = 8500/100 = 85
    expect(baseline).toBe(100);
    expect(withSentimentZero).toBe(85);

    const drop = baseline - withSentimentZero;
    const totalWeight =
      weights.onchain + weights.macro + weights.technical + weights.sentiment;
    const expectedCap = (weights.sentiment / totalWeight) * 100;
    expect(drop).toBe(expectedCap);
    expect(drop).toBe(15);
  });

  it("MAX_SENTIMENT_WEIGHT_FRACTION reflects the highest asset-class cap", () => {
    // Consumers (Step 6 composite tests, monitoring dashboards) use
    // this constant to assert "no sentiment category in the engine can
    // ever contribute more than this fraction to the composite".
    // 0.15 = 15/100 from the BTC/ETH row; higher than 0.10 for
    // US/KR/ETF. A future blueprint revision that raises a sentiment
    // weight beyond 15 must update this constant in lock-step, and
    // this test is the tripwire.
    expect(MAX_SENTIMENT_WEIGHT_FRACTION).toBe(0.15);

    // The BTC/ETH drop observed above (15) ÷ composite scale (100)
    // must equal the documented ceiling fraction exactly.
    const btcSentimentWeight = 15;
    const btcTotalWeight = 35 + 25 + 25 + 15;
    expect(btcSentimentWeight / btcTotalWeight).toBe(
      MAX_SENTIMENT_WEIGHT_FRACTION,
    );
  });
});
