/**
 * Pure-math news-sentiment engine (Phase 2 Step 5).
 *
 * Consumed by:
 * - The per-snapshot score pipeline (Step 6 — `composite.ts` extension),
 *   which feeds per-ticker Finnhub readings plus the market-level CNN
 *   Stock F&G observation through the combiner and surfaces the result
 *   as the `sentiment` category sub-score.
 * - The Phase 2 backfill tooling under `scripts/`, which is why this
 *   file is pure-math — no `import "server-only"`, no Next.js, no
 *   Supabase, no React. Mirrors `technical.ts` / `onchain.ts` in shape
 *   so downstream wiring stays homogeneous.
 *
 * Scope boundary vs the composite (blueprint §4.1, PRD §8.4 line 172):
 * sentiment is a "보조 지표" (supplementary indicator) — it can only
 * contribute up to its category weight (10 for US/KR/ETF, 15 for
 * BTC/ETH). It MUST NOT drive the composite alone. The ceiling lives
 * in the per-asset weight tables at §4.2; this module exposes
 * {@link MAX_SENTIMENT_WEIGHT_FRACTION} as a documentation constant so
 * Step 6's capped-contribution invariant has a single source of truth.
 *
 * Normalization rules:
 *
 * - **Finnhub** (per-ticker): Finnhub publishes `bullishPercent` and
 *   `bearishPercent` as fractions in [0, 1] after `finnhub-parse.ts`
 *   normalization. The two percents DO NOT necessarily sum to 1 —
 *   Finnhub classifies a third "neutral" bucket that we ignore here.
 *   Favorability is the net bullish-minus-bearish spread, scaled onto
 *   [0, 100] around a neutral 50:
 *     `score = 50 + (bullishPercent - bearishPercent) * 50`
 *   - All bullish (1.0, 0.0)     → 100
 *   - Balanced (0.5, 0.5)        →  50
 *   - All bearish (0.0, 1.0)     →   0
 *   - Zero articles (articleCount = 0) → 50 (neutral; absence is not
 *     missing-data per `finnhub-parse.ts` contract note 2 — the parser
 *     returns `fetch_status: "partial"` with valid-but-zero percents
 *     when there are simply no articles, and the product-level
 *     response to "no news" is neutrality, not null).
 *   - Either percent null       → null (data-missing, amber state).
 *
 * - **CNN Stock F&G** (market-level): the upstream index is already
 *   0-100 on the inverse scale — extreme fear = 0 = favorable entry,
 *   extreme greed = 100 = unfavorable. Invert to the product scale:
 *     `score = 100 - cnnScore`
 *   Clamp [0, 100] defensively against unexpected out-of-range inputs
 *   (the parser already enforces [0, 100], but this is a second line
 *   of defense against future parser drift).
 *
 * - **Combined category score**: a plain equal-weight average of
 *   whichever of the two normalizers produced a value.
 *   - Both present → 0.5 * Finnhub + 0.5 * CNN
 *   - Only one     → that one
 *   - Neither      → null (propagates upward so the composite can
 *     exclude the sentiment category entirely per blueprint §4.5
 *     tenet 1 — a missing sub-score should NOT collapse to 50, which
 *     would silently count as a non-trivial vote).
 *
 * Null/unknown handling (blueprint §4.5 tenet 1): missing data surfaces
 * as `null` — never `50`, never `0`. This keeps the "sentiment
 * unavailable" UI path distinct from the "sentiment is exactly
 * neutral" case. Non-finite inputs are treated the same as missing.
 *
 * All exports are pure (no side effects, deterministic) and free of
 * `any`. Matches the Phase 2 standard set by `technical.ts` and
 * `onchain.ts`.
 */

import { clamp } from "./normalize";

// ---------------------------------------------------------------------------
// Capped-contribution invariant constant
// ---------------------------------------------------------------------------

/**
 * Upper bound on sentiment's share of the composite, expressed as a
 * fraction of the composite's 100-point denominator.
 *
 * Derivation — blueprint §4.1 + §4.2 + PRD §8.4 line 172:
 *   US equity / KR equity / Global ETF: weight 10 → 10/100 = 0.10
 *   BTC / ETH:                          weight 15 → 15/100 = 0.15
 *
 * The MAXIMUM across all asset classes is 0.15 (BTC/ETH). That is the
 * ceiling below which the PRD's "보조 지표로만 사용" guarantee holds:
 * even if every other category scored 100 and sentiment scored 0, the
 * composite can drop by at most 15 points from the all-100 baseline.
 *
 * This constant is the single source of truth that Step 6 composite
 * tests (and the invariant test in `sentiment.test.ts`) assert against.
 * Per-asset weights themselves live in `src/lib/score-engine/weights.ts`
 * (restructured at Step 6) — this constant documents the ceiling, not
 * the weights themselves.
 */
export const MAX_SENTIMENT_WEIGHT_FRACTION = 0.15;

// ---------------------------------------------------------------------------
// Finnhub (per-ticker) → 0-100 score
// ---------------------------------------------------------------------------

/**
 * Convert Finnhub's per-ticker bullish/bearish percents into a 0-100
 * favorability score.
 *
 * Inputs come from {@link
 * ../sources/finnhub-parse#FinnhubSentimentResult FinnhubSentimentResult}
 * — both percents are fractions in [0, 1], or `null` when the upstream
 * `sentiment` object was missing/malformed.
 *
 * Strategy (blueprint §4.1): `score = 50 + (bullishPercent -
 * bearishPercent) * 50`. The spread maps symmetrically around the
 * neutral midpoint — all bullish (1, 0) hits 100, balanced (0.5, 0.5)
 * hits 50, all bearish (0, 1) hits 0.
 *
 * Null-propagation (blueprint §4.5 tenet 1):
 * - Either percent `null` → `null`. One-sided data isn't usable; we
 *   don't synthesize a missing half from the other.
 * - Non-finite (`NaN`, `Infinity`) → `null`. Defensive: the parser
 *   already guards, but a future upstream-contract change shouldn't
 *   silently feed garbage into composites.
 *
 * `articleCount = 0` is NOT a missing-data signal per
 * `finnhub-parse.ts` contract note 2 — it means "Finnhub ran and
 * legitimately saw no articles this week". We return `50` (neutral) in
 * that case, regardless of the percent values: absence of news is
 * information-neutral, not information-missing. Some callers may still
 * wish to surface a "low-signal" UI affordance using the article count
 * alongside the score; that's a presentational concern, not a
 * scoring one.
 *
 * Defensive clamp at [0, 100] guards against pathological upstream
 * values (e.g., a parser contract drift that let a 1.2 sneak past).
 */
export function finnhubSentimentToScore(
  bullishPercent: number | null,
  bearishPercent: number | null,
  articleCount: number,
): number | null {
  if (bullishPercent === null || bearishPercent === null) return null;
  if (!Number.isFinite(bullishPercent) || !Number.isFinite(bearishPercent)) {
    return null;
  }
  // Zero-articles path: legitimate "no news" response. Per
  // finnhub-parse.ts contract, this is NOT a missing-data error — we
  // surface the information-neutral score 50 rather than null.
  if (articleCount <= 0) return 50;

  const raw = 50 + (bullishPercent - bearishPercent) * 50;
  return clamp(raw, 0, 100);
}

// ---------------------------------------------------------------------------
// CNN Stock F&G (market-level) → 0-100 score
// ---------------------------------------------------------------------------

/**
 * Invert the CNN Stock Fear & Greed index onto the product's
 * favorability scale.
 *
 * ```
 * cnn =   0 (extreme fear)  → score = 100 (max favorable for entry)
 * cnn =  50 (neutral)       → score =  50
 * cnn = 100 (extreme greed) → score =   0 (min favorable)
 * ```
 *
 * Pure passthrough — `100 - cnnScore` with a defensive clamp to
 * [0, 100]. The parser in `cnn-fear-greed-parse.ts` already rejects
 * out-of-range values, but duplicating the clamp here keeps the
 * scoring contract self-contained (future parser drift shouldn't
 * silently corrupt composite arithmetic).
 *
 * Null-propagation: `null` or non-finite input → `null`. Matches the
 * blueprint §4.5 tenet 1 discipline.
 *
 * Mirrors `cryptoFearGreedToScore` in `onchain.ts`; the two F&G
 * sources differ only in provenance (Alternative.me for crypto, CNN
 * for US equities) and in null-semantics — the crypto variant
 * collapses non-finite to 50 because it's used as a single
 * indicator, while the stock variant uses `null` because it's one of
 * two inputs to a combiner that must distinguish "missing" from
 * "neutral".
 */
export function cnnFearGreedToScore(cnnScore: number | null): number | null {
  if (cnnScore === null) return null;
  if (!Number.isFinite(cnnScore)) return null;
  return clamp(100 - cnnScore, 0, 100);
}

// ---------------------------------------------------------------------------
// Combined sentiment category score
// ---------------------------------------------------------------------------

/**
 * Inputs to the sentiment category combiner.
 *
 * - `finnhubBullishPercent` / `finnhubBearishPercent` /
 *   `finnhubArticleCount` are the per-ticker Finnhub result fields. A
 *   pair of `null` percents indicates Finnhub failed or returned no
 *   sentiment object for this ticker (blueprint §4.5 tenet 1 — amber
 *   "unknown" state).
 * - `cnnFearGreedScore` is the market-level CNN Stock F&G reading,
 *   shared across all US-equity tickers for the day. `null` indicates
 *   CNN ingestion failed or was partial.
 */
export interface SentimentInputs {
  finnhubBullishPercent: number | null;
  finnhubBearishPercent: number | null;
  finnhubArticleCount: number;
  cnnFearGreedScore: number | null;
}

/**
 * Combine per-ticker Finnhub and market-level CNN Stock F&G into a
 * single 0-100 sentiment category score for the composite engine.
 *
 * Weighting: equal 50/50 when both sub-scores are present. Whichever
 * is present when only one is available. Null when neither is present
 * — per blueprint §4.5 tenet 1, a fully-unknown category MUST surface
 * as `null` so the composite weighted-average can exclude it entirely
 * (redistributing its weight pro-rata across the remaining categories,
 * implemented at Step 6).
 *
 * Why 50/50 rather than a weighted mix:
 * - Finnhub is ticker-local but has well-known quality issues
 *   (headline-level sentiment, prone to news-desk bias).
 * - CNN F&G is market-wide but diluted at the single-asset level.
 * - The blueprint §4.1 describes them as peers under the "sentiment
 *   modifier" label without a prescribed mix — equal weighting is
 *   the natural default. A Phase 3 backtest-driven re-tuning is
 *   explicitly deferred (blueprint §4.2 "Initial values only").
 *
 * The combined score still honours the capped-weight ceiling because
 * the cap lives at the outer composite (blueprint §4.2 — sentiment's
 * row is 10 for US/KR/ETF, 15 for BTC/ETH). See
 * {@link MAX_SENTIMENT_WEIGHT_FRACTION}.
 */
export function sentimentCategoryScore(
  inputs: SentimentInputs,
): number | null {
  const finnhub = finnhubSentimentToScore(
    inputs.finnhubBullishPercent,
    inputs.finnhubBearishPercent,
    inputs.finnhubArticleCount,
  );
  const cnn = cnnFearGreedToScore(inputs.cnnFearGreedScore);

  if (finnhub === null && cnn === null) return null;
  if (finnhub === null) return cnn;
  if (cnn === null) return finnhub;
  return (finnhub + cnn) / 2;
}
