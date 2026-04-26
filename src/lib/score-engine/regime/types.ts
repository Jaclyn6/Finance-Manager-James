/**
 * Regime classifier types — Phase 3.1 Step 5.
 *
 * Pure value types for the regime engine. No runtime imports — types
 * compile away. Aligned with `composite_snapshots.regime_label` /
 * `regime_confidence` / `regime_features` columns added in migration
 * `0013_phase31_regime.sql` (blueprint §3.1).
 */

/** The 5 regime labels per blueprint §2.2. */
export type RegimeLabel =
  | "risk_on_easing"
  | "risk_on_neutral"
  | "risk_off_tightening"
  | "risk_off_recession"
  | "transition";

/**
 * Required per-feature inputs for the classifier. All fields nullable
 * to preserve loud-failure semantics — null inputs route to confidence
 * reduction (and ultimately the `transition` label), never silent
 * fallback to a guessed value (blueprint §0 tenet 2).
 *
 * KR-specific features (BOK rate, KR 10Y, KRW/USD, etc.) land in the
 * `regime_features` JSONB column alongside these globals but are NOT
 * classifier inputs in Phase 3.1 — KR-specific weighting happens in
 * the weight-overlay layer (Step 6), not classification. The
 * classifier produces ONE global regime per day; the overlay maps it
 * to per-asset weights.
 */
export interface RegimeFeatures {
  /** VIX (CBOE Volatility Index) — sentiment / risk gauge. FRED `VIXCLS`. */
  vix: number | null;
  /** Federal Funds rate slope, e.g. 6-month change. Negative = easing. FRED `FEDFUNDS` derived. */
  fedfundsSlope: number | null;
  /** 10y2y treasury spread. Negative = inverted = recession signal. FRED `T10Y2Y`. */
  t10y2y: number | null;
  /** SPY price relative to its 200-day MA. > 1 = above (uptrend), < 1 = below. */
  spyTrendRatio: number | null;
  /** ISM Manufacturing PMI proxy — fall-back to a simpler gauge if PMI unavailable. */
  ismProxy: number | null;
}

/**
 * Per-rule outcome — whether a rule's conditions matched, by what
 * margin, and a Korean-language reason for the /regime tooltip.
 *
 * `strength` is a soft 0-1 score: 0 = clearly missed, 1 = clearly
 * matched. The classifier picks the rule with the highest strength
 * among matched rules, so the ordering matters even for non-winning
 * rules (audit trail on /backtest).
 */
export interface RuleEvaluation {
  /** Which regime this rule votes for. */
  rule: RegimeLabel;
  matched: boolean;
  /** Score 0-1 for how strongly this rule's conditions are met. */
  strength: number;
  /** Human-readable reason — used in /regime tooltip. */
  reasonKo: string;
}

/**
 * Output of {@link classifyRegime}. The `label` is always one of the
 * 5 enum values — the "no decision" surface is `label: "transition"`
 * with low confidence.
 *
 * Step 9 writer policy (blueprint §3.1): write `regime_label = null`
 * when `confidence < REGIME_CONFIDENCE_THRESHOLD`. Because the
 * classifier already forces `label = "transition"` whenever confidence
 * falls below the threshold, the writer can check either condition —
 * `label === "transition"` or `confidence < 0.6` — and reach the same
 * verdict.
 */
export interface RegimeDecision {
  label: RegimeLabel;
  /** 0.0-1.0. < 0.6 → label is forced to "transition" (insufficient certainty). */
  confidence: number;
  /** Echo of the inputs the classifier evaluated, for the audit trail. */
  contributingFeatures: RegimeFeatures;
  /**
   * Per-rule evaluations — which rules matched, by what margin. Useful
   * for the /regime page tooltip explaining why a day got its label.
   */
  ruleEvaluations: ReadonlyArray<RuleEvaluation>;
}

/** Confidence threshold below which the label is forced to "transition". */
export const REGIME_CONFIDENCE_THRESHOLD = 0.6;
