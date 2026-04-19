import type { AssetType } from "@/lib/score-engine/types";

/**
 * Korean display labels for each `asset_type_enum` value.
 *
 * Kept here (not inside a component) so the same strings can feed:
 * - dashboard AssetCard headings,
 * - Step 11 asset-detail page breadcrumbs,
 * - RecentChanges row labels,
 * - future changelog / filter UIs.
 *
 * Changing a label here is an intentional user-visible rename. The
 * keys are the DB enum values — changing those requires a migration.
 */
export const ASSET_LABELS: Record<AssetType, string> = {
  common: "공통 매크로",
  us_equity: "미국 주식",
  kr_equity: "한국 주식",
  crypto: "암호화폐",
  global_etf: "글로벌 ETF",
};

/**
 * Canonical display order for the dashboard's per-asset grid.
 *
 * `common` is intentionally excluded — it renders separately as the
 * top `CompositeStateCard` (the "overall" hero), not as one of the
 * four peer cards. If a Phase 2 enum adds a new asset type, append it
 * here (usually at the end of the existing order) rather than relying
 * on `Object.keys(ASSET_LABELS)` insertion order, which could drift.
 */
export const DASHBOARD_ASSET_ORDER: readonly AssetType[] = [
  "us_equity",
  "kr_equity",
  "global_etf",
  "crypto",
] as const;
