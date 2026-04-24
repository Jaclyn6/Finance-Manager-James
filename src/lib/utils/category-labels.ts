import type { CategoryName } from "@/lib/score-engine/types";

/**
 * Korean display labels for each composite-v2 category.
 *
 * Separate from {@link ASSET_LABELS} because these are category labels,
 * not asset labels — conflating them into one map would require
 * shoehorning both key spaces under a common enum. Isolation also
 * keeps `ContributingIndicators` (Step 8) from transitively pulling in
 * the asset-label surface.
 *
 * Rendered in the grouped Contributing Indicators card (blueprint §9
 * Step 8) as the section heading for each category. Stays in sync
 * with `CategoryName` via the compile-time `Record<CategoryName, ...>`
 * constraint — adding a new category to the union forces an entry
 * here.
 */
export const CATEGORY_LABELS_KO: Record<CategoryName, string> = {
  macro: "매크로",
  technical: "기술적",
  onchain: "온체인",
  sentiment: "뉴스 · 심리",
  valuation: "밸류에이션",
  regional_overlay: "지역 오버레이",
};

/**
 * Canonical display order for the grouped Contributing Indicators
 * card. Stable across asset types — missing categories collapse out
 * at render time rather than reshuffling the remaining ones.
 */
export const CATEGORY_DISPLAY_ORDER: readonly CategoryName[] = [
  "macro",
  "technical",
  "onchain",
  "sentiment",
  "valuation",
  "regional_overlay",
] as const;
