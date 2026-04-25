import { describe, expect, it } from "vitest";

import {
  aggregateOnchain,
  aggregateRegionalOverlay,
  aggregateSentiment,
  aggregateTechnical,
  aggregateValuation,
  VALUATION_NEUTRAL_PIN,
  type NewsSentimentRowSlice,
  type OnchainRowSlice,
  type RegionalOverlayEntry,
  type TechnicalRowSlice,
} from "./category-aggregators";
import type { AssetType } from "./types";

// ---------------------------------------------------------------------------
// Technical
// ---------------------------------------------------------------------------

function techRow(
  ticker: string,
  assetType: AssetType,
  indicatorKey: string,
  score: number | null,
  fetchStatus: "success" | "partial" | "error" = "success",
): TechnicalRowSlice {
  return {
    ticker,
    asset_type: assetType,
    indicator_key: indicatorKey,
    score_0_100: score,
    fetch_status: fetchStatus,
  };
}

describe("aggregateTechnical", () => {
  it("us_equity — mean across SPY + QQQ per-ticker means", () => {
    const rows: TechnicalRowSlice[] = [
      // SPY: mean(60, 80) = 70
      techRow("SPY", "us_equity", "RSI_14", 60),
      techRow("SPY", "us_equity", "MACD_12_26_9", 80),
      // QQQ: mean(40, 50) = 45
      techRow("QQQ", "us_equity", "RSI_14", 40),
      techRow("QQQ", "us_equity", "MACD_12_26_9", 50),
      // Individual stocks must be ignored (not in TECHNICAL_PREFERRED_TICKERS).
      techRow("NVDA", "us_equity", "RSI_14", 0),
    ];
    const result = aggregateTechnical("us_equity", rows);
    expect(result.score).toBeCloseTo((70 + 45) / 2, 5);
    expect(Object.keys(result.indicators).sort()).toEqual(["QQQ", "SPY"]);
    expect(result.indicators.SPY).toEqual({
      score: 70,
      weight: 0.5,
      contribution: 35,
    });
  });

  it("us_equity — per-ticker fallback when some indicators missing", () => {
    // SPY has RSI only (MACD null); QQQ has all indicators. Both still count.
    const rows: TechnicalRowSlice[] = [
      techRow("SPY", "us_equity", "RSI_14", 60),
      techRow("SPY", "us_equity", "MACD_12_26_9", null, "partial"),
      techRow("QQQ", "us_equity", "RSI_14", 80),
      techRow("QQQ", "us_equity", "MACD_12_26_9", 40),
    ];
    const result = aggregateTechnical("us_equity", rows);
    // SPY mean = 60, QQQ mean = 60 → category = 60
    expect(result.score).toBe(60);
  });

  it("us_equity — falls back to all-us_equity tickers when preferred missing", () => {
    // No SPY/QQQ in row set but individual stocks ARE us_equity.
    const rows: TechnicalRowSlice[] = [
      techRow("NVDA", "us_equity", "RSI_14", 30),
      techRow("AAPL", "us_equity", "RSI_14", 70),
    ];
    const result = aggregateTechnical("us_equity", rows);
    expect(result.score).toBe(50);
    expect(Object.keys(result.indicators).sort()).toEqual(["AAPL", "NVDA"]);
  });

  it("kr_equity — uses 005930.KS as the representative", () => {
    const rows: TechnicalRowSlice[] = [
      techRow("005930.KS", "kr_equity", "RSI_14", 80),
      techRow("005930.KS", "kr_equity", "MACD_12_26_9", 20),
      // Other KR tickers should NOT override the preferred Samsung row.
      techRow("000660.KS", "kr_equity", "RSI_14", 10),
    ];
    const result = aggregateTechnical("kr_equity", rows);
    // 005930.KS mean = (80+20)/2 = 50
    expect(result.score).toBe(50);
    expect(Object.keys(result.indicators)).toEqual(["005930.KS"]);
  });

  it("global_etf — mean across GLD + EWJ + MCHI + INDA + TLT available rows", () => {
    const rows: TechnicalRowSlice[] = [
      techRow("GLD", "global_etf", "RSI_14", 60),
      techRow("EWJ", "global_etf", "RSI_14", 40),
    ];
    const result = aggregateTechnical("global_etf", rows);
    expect(result.score).toBe(50);
    expect(Object.keys(result.indicators).sort()).toEqual(["EWJ", "GLD"]);
  });

  it("crypto — returns null (not-applicable at Phase 2)", () => {
    // NOTE: crypto HAS a technical weight in CATEGORY_WEIGHTS (25), so
    // it IS applicable — but Phase 2 doesn't ingest technical rows for
    // crypto (CoinGecko price-only). With zero rows, we return null
    // which computeCompositeV2 surfaces as "missing".
    const result = aggregateTechnical("crypto", []);
    expect(result.score).toBeNull();
    expect(result.indicators).toEqual({});
  });

  it("returns null when all rows failed fetch_status", () => {
    const rows: TechnicalRowSlice[] = [
      techRow("SPY", "us_equity", "RSI_14", null, "error"),
      techRow("QQQ", "us_equity", "MACD_12_26_9", null, "partial"),
    ];
    const result = aggregateTechnical("us_equity", rows);
    expect(result.score).toBeNull();
  });

  it("returns null when rows array is empty", () => {
    expect(aggregateTechnical("us_equity", []).score).toBeNull();
  });

  it("common — behaves like us_equity (same preferred tickers)", () => {
    const rows: TechnicalRowSlice[] = [
      techRow("SPY", "us_equity", "RSI_14", 70),
      techRow("QQQ", "us_equity", "RSI_14", 30),
    ];
    const result = aggregateTechnical("common", rows);
    expect(result.score).toBe(50);
  });

  it("dedupes multi-day rows per (ticker, indicator_key) — DESC first-wins", () => {
    // Caller passes DESC-sorted rows (newest first). Yesterday's
    // RSI_14=40 must not blend with today's 70 — only today counts.
    // Without the dedup guard the aggregator would return (70+40)/2 = 55.
    const rows: TechnicalRowSlice[] = [
      techRow("SPY", "us_equity", "RSI_14", 70), // today (newest)
      techRow("SPY", "us_equity", "RSI_14", 40), // yesterday (stale)
      techRow("QQQ", "us_equity", "RSI_14", 70), // today
      techRow("QQQ", "us_equity", "RSI_14", 40), // yesterday
    ];
    const result = aggregateTechnical("us_equity", rows);
    // SPY = 70 (today only), QQQ = 70 (today only) → category = 70.
    expect(result.score).toBe(70);
    expect(result.score).not.toBe(55);
  });

  it("common — falls back to us_equity-tagged rows when SPY/QQQ missing", () => {
    // No SPY/QQQ available; only NVDA/AAPL (us_equity-tagged). The
    // common→us_equity fallback mapping keeps the category live instead
    // of going null (no row carries asset_type='common' in production).
    const rows: TechnicalRowSlice[] = [
      techRow("NVDA", "us_equity", "RSI_14", 30),
      techRow("AAPL", "us_equity", "RSI_14", 70),
    ];
    const result = aggregateTechnical("common", rows);
    expect(result.score).toBe(50);
    expect(Object.keys(result.indicators).sort()).toEqual(["AAPL", "NVDA"]);
  });
});

// ---------------------------------------------------------------------------
// On-chain
// ---------------------------------------------------------------------------

function onchainRow(
  indicatorKey: string,
  score: number | null,
  fetchStatus: "success" | "partial" | "error" = "success",
): OnchainRowSlice {
  return {
    indicator_key: indicatorKey,
    score_0_100: score,
    fetch_status: fetchStatus,
  };
}

describe("aggregateOnchain", () => {
  it("crypto — mean across MVRV_Z + SOPR + BTC_ETF_NETFLOW", () => {
    const rows: OnchainRowSlice[] = [
      onchainRow("MVRV_Z", 60),
      onchainRow("SOPR", 40),
      onchainRow("BTC_ETF_NETFLOW", 80),
      // CNN_FG and CRYPTO_FG must be ignored (sentiment inputs).
      onchainRow("CNN_FG", 10),
      onchainRow("CRYPTO_FG", 10),
    ];
    const result = aggregateOnchain("crypto", rows);
    expect(result.score).toBe(60);
    expect(Object.keys(result.indicators).sort()).toEqual([
      "BTC_ETF_NETFLOW",
      "MVRV_Z",
      "SOPR",
    ]);
  });

  it("crypto — partial data (only MVRV_Z present) still scores", () => {
    const rows: OnchainRowSlice[] = [onchainRow("MVRV_Z", 90)];
    const result = aggregateOnchain("crypto", rows);
    expect(result.score).toBe(90);
    expect(Object.keys(result.indicators)).toEqual(["MVRV_Z"]);
  });

  it("us_equity — not applicable (no onchain weight)", () => {
    const rows: OnchainRowSlice[] = [onchainRow("MVRV_Z", 50)];
    const result = aggregateOnchain("us_equity", rows);
    expect(result.score).toBeNull();
    expect(result.indicators).toEqual({});
  });

  it("crypto — null when all rows failed fetch_status", () => {
    const rows: OnchainRowSlice[] = [
      onchainRow("MVRV_Z", null, "error"),
      onchainRow("SOPR", null, "partial"),
    ];
    expect(aggregateOnchain("crypto", rows).score).toBeNull();
  });

  it("crypto — caller-ordered dedup: first row per key wins", () => {
    // If caller passes newest-first, the first MVRV_Z row is the latest.
    const rows: OnchainRowSlice[] = [
      onchainRow("MVRV_Z", 90), // newer
      onchainRow("MVRV_Z", 10), // older
    ];
    expect(aggregateOnchain("crypto", rows).score).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// Sentiment
// ---------------------------------------------------------------------------

function newsRow(
  ticker: string | null,
  score: number,
  fetchStatus: "success" | "partial" | "error" = "success",
): NewsSentimentRowSlice {
  return {
    ticker,
    asset_type: "us_equity",
    score_0_100: score,
    fetch_status: fetchStatus,
  };
}

describe("aggregateSentiment", () => {
  it("us_equity — 50/50 blend of news mean + CNN_FG when both present", () => {
    const rows: NewsSentimentRowSlice[] = [
      newsRow("NVDA", 60),
      newsRow("AAPL", 80),
    ];
    // News mean = 70; CNN = 40 → score = 55
    const result = aggregateSentiment("us_equity", {
      newsRows: rows,
      cnnFgScore: 40,
      cryptoFgScore: null,
    });
    expect(result.score).toBe(55);
    // Per-ticker weight = 0.5 / 2 = 0.25; CNN weight = 0.5
    expect(result.indicators.NVDA).toEqual({
      score: 60,
      weight: 0.25,
      contribution: 15,
    });
    expect(result.indicators.CNN_FG).toEqual({
      score: 40,
      weight: 0.5,
      contribution: 20,
    });
  });

  it("us_equity — news only when CNN_FG is null", () => {
    const rows: NewsSentimentRowSlice[] = [newsRow("NVDA", 70)];
    const result = aggregateSentiment("us_equity", {
      newsRows: rows,
      cnnFgScore: null,
      cryptoFgScore: null,
    });
    expect(result.score).toBe(70);
    expect(result.indicators.NVDA.weight).toBe(1);
  });

  it("us_equity — CNN_FG only when news rows empty", () => {
    const result = aggregateSentiment("us_equity", {
      newsRows: [],
      cnnFgScore: 80,
      cryptoFgScore: null,
    });
    expect(result.score).toBe(80);
    expect(result.indicators).toEqual({
      CNN_FG: { score: 80, weight: 1, contribution: 80 },
    });
  });

  it("us_equity — null when both news and CNN_FG missing", () => {
    const result = aggregateSentiment("us_equity", {
      newsRows: [],
      cnnFgScore: null,
      cryptoFgScore: null,
    });
    expect(result.score).toBeNull();
  });

  it("kr_equity — CNN_FG alone", () => {
    const result = aggregateSentiment("kr_equity", {
      newsRows: [newsRow("NVDA", 99)], // ignored — KR uses CNN only
      cnnFgScore: 55,
      cryptoFgScore: null,
    });
    expect(result.score).toBe(55);
    expect(Object.keys(result.indicators)).toEqual(["CNN_FG"]);
  });

  it("kr_equity — null when CNN_FG missing", () => {
    const result = aggregateSentiment("kr_equity", {
      newsRows: [],
      cnnFgScore: null,
      cryptoFgScore: null,
    });
    expect(result.score).toBeNull();
  });

  it("crypto — 50/50 blend of CNN_FG + CRYPTO_FG", () => {
    const result = aggregateSentiment("crypto", {
      newsRows: [],
      cnnFgScore: 60,
      cryptoFgScore: 80,
    });
    expect(result.score).toBe(70);
    expect(result.indicators).toEqual({
      CNN_FG: { score: 60, weight: 0.5, contribution: 30 },
      CRYPTO_FG: { score: 80, weight: 0.5, contribution: 40 },
    });
  });

  it("crypto — CRYPTO_FG only when CNN_FG missing", () => {
    const result = aggregateSentiment("crypto", {
      newsRows: [],
      cnnFgScore: null,
      cryptoFgScore: 90,
    });
    expect(result.score).toBe(90);
  });

  it("crypto — null when both F&Gs missing", () => {
    const result = aggregateSentiment("crypto", {
      newsRows: [],
      cnnFgScore: null,
      cryptoFgScore: null,
    });
    expect(result.score).toBeNull();
  });

  it("global_etf — same recipe as us_equity", () => {
    const rows: NewsSentimentRowSlice[] = [newsRow("NVDA", 100)];
    const result = aggregateSentiment("global_etf", {
      newsRows: rows,
      cnnFgScore: 0,
      cryptoFgScore: null,
    });
    // News mean=100, CNN=0 → 50
    expect(result.score).toBe(50);
  });

  it("filters out news rows with null ticker", () => {
    const rows: NewsSentimentRowSlice[] = [
      { ticker: null, asset_type: "us_equity", score_0_100: 80, fetch_status: "success" },
      newsRow("NVDA", 40),
    ];
    const result = aggregateSentiment("us_equity", {
      newsRows: rows,
      cnnFgScore: null,
      cryptoFgScore: null,
    });
    // Only NVDA counts.
    expect(result.score).toBe(40);
    expect(Object.keys(result.indicators)).toEqual(["NVDA"]);
  });

  it("filters out non-success news rows", () => {
    const rows: NewsSentimentRowSlice[] = [
      newsRow("NVDA", 50, "error"),
      newsRow("AAPL", 70, "partial"),
      newsRow("MSFT", 90, "success"),
    ];
    const result = aggregateSentiment("us_equity", {
      newsRows: rows,
      cnnFgScore: null,
      cryptoFgScore: null,
    });
    expect(result.score).toBe(90);
  });

  it("dedupes multi-day news rows per ticker — DESC first-wins (latest only)", () => {
    // Caller passes DESC-ordered rows; yesterday's NVDA=20 must not
    // blend with today's 80. Without the per-ticker dedup guard the
    // JSONB indicators submap silently collapses the duplicate and
    // inner weights (0.5/N) stop summing to 0.5.
    const rows: NewsSentimentRowSlice[] = [
      newsRow("NVDA", 80), // today
      newsRow("NVDA", 20), // yesterday (stale)
    ];
    const result = aggregateSentiment("us_equity", {
      newsRows: rows,
      cnnFgScore: null,
      cryptoFgScore: null,
    });
    // Only today's 80 contributes; news half takes full weight since
    // CNN_FG is null.
    expect(result.score).toBe(80);
    expect(Object.keys(result.indicators)).toEqual(["NVDA"]);
    expect(result.indicators.NVDA).toEqual({
      score: 80,
      weight: 1,
      contribution: 80,
    });
  });
});

// ---------------------------------------------------------------------------
// Valuation
// ---------------------------------------------------------------------------

describe("aggregateValuation", () => {
  it("us_equity — neutral 50 pin", () => {
    const result = aggregateValuation("us_equity");
    expect(result.score).toBe(VALUATION_NEUTRAL_PIN);
    expect(result.indicators).toEqual({});
  });

  it("global_etf — neutral 50 pin", () => {
    expect(aggregateValuation("global_etf").score).toBe(50);
  });

  it("common — neutral 50 pin", () => {
    expect(aggregateValuation("common").score).toBe(50);
  });

  it("kr_equity — null (no valuation weight)", () => {
    expect(aggregateValuation("kr_equity").score).toBeNull();
  });

  it("crypto — null (no valuation weight)", () => {
    expect(aggregateValuation("crypto").score).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Regional overlay
// ---------------------------------------------------------------------------

describe("aggregateRegionalOverlay", () => {
  it("kr_equity — weighted mean of DTWEXBGS + DEXKOUS with 0.5/0.5 weights", () => {
    const entries: RegionalOverlayEntry[] = [
      { key: "DTWEXBGS", score: 60, weight: 0.5 },
      { key: "DEXKOUS", score: 80, weight: 0.5 },
    ];
    const result = aggregateRegionalOverlay("kr_equity", entries);
    expect(result.score).toBe(70);
    expect(result.indicators.DTWEXBGS).toEqual({
      score: 60,
      weight: 0.5,
      contribution: 30,
    });
  });

  it("kr_equity — single-series fallback renormalizes 0.5 → 1.0", () => {
    const entries: RegionalOverlayEntry[] = [
      { key: "DTWEXBGS", score: 60, weight: 0.5 },
    ];
    const result = aggregateRegionalOverlay("kr_equity", entries);
    expect(result.score).toBe(60);
    expect(result.indicators.DTWEXBGS.weight).toBe(1);
  });

  it("kr_equity — null when entries empty (both series failed)", () => {
    expect(aggregateRegionalOverlay("kr_equity", []).score).toBeNull();
  });

  it("us_equity — not applicable (no regional_overlay weight)", () => {
    const entries: RegionalOverlayEntry[] = [
      { key: "DTWEXBGS", score: 60, weight: 0.5 },
    ];
    expect(aggregateRegionalOverlay("us_equity", entries).score).toBeNull();
  });

  it("kr_equity — filters non-finite / zero-weight entries", () => {
    const entries: RegionalOverlayEntry[] = [
      { key: "DTWEXBGS", score: 60, weight: 0.5 },
      { key: "BAD", score: Number.NaN, weight: 0.5 },
      { key: "ZERO", score: 20, weight: 0 },
    ];
    const result = aggregateRegionalOverlay("kr_equity", entries);
    // Only DTWEXBGS survives.
    expect(result.score).toBe(60);
    expect(Object.keys(result.indicators)).toEqual(["DTWEXBGS"]);
  });
});
