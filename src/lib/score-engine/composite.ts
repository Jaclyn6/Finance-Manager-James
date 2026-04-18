import type {
  AssetType,
  CompositeResult,
  IndicatorScore,
} from "./types";

/**
 * Collapses a set of indicator scores into a single 0-100 composite
 * for one asset class, weighted by the per-asset weights attached to
 * each indicator.
 *
 *   composite = Σ (weight_i × score_i) / Σ weight_i
 *
 * Subtleties:
 *
 * 1. **Weights are renormalized per call.** If three indicators in the
 *    config define a weight for `us_equity` but only two produce a
 *    fresh score today (the third's fetch failed), we still want a
 *    sensible composite. Normalizing the two active weights to sum to
 *    1 means the composite reflects what we actually have, not a
 *    value deflated by the missing contributor's implicit 0.
 *
 * 2. **Indicators with no weight for this asset class are skipped.**
 *    The weights object is `Partial<Record<AssetType, number>>`, so a
 *    Korea-only technical indicator (Phase 2) can leave `us_equity`
 *    undefined and be ignored here.
 *
 * 3. **No weight at all → neutral 50.** If every indicator lacks a
 *    weight for the asset type (shouldn't happen in Phase 1 but can in
 *    future misconfigurations), return 50 and an empty contributing
 *    map rather than divide-by-zero into NaN. Defense in depth.
 *
 * 4. **The `contributing` map is persisted to JSONB.** Its shape is
 *    part of the contract with the dashboard's contribution-breakdown
 *    component — changing field names is a breaking change for UI
 *    readers of historical `composite_snapshots.contributing_indicators`.
 */
export function computeComposite(
  indicators: IndicatorScore[],
  assetType: AssetType,
): CompositeResult {
  const active = indicators
    .map((ind) => ({
      ind,
      weight: ind.weights[assetType],
    }))
    .filter(
      (entry): entry is { ind: IndicatorScore; weight: number } =>
        typeof entry.weight === "number" && entry.weight > 0,
    );

  const weightSum = active.reduce((acc, { weight }) => acc + weight, 0);

  if (active.length === 0 || weightSum === 0) {
    return { score0to100: 50, contributing: {} };
  }

  const contributing: CompositeResult["contributing"] = {};
  let composite = 0;

  for (const { ind, weight } of active) {
    const normalizedWeight = weight / weightSum;
    const contribution = ind.score0to100 * normalizedWeight;
    composite += contribution;
    contributing[ind.key] = {
      score: ind.score0to100,
      weight: normalizedWeight,
      contribution,
    };
  }

  return { score0to100: composite, contributing };
}
