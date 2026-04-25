/**
 * Category aggregators — turn the Phase 2 reading tables into per-asset
 * category scores consumed by {@link computeCompositeV2}.
 *
 * Phase 2 §9 Step 7 wired the per-indicator reading tables
 * (`technical_readings`, `onchain_readings`, `news_sentiment`) but left
 * the `ingest-macro` cron writing only the `macro` category into
 * `composite_snapshots.contributing_indicators`. This module fills that
 * gap: for each asset type, it aggregates the raw 0-100 indicator
 * scores into ONE 0-100 category score plus an indicator-level
 * breakdown that matches the nested JSONB shape the dashboard's
 * `ContributingIndicators` component already knows how to render.
 *
 * Responsibilities (per blueprint §4.2):
 *
 *   1. `aggregateTechnical(assetType, rows)` — mean across broad-market
 *      tickers for the asset type. Crypto returns null at Phase 2
 *      (no technical ingestion path; CATEGORY_WEIGHTS.crypto still
 *      assigns it 25 weight so the null surfaces as "missing" in the
 *      transparency chip).
 *   2. `aggregateOnchain(assetType, rows)` — crypto only. Mean across
 *      MVRV_Z + SOPR + BTC_ETF_NETFLOW (the three on-chain-proper
 *      inputs). CNN_FG + CRYPTO_FG live in on-chain storage but are
 *      sentiment inputs per blueprint §4.1 — fed through
 *      `aggregateSentiment`, not here.
 *   3. `aggregateSentiment(assetType, newsRows, cnnFgScore, cryptoFgScore)`
 *      — per-asset blend of per-ticker news sentiment + F&G index.
 *      us_equity/common/global_etf: mean of 5 news tickers blended
 *      50/50 with CNN_FG when present. kr_equity: CNN_FG alone (no
 *      KR-specific news feed at Phase 2). crypto: CNN_FG + CRYPTO_FG
 *      blended 50/50.
 *   4. `aggregateValuation(assetType)` — neutral 50 pin for asset types
 *      that have a `valuation` weight (us_equity / global_etf / common),
 *      null otherwise. Phase 3 replaces the pin with a Shiller-P/E-class
 *      module (blueprint §4.4 trade-off 7).
 *   5. `aggregateRegionalOverlay(assetType, overlayScores)` — kr_equity
 *      only. The caller (ingest-macro) has already z-scored + weighted-
 *      averaged DTWEXBGS + DEXKOUS into a single score; this helper
 *      just packages it into the return shape so the call site looks
 *      symmetric with the other aggregators.
 *
 * Design principles (mirrors composite-v2.ts):
 *
 * - **Pure.** No `server-only`, no DB, no Next.js. The caller does the
 *   reading-table queries and passes already-typed arrays in. This
 *   keeps the aggregators unit-testable against synthetic fixtures and
 *   available to offline backfill scripts under `scripts/`.
 *
 * - **Null-propagation, never neutral default.** Blueprint §2.2 tenet 1
 *   + §4.5 tenet 1 + plan §0.5 tenet 1 "silent success, loud failure":
 *   a category with zero usable indicator scores returns `null`, which
 *   `computeCompositeV2` surfaces in `missingCategories` so the UI's
 *   "N/6 카테고리 반영" chip can show the gap. A default of 50 would
 *   silently flatten the composite toward neutral during rollout; a
 *   default of 0 would silently bias it downward. Null is the only
 *   answer that doesn't lie.
 *
 * - **Per-ticker fallback within a category.** When a ticker row has
 *   SOME of its 6 technical indicators successfully scored (RSI + MACD)
 *   but is missing others (BB_20_2 waiting on 20d history), we take the
 *   mean across whichever scores ARE present for that ticker. The
 *   ticker is counted as "present" with its partial mean — missing
 *   sub-indicators silently drop out of the ticker-level mean.
 *   Rationale: blueprint §4.3 normalizers already return null for
 *   insufficient-history cases and we don't want a single missing MA_200
 *   to exclude an otherwise-healthy ticker from the category.
 *
 * - **Indicator breakdown passed out.** The caller needs a submap
 *   keyed by the underlying identifier (ticker / indicator_key) with
 *   `{score, weight, contribution}` relative to the parent category.
 *   Weights within a category sum to 1.0 (equal-weight across
 *   contributing rows); contribution = score × weight. This matches
 *   the JSONB shape parsed by `ContributingIndicators.tsx`'s
 *   `parseV2` reader.
 */

import type {
  AssetType,
  CategoryName,
  CompositeResult,
} from "./types";
import { CATEGORY_WEIGHTS } from "./weights";

// ---------------------------------------------------------------------------
// Input row shapes — narrow slices of the Supabase-generated types so
// tests don't have to fabricate every column. Callers pick the columns
// they read (observed_at, score_0_100, etc.) and the aggregators only
// touch these fields.
// ---------------------------------------------------------------------------

export interface TechnicalRowSlice {
  ticker: string;
  asset_type: AssetType;
  indicator_key: string;
  score_0_100: number | null;
  fetch_status: string;
}

export interface OnchainRowSlice {
  indicator_key: string;
  score_0_100: number | null;
  fetch_status: string;
}

export interface NewsSentimentRowSlice {
  ticker: string | null;
  asset_type: AssetType;
  score_0_100: number;
  fetch_status: string;
}

/**
 * Output of an aggregator — category score plus the indicator-level
 * breakdown to nest under the JSONB's `indicators` submap.
 *
 * `score === null` means "category is missing / not computable";
 * `indicators` may still be populated with partial rows for debugging
 * purposes, but callers SHOULD treat a null score as the authoritative
 * "don't count this category" signal and nest nothing.
 */
export interface AggregationResult {
  score: number | null;
  indicators: CompositeResult["contributing"];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Arithmetic mean of finite numbers. Returns null if `values` is empty
 * or contains no finite entries.
 */
function finiteMean(values: readonly (number | null | undefined)[]): number | null {
  const finite = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (finite.length === 0) return null;
  let sum = 0;
  for (const v of finite) sum += v;
  return sum / finite.length;
}

/**
 * Build a `{score, weight, contribution}` breakdown for N keys, each
 * contributing equal weight (1/N). Used by every aggregator that has a
 * per-indicator submap.
 */
function buildEqualWeightBreakdown(
  entries: ReadonlyArray<{ key: string; score: number }>,
): CompositeResult["contributing"] {
  const breakdown: CompositeResult["contributing"] = {};
  if (entries.length === 0) return breakdown;
  const weight = 1 / entries.length;
  for (const { key, score } of entries) {
    breakdown[key] = {
      score,
      weight,
      contribution: score * weight,
    };
  }
  return breakdown;
}

/** Does `assetType`'s weight table assign a weight to `category`? */
function isCategoryApplicable(
  assetType: AssetType,
  category: CategoryName,
): boolean {
  const weights = CATEGORY_WEIGHTS[assetType];
  const w = weights[category];
  return typeof w === "number" && Number.isFinite(w) && w > 0;
}

// ---------------------------------------------------------------------------
// Technical
// ---------------------------------------------------------------------------

/**
 * Tickers considered broad-index representatives per asset_type for the
 * technical category aggregation. Blueprint §4.2 suggests SPY+QQQ+DIA+IWM
 * for us_equity and GLD+EFA+EEM+EWJ for global_etf, but the actual
 * Phase 2 ticker registry ({@link TICKER_REGISTRY} in
 * `ingest-technical/ticker-registry.ts`) only includes a subset. We
 * list here the intersection of the blueprint's recommended set with
 * what the cron actually ingests, plus the per-asset-type catch-all
 * "mean across all tickers of this asset_type" fallback when the
 * allow-list is empty for a given row slice.
 *
 * Preferred list reflects the Phase 2 §3.2 TICKER_REGISTRY; cross-check
 * registry directly when adding/removing tickers — tests don't assert
 * membership.
 *
 * us_equity:
 *   SPY + QQQ as broad-market representatives. Individual-stock
 *   tickers (NVDA / AAPL / MSFT / GOOGL / AMZN) are NOT counted here —
 *   they are not broad-market representatives, and including them would
 *   let a single-name earnings spike move the whole `us_equity` technical
 *   category.
 *
 * global_etf:
 *   GLD + EWJ + MCHI + INDA + TLT — region/macro-hedge ETFs registered
 *   for this asset_type; averaging them produces a representative
 *   cross-sectional read.
 *
 * kr_equity:
 *   005930.KS (Samsung) is listed as the historical representative for
 *   API symmetry, but the Phase 2 ticker registry no longer contains
 *   ANY .KS symbols (KR carve-out 2026-04-25 — Alpha Vantage free tier
 *   doesn't serve KOSPI in any format; see
 *   `ingest-technical/ticker-registry.ts` header). With no kr_equity
 *   rows ever landing, {@link aggregateTechnical}('kr_equity', rows)
 *   returns null at Phase 2 — `computeCompositeV2` surfaces this in
 *   `missingCategories` per blueprint §2.2 tenet 1. Phase 3 plan: add
 *   ECOS / Yahoo Finance ingestion to repopulate this entry.
 *
 * common:
 *   Weight-mirror of us_equity per blueprint §4.2 line 239; uses the
 *   same SPY + QQQ preferred tickers. See {@link aggregateTechnical}
 *   for the asset_type='us_equity' fallback semantics.
 */
const TECHNICAL_PREFERRED_TICKERS: Partial<Record<AssetType, readonly string[]>> = {
  us_equity: ["SPY", "QQQ"],
  kr_equity: ["005930.KS"],
  global_etf: ["GLD", "EWJ", "MCHI", "INDA", "TLT"],
  common: ["SPY", "QQQ"],
};

/**
 * Group technical rows by ticker; compute each ticker's mean across
 * whichever indicators landed a non-null score. Returns an array of
 * `{ticker, assetType, score}` entries where `score` is the per-ticker
 * 0-100 mean.
 *
 * Dedup: the caller (ingest cron / aggregator) typically queries
 * `technical_readings` with a DESC ORDER BY observed_at and a generous
 * `.limit(500)` that returns several days of rows per (ticker,
 * indicator). We keep ONLY the latest row per `(ticker, indicator_key)`
 * so day-over-day moves don't get flattened into a multi-day mean.
 * First-occurrence-wins matches the {@link aggregateOnchain} precedent
 * in this file.
 */
function perTickerTechnicalScores(
  rows: readonly TechnicalRowSlice[],
): Array<{ ticker: string; assetType: AssetType; score: number }> {
  const byTicker = new Map<
    string,
    { assetType: AssetType; seenIndicators: Set<string>; scores: number[] }
  >();
  for (const row of rows) {
    if (row.fetch_status !== "success") continue;
    if (row.score_0_100 === null || !Number.isFinite(row.score_0_100)) continue;
    const bucket = byTicker.get(row.ticker);
    if (bucket) {
      // First-occurrence-wins per indicator_key — caller passes DESC-
      // ordered rows, so the first seen IS the latest.
      if (bucket.seenIndicators.has(row.indicator_key)) continue;
      bucket.seenIndicators.add(row.indicator_key);
      bucket.scores.push(row.score_0_100);
    } else {
      byTicker.set(row.ticker, {
        assetType: row.asset_type,
        seenIndicators: new Set([row.indicator_key]),
        scores: [row.score_0_100],
      });
    }
  }
  const out: Array<{ ticker: string; assetType: AssetType; score: number }> =
    [];
  for (const [ticker, { assetType, scores }] of byTicker) {
    const mean = finiteMean(scores);
    if (mean === null) continue;
    out.push({ ticker, assetType, score: mean });
  }
  return out;
}

/**
 * Aggregate `technical_readings` rows into a single 0-100 category
 * score for the given `assetType`.
 *
 * Strategy:
 *  1. Per-ticker: mean across whichever of the 6 indicators landed a
 *     non-null `score_0_100`. One ticker = one data point.
 *  2. Filter to the tickers that represent this asset_type's broad
 *     market (see {@link TECHNICAL_PREFERRED_TICKERS}). If that list is
 *     empty for the asset_type OR no preferred ticker produced a
 *     per-ticker score, fall back to the mean across ALL tickers in
 *     `rows` whose `asset_type` matches — preserves the category
 *     during partial ingestion instead of going null.
 *  3. Category score = mean across the surviving per-ticker scores.
 *  4. Indicator breakdown: one entry per surviving ticker, equal
 *     weights. This mirrors the blueprint §4.4 drill-down UX — "which
 *     ticker drove the technical score?" not "which indicator".
 *
 * Returns `{score: null, indicators: {}}` when:
 *  - `assetType` has no `technical` weight (not applicable; e.g.
 *    crypto at Phase 2 — registry doesn't cover BTC/ETH for
 *    technical, so null propagates to the composite as "missing").
 *  - No usable per-ticker score could be computed.
 *
 * kr_equity at Phase 2: returns null. The Phase 2 ticker registry
 * carries no .KS symbols (KR carve-out 2026-04-25 — Alpha Vantage
 * free tier doesn't serve KOSPI in any format; see
 * `ingest-technical/ticker-registry.ts` for the Phase 3 ECOS / Yahoo
 * plan). With no kr_equity rows in the input, both the preferred-set
 * filter and the asset_type fallback hit zero, so the function
 * returns `{score: null, indicators: {}}` and the composite engine
 * surfaces it in `missingCategories`.
 */
export function aggregateTechnical(
  assetType: AssetType,
  rows: readonly TechnicalRowSlice[],
): AggregationResult {
  if (!isCategoryApplicable(assetType, "technical")) {
    return { score: null, indicators: {} };
  }

  const perTicker = perTickerTechnicalScores(rows);
  if (perTicker.length === 0) return { score: null, indicators: {} };

  // Preferred set first.
  const preferred = TECHNICAL_PREFERRED_TICKERS[assetType] ?? [];
  let selected = perTicker.filter((t) => preferred.includes(t.ticker));

  // Fallback to all tickers matching this asset_type's row-level tag.
  // `common` is a weight-mirror of us_equity per blueprint §4.2 line 239;
  // no row carries `asset_type='common'`, so the fallback source is
  // `us_equity` rows — otherwise the category would degrade to null
  // the instant SPY+QQQ miss.
  const fallbackAssetType: AssetType =
    assetType === "common" ? "us_equity" : assetType;
  if (selected.length === 0) {
    selected = perTicker.filter((t) => t.assetType === fallbackAssetType);
  }

  if (selected.length === 0) return { score: null, indicators: {} };

  const score = finiteMean(selected.map((t) => t.score));
  if (score === null) return { score: null, indicators: {} };

  const indicators = buildEqualWeightBreakdown(
    selected.map((t) => ({ key: t.ticker, score: t.score })),
  );

  return { score, indicators };
}

// ---------------------------------------------------------------------------
// On-chain
// ---------------------------------------------------------------------------

/**
 * On-chain indicator keys that feed the `onchain` category. Blueprint
 * §4.2 + §4.3: MVRV_Z, SOPR, BTC_ETF_NETFLOW.
 *
 * CNN_FG and CRYPTO_FG live in the same `onchain_readings` table for
 * storage convenience but are SENTIMENT inputs per blueprint §4.1 —
 * they feed the sentiment category via {@link aggregateSentiment}, NOT
 * this function. Keeping them out here prevents the onchain category
 * from double-counting market-fear signals.
 */
const ONCHAIN_CATEGORY_KEYS: readonly string[] = [
  "MVRV_Z",
  "SOPR",
  "BTC_ETF_NETFLOW",
];

/**
 * Aggregate `onchain_readings` rows into a single 0-100 category score.
 *
 * Only `crypto` has an `onchain` weight per blueprint §4.2. For every
 * other asset type this returns `{score: null, indicators: {}}` — the
 * category is not-applicable, so `computeCompositeV2` silently skips
 * it (no `missingCategories` entry).
 *
 * When applicable:
 *  - Pick the latest row per indicator_key within `ONCHAIN_CATEGORY_KEYS`
 *    that has `fetch_status='success'` AND a finite `score_0_100`.
 *    Caller is responsible for passing the already-latest-per-key slice
 *    (same pattern as `loadSignalInputs` in `data/signals.ts`) — we
 *    de-dup here defensively in case the caller forgot.
 *  - Category score = equal-weight mean across the surviving keys.
 *  - Indicator breakdown: one entry per surviving key, equal weights.
 */
export function aggregateOnchain(
  assetType: AssetType,
  rows: readonly OnchainRowSlice[],
): AggregationResult {
  if (!isCategoryApplicable(assetType, "onchain")) {
    return { score: null, indicators: {} };
  }

  // Latest-per-key de-dup (defensive; the caller should slice first).
  const seen = new Map<string, number>();
  for (const row of rows) {
    if (row.fetch_status !== "success") continue;
    if (row.score_0_100 === null || !Number.isFinite(row.score_0_100)) continue;
    if (!ONCHAIN_CATEGORY_KEYS.includes(row.indicator_key)) continue;
    // First occurrence wins (caller-ordering respected). This matches
    // `latestOnchain` in data/signals.ts — caller passes rows sorted
    // newest-first and we keep the first match per key.
    if (seen.has(row.indicator_key)) continue;
    seen.set(row.indicator_key, row.score_0_100);
  }

  if (seen.size === 0) return { score: null, indicators: {} };

  const entries = Array.from(seen.entries()).map(([key, score]) => ({
    key,
    score,
  }));
  const score = finiteMean(entries.map((e) => e.score));
  if (score === null) return { score: null, indicators: {} };

  return {
    score,
    indicators: buildEqualWeightBreakdown(entries),
  };
}

// ---------------------------------------------------------------------------
// Sentiment
// ---------------------------------------------------------------------------

/**
 * Inputs to the sentiment aggregator.
 *
 * - `newsRows`: per-ticker scored rows from `news_sentiment`. Filtered
 *   internally to `fetch_status='success'` + finite `score_0_100`.
 *   For us_equity / common / global_etf, these drive the
 *   news half of the blend. kr_equity / crypto don't use news_sentiment
 *   at Phase 2 (no KR-feed, no crypto-feed) — passing an empty array is
 *   equivalent to passing the full array.
 *
 * - `cnnFgScore`: the already-scored CNN Stock F&G 0-100 value (the
 *   value stored as `onchain_readings.score_0_100` for
 *   `indicator_key='CNN_FG'`). The raw CNN index is fear-scale — 0 =
 *   fear, 100 = greed — but `ingest-cnn-fg` already applies
 *   `cnnFearGreedToScore` before the write, so the value is on the
 *   product's favorability scale (100 = max favorable).
 *
 * - `cryptoFgScore`: similarly, the already-scored 0-100 CRYPTO_FG value
 *   from `onchain_readings`. Crypto-only input.
 *
 * All three may be null — aggregator handles the all-null case by
 * returning `{score: null, indicators: {}}`.
 */
export interface SentimentAggregationInputs {
  newsRows: readonly NewsSentimentRowSlice[];
  cnnFgScore: number | null;
  cryptoFgScore: number | null;
}

/**
 * Aggregate per-ticker news sentiment + market F&G index into a single
 * sentiment category score per blueprint §4.1 + §4.2.
 *
 * Per-asset blend:
 *
 *   us_equity / common / global_etf:
 *     - News half: mean across `newsRows` (5 US large-caps).
 *     - Market half: CNN_FG.
 *     - Combined: 50/50 when both present; whichever when only one;
 *       null when neither.
 *
 *   kr_equity:
 *     - CNN_FG alone — no KR-specific news feed in the Phase 2
 *       ingestion pipeline. The `kr_equity` sentiment weight of 10
 *       is modest enough that using a US-proxy market-fear reading is
 *       acceptable per blueprint §4.1 "capped-at-10 rule"; a dedicated
 *       KR news source is a Phase 3 enhancement.
 *
 *   crypto:
 *     - CNN_FG + CRYPTO_FG blended 50/50. Per blueprint §4.1, CRYPTO_FG
 *       is an on-chain-adjacent fear-greed index that doesn't belong in
 *       the on-chain category (which tracks chain fundamentals like
 *       MVRV / SOPR), but DOES belong in sentiment.
 *
 * Asset types without a `sentiment` weight skip immediately — see
 * `computeCompositeV2`'s not-applicable vs missing distinction.
 *
 * Null-propagation (blueprint §4.5 tenet 1): if every input for the
 * per-asset recipe is null/empty, returns `{score: null}` so
 * `computeCompositeV2` adds it to `missingCategories`.
 *
 * Indicator breakdown: one entry per news ticker (if the news half
 * contributed) + one entry per F&G index that contributed
 * (`CNN_FG` / `CRYPTO_FG`). The sub-weight allocation mirrors the
 * 50/50 outer blend — inside the news half the 5 tickers split the
 * news half's weight equally (50% / 5 = 10% each when CNN is also
 * present), then CNN_FG takes the other 50%. When only one half is
 * present, the whole category weight goes to that half (e.g., kr_equity
 * assigns CNN_FG weight 1.0).
 *
 * The 0–100 output is unbounded; the blueprint §4.1 10-pt sentiment cap
 * is enforced by CATEGORY_WEIGHTS × computeCompositeV2, not here.
 */
export function aggregateSentiment(
  assetType: AssetType,
  inputs: SentimentAggregationInputs,
): AggregationResult {
  if (!isCategoryApplicable(assetType, "sentiment")) {
    return { score: null, indicators: {} };
  }

  // Filter news rows down to usable scores. Dedupe by ticker: the
  // caller reads `news_sentiment` DESC and may pass multiple days of
  // rows per ticker; without a per-ticker latest-wins filter the
  // downstream JSONB `indicators` submap silently collapses duplicates
  // so inner weights don't sum to 0.5. First occurrence wins (DESC
  // order ⇒ latest).
  const seenTickers = new Set<string>();
  const usableNews: Array<{ key: string; score: number }> = [];
  for (const row of inputs.newsRows) {
    if (row.fetch_status !== "success") continue;
    if (!Number.isFinite(row.score_0_100)) continue;
    // A row without a ticker (asset-level news_sentiment aggregate —
    // not yet used at Phase 2) would end up with an unstable key.
    // Guard defensively.
    if (!row.ticker) continue;
    if (seenTickers.has(row.ticker)) continue;
    seenTickers.add(row.ticker);
    usableNews.push({ key: row.ticker, score: row.score_0_100 });
  }

  const cnn = Number.isFinite(inputs.cnnFgScore ?? Number.NaN)
    ? (inputs.cnnFgScore as number)
    : null;
  const cfg = Number.isFinite(inputs.cryptoFgScore ?? Number.NaN)
    ? (inputs.cryptoFgScore as number)
    : null;

  // Per-asset recipe selection.
  switch (assetType) {
    case "us_equity":
    case "common":
    case "global_etf": {
      return blendNewsAndCnn(usableNews, cnn);
    }
    case "kr_equity": {
      if (cnn === null) return { score: null, indicators: {} };
      return {
        score: cnn,
        indicators: {
          CNN_FG: { score: cnn, weight: 1, contribution: cnn },
        },
      };
    }
    case "crypto": {
      return blendCnnAndCryptoFg(cnn, cfg);
    }
    default:
      // Exhaustiveness guard — the switch covers every AssetType. A
      // silent fall-through at a new asset addition would default to
      // "sentiment unavailable" rather than a synthesized neutral 50.
      return { score: null, indicators: {} };
  }
}

/**
 * us_equity / common / global_etf recipe — news ticker mean blended
 * 50/50 with CNN_FG when present; whichever when only one; null
 * otherwise.
 */
function blendNewsAndCnn(
  usableNews: ReadonlyArray<{ key: string; score: number }>,
  cnn: number | null,
): AggregationResult {
  const newsMean =
    usableNews.length > 0
      ? finiteMean(usableNews.map((n) => n.score))
      : null;

  if (newsMean === null && cnn === null) {
    return { score: null, indicators: {} };
  }

  // Both halves present → 50/50 blend. Inner news weight is split
  // equally across tickers (half-weight / N).
  if (newsMean !== null && cnn !== null) {
    const score = (newsMean + cnn) / 2;
    const newsHalf = 0.5;
    const innerNewsWeight = newsHalf / usableNews.length;
    const indicators: CompositeResult["contributing"] = {};
    for (const { key, score: tickerScore } of usableNews) {
      indicators[key] = {
        score: tickerScore,
        weight: innerNewsWeight,
        contribution: tickerScore * innerNewsWeight,
      };
    }
    indicators.CNN_FG = {
      score: cnn,
      weight: 0.5,
      contribution: cnn * 0.5,
    };
    return { score, indicators };
  }

  // News only.
  if (newsMean !== null) {
    const innerWeight = 1 / usableNews.length;
    const indicators: CompositeResult["contributing"] = {};
    for (const { key, score: tickerScore } of usableNews) {
      indicators[key] = {
        score: tickerScore,
        weight: innerWeight,
        contribution: tickerScore * innerWeight,
      };
    }
    return { score: newsMean, indicators };
  }

  // CNN only.
  // cnn is non-null here per the early-return guards above.
  const cnnVal = cnn as number;
  return {
    score: cnnVal,
    indicators: {
      CNN_FG: { score: cnnVal, weight: 1, contribution: cnnVal },
    },
  };
}

/**
 * crypto recipe — CNN_FG + CRYPTO_FG blended 50/50. Null-propagates
 * cleanly when either half is missing (falls back to the other at
 * full weight); null when both missing.
 */
function blendCnnAndCryptoFg(
  cnn: number | null,
  cfg: number | null,
): AggregationResult {
  if (cnn === null && cfg === null) {
    return { score: null, indicators: {} };
  }
  if (cnn !== null && cfg !== null) {
    return {
      score: (cnn + cfg) / 2,
      indicators: {
        CNN_FG: { score: cnn, weight: 0.5, contribution: cnn * 0.5 },
        CRYPTO_FG: { score: cfg, weight: 0.5, contribution: cfg * 0.5 },
      },
    };
  }
  if (cnn !== null) {
    return {
      score: cnn,
      indicators: {
        CNN_FG: { score: cnn, weight: 1, contribution: cnn },
      },
    };
  }
  // cfg non-null here.
  const cfgVal = cfg as number;
  return {
    score: cfgVal,
    indicators: {
      CRYPTO_FG: { score: cfgVal, weight: 1, contribution: cfgVal },
    },
  };
}

// ---------------------------------------------------------------------------
// Valuation
// ---------------------------------------------------------------------------

/**
 * Neutral-50 pin used at Phase 2 for the valuation category (blueprint
 * §4.4 trade-off 7). Exported so tests and the ingest cron share one
 * source of truth — a silent edit here affects every valuation-capable
 * composite at once.
 */
export const VALUATION_NEUTRAL_PIN = 50;

/**
 * Aggregate valuation — returns the neutral-50 pin for asset types
 * with a `valuation` weight (us_equity / global_etf / common per
 * blueprint §4.2), null otherwise (kr_equity / crypto).
 *
 * Phase 3 replaces the pin with a real Shiller-P/E-class module
 * (blueprint §4.4 trade-off 7). The pin (rather than null) for
 * applicable asset types deliberately prevents `computeCompositeV2`
 * from silently renormalizing the valuation weight away during rollout
 * — keeping the 10-pt slot occupied at a neutral score preserves the
 * blueprint §4.1 capped-sentiment invariant (sentiment stays bounded
 * at its prescribed 10 pts, not 20).
 *
 * No `indicators` submap — valuation is a single synthetic score at
 * Phase 2, so there's nothing to drill down into. This matches the
 * `ContributingIndicators.tsx` expectation (valuation category rendered
 * without nested rows).
 */
export function aggregateValuation(assetType: AssetType): AggregationResult {
  if (!isCategoryApplicable(assetType, "valuation")) {
    return { score: null, indicators: {} };
  }
  return { score: VALUATION_NEUTRAL_PIN, indicators: {} };
}

// ---------------------------------------------------------------------------
// Regional overlay
// ---------------------------------------------------------------------------

/**
 * Packaged per-series score for the regional overlay category.
 *
 * Matches the shape `ingest-macro` already builds at §3.5b — each entry
 * is one of the two FRED series (DTWEXBGS / DEXKOUS) with its 0-100
 * score and within-category weight (0.5 each per
 * {@link PHASE2_FRED_REGIONAL_OVERLAY}). Passing this shape in (rather
 * than having the aggregator re-fetch) keeps the aggregator pure.
 */
export interface RegionalOverlayEntry {
  key: string;
  score: number;
  weight: number;
}

/**
 * Aggregate `regional_overlay` — kr_equity only per blueprint §4.2.
 *
 * The caller (ingest-macro §3.5b) has already:
 *  - fetched DTWEXBGS + DEXKOUS,
 *  - z-scored over 5y,
 *  - mapped to 0-100 with inverted=false,
 *  - packed both into {@link RegionalOverlayEntry} with their weights.
 *
 * This function just:
 *  - computes the weight-normalized mean (surviving non-null entries),
 *  - surfaces the per-series breakdown for the JSONB drill-down.
 *
 * Returns `{score: null}` when `entries` is empty (both series failed)
 * or `assetType` is not kr_equity. `computeCompositeV2` handles the
 * former case by adding `regional_overlay` to `missingCategories` for
 * kr_equity; for other asset types regional_overlay has no weight so
 * the null propagates without a missing-chip.
 */
export function aggregateRegionalOverlay(
  assetType: AssetType,
  entries: readonly RegionalOverlayEntry[],
): AggregationResult {
  if (!isCategoryApplicable(assetType, "regional_overlay")) {
    return { score: null, indicators: {} };
  }
  const usable = entries.filter(
    (e) => Number.isFinite(e.score) && Number.isFinite(e.weight) && e.weight > 0,
  );
  if (usable.length === 0) return { score: null, indicators: {} };

  const weightSum = usable.reduce((acc, e) => acc + e.weight, 0);
  if (!Number.isFinite(weightSum) || weightSum <= 0) {
    return { score: null, indicators: {} };
  }

  let score = 0;
  const indicators: CompositeResult["contributing"] = {};
  for (const e of usable) {
    const normalized = e.weight / weightSum;
    const contribution = e.score * normalized;
    score += contribution;
    indicators[e.key] = {
      score: e.score,
      weight: normalized,
      contribution,
    };
  }
  return { score, indicators };
}
