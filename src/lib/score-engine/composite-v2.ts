import type {
  AssetType,
  CategoryContribution,
  CategoryName,
  CategoryScores,
  CompositeResultV2,
} from "./types";
import { CATEGORY_WEIGHTS } from "./weights";

/**
 * Canonical ordering for iteration over category scores. Keeps the
 * `contributing` object's key insertion order stable across runs so
 * JSONB diffs in `composite_snapshots.contributing_indicators` are
 * line-stable in Supabase Studio.
 */
const CATEGORY_ORDER: readonly CategoryName[] = [
  "macro",
  "technical",
  "onchain",
  "sentiment",
  "valuation",
  "regional_overlay",
];

/**
 * Score-engine v2 — weighted sum of up to 4 category scores per-asset.
 *
 * This is the Phase 2 replacement for the Phase 1 indicator-level
 * {@link computeComposite}. The Phase 1 function is still used
 * UPSTREAM of this one: `ingest-macro` computes the 7-FRED macro
 * composite via `computeComposite`, takes its `score0to100` as the
 * "macro category score", and feeds it to this function wrapped in a
 * {@link CategoryScores} object with the other three categories null.
 * During gradual rollout (Steps 7-8 add the other three sources), the
 * composite equals whatever category is present.
 *
 * Design principles:
 *
 * 1. **Null-propagation with renormalization (blueprint §2.2 tenet 1).**
 *    A missing category (null score) is REMOVED from the weighted sum
 *    and the remaining weights are normalized to 1. This preserves the
 *    composite's dynamic range — at Step 6 cutover only `macro` is
 *    populated, so the composite equals the macro score exactly. As
 *    sources come online the composite gradually shifts toward the
 *    full §4.2 blend. The alternative (treating null as neutral 50)
 *    would silently flatten the composite toward the mean during
 *    rollout; the alternative (treating null as 0) would silently bias
 *    it downward. Renormalization is the only choice that doesn't lie.
 *
 * 2. **Missing categories are surfaced, not hidden.** Every null
 *    category score is recorded in `missingCategories` so the UI can
 *    render an "N/4 categories active" transparency chip. Silent
 *    degradation that looks like a valid reading is the anti-pattern
 *    we're explicitly preventing (plan §0.5 tenet 1 "silent success,
 *    loud failure" inverted — loud degradation, not silent averaging).
 *
 * 3. **Not-applicable ≠ missing.** If a category has no weight for
 *    this asset type (e.g. on-chain for US equity), it is skipped
 *    WITHOUT being added to `missingCategories`. Missing means "this
 *    category applies to this asset but we have no data"; not-
 *    applicable means "this category doesn't apply to this asset, by
 *    design." Different UX consequences: missing = yellow chip,
 *    not-applicable = no chip at all.
 *
 * 4. **All present categories null → neutral 50.** If every applicable
 *    category is null, return 50 with empty `contributing`. Matches
 *    Phase 1 `computeComposite`'s defensive fallback (composite.ts
 *    line 66). A dashboard with a blank score0to100 is worse than a
 *    dashboard with a neutral reading flanked by a loud "0/4 active"
 *    chip — the chip tells the user why.
 *
 * 5. **Pure. No DB, no env, no `server-only`.** Unit-testable in
 *    isolation. The indicator-level `computeComposite` has the same
 *    contract; do not break it.
 */
export function computeCompositeV2(
  categoryScores: CategoryScores,
  assetType: AssetType,
): CompositeResultV2 {
  const weights = CATEGORY_WEIGHTS[assetType];

  const present: Array<{
    category: CategoryName;
    score: number;
    rawWeight: number;
  }> = [];
  const missing: CategoryName[] = [];

  for (const category of CATEGORY_ORDER) {
    const rawWeight = weights[category];
    if (
      typeof rawWeight !== "number" ||
      !Number.isFinite(rawWeight) ||
      rawWeight <= 0
    ) {
      // No weight for this category on this asset type — not
      // applicable, not "missing". Skip silently.
      continue;
    }
    const score = categoryScores[category];
    if (score === null || typeof score !== "number" || !Number.isFinite(score)) {
      // Applicable but null/NaN → loud missing.
      missing.push(category);
      continue;
    }
    present.push({ category, score, rawWeight });
  }

  if (present.length === 0) {
    return {
      score0to100: 50,
      contributing: {},
      missingCategories: missing,
    };
  }

  const rawSum = present.reduce((acc, { rawWeight }) => acc + rawWeight, 0);

  // Defense in depth: rawSum can't be zero here (all entries have
  // rawWeight > 0), but an Infinity weight combined with a finite one
  // would give Infinity — filter already rejects Infinity, so rawSum
  // is finite by construction. Still guard to avoid NaN leaks.
  if (!Number.isFinite(rawSum) || rawSum <= 0) {
    return {
      score0to100: 50,
      contributing: {},
      missingCategories: missing,
    };
  }

  const contributing: Partial<Record<CategoryName, CategoryContribution>> = {};
  let composite = 0;

  for (const { category, score, rawWeight } of present) {
    const normalizedWeight = rawWeight / rawSum;
    const contribution = score * normalizedWeight;
    composite += contribution;
    contributing[category] = {
      score,
      weight: normalizedWeight,
      contribution,
    };
  }

  return {
    score0to100: composite,
    contributing,
    missingCategories: missing,
  };
}
