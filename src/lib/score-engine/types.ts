import type { Database } from "@/types/database";

/**
 * Shared types for the score engine.
 *
 * `AssetType` is drawn from the Supabase enum so the engine and the
 * DB can never drift: rename the enum, the engine fails to compile.
 */
export type AssetType = Database["public"]["Enums"]["asset_type_enum"];

/**
 * Static config for one macro/technical/on-chain indicator. Keyed by
 * its canonical identifier (e.g. "FEDFUNDS" for FRED's effective
 * federal funds rate).
 */
export interface IndicatorConfig {
  /** UI label in Korean — rendered in tooltips / indicator library. */
  descriptionKo: string;
  /** Data source display name. */
  sourceName: string;
  /** Deep link to the source page for attribution (PRD §16.2). */
  sourceUrl: string;
  /**
   * Refresh cadence. Tells the cron how often to fetch and helps the
   * staleness badge decide when a value is "stale" vs "fresh".
   */
  frequency: "daily" | "weekly" | "monthly";
  /** Normalization window in years (typical: 5). */
  windowYears: number;
  /**
   * Mapping direction between raw value and 0-100 score.
   *
   * - `inverted: false` (default): lower raw value = higher score.
   *   VIX, HY spread, FEDFUNDS all fit this (high = bad).
   * - `inverted: true`: higher raw value = higher score.
   *   T10Y2Y yield-curve spread fits this (positive = normal, negative
   *   = recession signal).
   */
  inverted: boolean;
  /**
   * Weight per asset class in the composite sum. Weights within one
   * asset class are normalized to 1 by {@link computeComposite}, so the
   * raw numbers here are relative importance, not absolute percentages.
   * Phase 1 keeps these uniform across asset classes since all 4
   * composites are currently 100% macro; Phase 2 differentiates.
   */
  weights: Partial<Record<AssetType, number>>;
}

/**
 * One indicator's score plus the weights that `composite` will use
 * to fold it into the per-asset-class composite.
 */
export interface IndicatorScore {
  /** Matches the key in {@link INDICATOR_CONFIG}. */
  key: string;
  /** 0-100 favorability score produced by `zScoreTo0100`. */
  score0to100: number;
  /** Per-asset weights copied from {@link IndicatorConfig.weights}. */
  weights: Partial<Record<AssetType, number>>;
}

/**
 * Output of {@link computeComposite}. The `contributing` map is what
 * gets persisted to `composite_snapshots.contributing_indicators` as
 * JSONB, so the UI can show the weighted breakdown without a second
 * query.
 */
export interface CompositeResult {
  score0to100: number;
  contributing: Record<
    string,
    {
      score: number;
      weight: number;
      contribution: number;
    }
  >;
}

/**
 * The Phase 2 score categories. Their weighted sum is the composite —
 * per-asset weights live in CATEGORY_WEIGHTS (weights.ts).
 *
 * Blueprint §4.1 + §4.2 enumerate:
 *   - `macro`              (FRED macro-economic indicators)
 *   - `technical`          (RSI / MACD / MA / Bollinger / Disparity)
 *   - `onchain`            (MVRV / SOPR / ETF flow / Crypto F&G — crypto only)
 *   - `sentiment`          (Finnhub + CNN F&G; capped per §4.1 + PRD §8.4)
 *   - `valuation`          (Phase 3 module; at Phase 2 pinned to neutral 50
 *                           per §4.4 trade-off 7 — weight 10 on US / ETF)
 *   - `regional_overlay`   (DTWEXBGS + DEXKOUS; KR-only; weight 20 per §4.2)
 *
 * `valuation` and `regional_overlay` are first-class categories rather
 * than collapsed into `sentiment` / `macro` so the blueprint §4.2 weight
 * table is honoured verbatim and the capped-sentiment invariant (§4.1)
 * holds — collapsing valuation into sentiment would let sentiment drag
 * the composite by 20 pts, not the prescribed 10.
 */
export type CategoryName =
  | "macro"
  | "technical"
  | "onchain"
  | "sentiment"
  | "valuation"
  | "regional_overlay";

/**
 * Map of category → 0-100 score. `null` means "missing / unknown" —
 * propagates per blueprint §2.2 tenet 1 (missing inputs → unknown,
 * never defaulted to neutral or zero). The composite renormalizes
 * weights across present categories only, preserving dynamic range
 * during gradual rollout.
 */
export type CategoryScores = Record<CategoryName, number | null>;

/**
 * Per-asset category weights per blueprint §4.2. Total per asset need
 * not sum to 100 — the composite renormalizes.
 *
 * `Partial` because not every asset type has every category — US
 * equity has no on-chain category, crypto leans on all four, etc. A
 * category absent from this map is "not applicable" for the asset,
 * distinct from "applicable but currently null" (blueprint §4.5).
 */
export type PerAssetCategoryWeights = Partial<Record<CategoryName, number>>;

/**
 * Per-category breakdown in {@link CompositeResultV2.contributing}.
 * Mirrors the Phase 1 `{ score, weight, contribution }` shape at the
 * category level. Nested `indicators` preserves the Phase 1
 * indicator-level breakdown when available (macro today; other
 * categories will populate `indicators` as Phase C Steps 7-8 wire up
 * the rest of the pipeline).
 */
export interface CategoryContribution {
  /** 0-100 category score. */
  score: number;
  /** Renormalized weight — sums to 1.0 across present categories. */
  weight: number;
  /** score × weight — what this category adds to the composite. */
  contribution: number;
  /**
   * Optional indicator-level breakdown, same shape as the Phase 1
   * {@link CompositeResult.contributing} map. Populated for categories
   * whose ingestion path computes per-indicator scores (macro already
   * does; technical / on-chain / sentiment will fill this in as their
   * cron endpoints come online in Steps 7-8).
   */
  indicators?: CompositeResult["contributing"];
}

/**
 * Output of `computeCompositeV2`. Persisted to
 * `composite_snapshots.contributing_indicators` (same column as Phase
 * 1) in a NESTED shape — `model_version` on the row discriminates v1
 * flat from v2 nested when the UI reader branches on historical rows.
 */
export interface CompositeResultV2 {
  /** 0-100 weighted composite across present categories. */
  score0to100: number;
  /** Per-category breakdown. Missing categories are omitted. */
  contributing: Partial<Record<CategoryName, CategoryContribution>>;
  /**
   * Categories that were null/missing when the composite was computed.
   * Feeds the "N/4 categories active" transparency chip so silent
   * degradation doesn't look like a valid reading (§0.5 tenet 1).
   */
  missingCategories: CategoryName[];
}
