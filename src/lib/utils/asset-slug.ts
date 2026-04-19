import type { AssetType } from "@/lib/score-engine/types";

/**
 * URL slug ↔ `asset_type_enum` mapping for the `/asset/[slug]` routes.
 *
 * Why a separate file from `asset-labels.ts`: labels are UI text
 * (changing one is a user-visible rename), slugs are URL contract
 * (changing one is a breaking change for bookmarks and links). Keeping
 * them separate makes the two audiences' concerns orthogonal.
 *
 * Slug style: kebab-case, mirroring Next.js idiomatic route segments
 * and matching the existing `nav-items.ts` hrefs:
 *   `us_equity` → `us-equity`
 *   `kr_equity` → `kr-equity`
 *   `crypto`    → `crypto`
 *   `global_etf` → `global-etf`
 *
 * `common` is deliberately absent — it renders as the dashboard hero
 * (`CompositeStateCard`), not as its own asset page.
 */
export const ASSET_SLUGS: Record<Exclude<AssetType, "common">, string> = {
  us_equity: "us-equity",
  kr_equity: "kr-equity",
  crypto: "crypto",
  global_etf: "global-etf",
};

/**
 * Slug → `AssetType` reverse lookup. Returns `null` for unknown slugs
 * (including `"common"` since it has no dedicated page, and any
 * prototype-chain entries like `"toString"` / `"constructor"` that
 * could otherwise slip through a naive `ASSET_SLUGS[slug]` lookup).
 *
 * Callers 404 on `null` — there's no graceful fallback because an
 * unknown asset slug has no meaningful rendering (empty state would
 * confuse; guessing the wrong asset would mislead).
 */
export function slugToAssetType(slug: string): AssetType | null {
  // Inverse lookup via entries ensures we only ever return an enum
  // value that's in the map — no possibility of a stray
  // `Object.prototype` key matching.
  for (const [assetType, mappedSlug] of Object.entries(ASSET_SLUGS)) {
    if (mappedSlug === slug) return assetType as AssetType;
  }
  return null;
}

/**
 * All valid slugs, for `generateStaticParams`. Prerenders the four
 * known asset pages at build time so first-render is fast and
 * unknown slugs are machine-listable in one place.
 */
export function listAllAssetSlugs(): string[] {
  return Object.values(ASSET_SLUGS);
}
