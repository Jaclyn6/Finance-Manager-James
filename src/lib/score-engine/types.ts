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
