import { RULES } from "./rules";
import {
  REGIME_CONFIDENCE_THRESHOLD,
  type RegimeDecision,
  type RegimeFeatures,
  type RuleEvaluation,
} from "./types";

/**
 * Pure: classify a feature vector into a regime decision — Phase 3.1
 * Step 5.
 *
 * Algorithm:
 *  1. Evaluate every rule against the features. Capture each
 *     RuleEvaluation (regardless of match) for the audit trail.
 *  2. Among matched rules, pick the one with the highest strength.
 *  3. If no rule matched OR the best matched strength is below the
 *     {@link REGIME_CONFIDENCE_THRESHOLD} of 0.6, emit
 *     `label="transition"` with `confidence` = best strength seen
 *     across all rules (still informative for the audit trail, even
 *     when below threshold).
 *  4. Otherwise emit that rule's label with `confidence = strength`.
 *
 * Loud failure: a rule whose required inputs are null returns
 * `matched=false`, `strength=0` and a `reasonKo` naming the missing
 * inputs. If every rule short-circuits this way, all strengths are 0
 * and the decision becomes `label="transition"` with `confidence=0`
 * — the Step 9 writer interprets this as "regime undetermined" and
 * writes `regime_label = null` to the snapshot (blueprint §3.1).
 *
 * Pure — no DB, no env, no `server-only`, no fetches. Backtest-
 * replayable per blueprint §0 tenet 3.
 */
export function classifyRegime(features: RegimeFeatures): RegimeDecision {
  const evaluations: RuleEvaluation[] = RULES.map((rule) =>
    rule.evaluate(features),
  );

  let bestMatched: RuleEvaluation | null = null;
  let highestStrengthOverall = 0;

  for (const evaluation of evaluations) {
    if (evaluation.strength > highestStrengthOverall) {
      highestStrengthOverall = evaluation.strength;
    }
    if (
      evaluation.matched &&
      (bestMatched === null || evaluation.strength > bestMatched.strength)
    ) {
      bestMatched = evaluation;
    }
  }

  if (bestMatched !== null && bestMatched.strength >= REGIME_CONFIDENCE_THRESHOLD) {
    return {
      label: bestMatched.rule,
      confidence: bestMatched.strength,
      contributingFeatures: features,
      ruleEvaluations: evaluations,
    };
  }

  return {
    label: "transition",
    confidence: highestStrengthOverall,
    contributingFeatures: features,
    ruleEvaluations: evaluations,
  };
}
