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

/**
 * Representative ticker used to overlay a single price series on each
 * asset's `/asset/[slug]` trend chart (blueprint §9 Step 10 + PRD §11.6).
 *
 * Why ONE ticker per asset (not a basket): PRD §11.6 frames the overlay
 * as "그때 점수 72점 → 이후 30일 +2.3%". That narrative needs a single
 * concrete price line the user can read in dollars, not a blended index
 * that requires explanation. Each choice below is the most-liquid,
 * most-recognizable proxy for its category — what a retail investor
 * would casually cite when asked "how did US stocks do?".
 *
 * Choices:
 * - `common` → SPY. The dashboard hero ("공통 매크로") is conceptually
 *   the global risk-on regime; the SPY line there communicates "the US
 *   market" — the world's de-facto risk-on proxy. Same as us_equity
 *   deliberately so users don't see two different lines for what is
 *   visually the same macro story.
 * - `us_equity` → SPY. Broad S&P 500 index — the canonical US benchmark.
 * - `kr_equity` → 005930.KS (Samsung Electronics). The KOSPI 200 proxy
 *   ETF 069500.KS is in the registry, but Samsung's daily prints are
 *   more universally recognized by the KR family-member audience and
 *   track the index tightly (~25% weight). EWY (iShares MSCI Korea) is
 *   NOT in the Phase 2 registry per §3.2 — do not introduce a 20th
 *   ticker just for this chart; AV budget is tight (19 technical + 5
 *   news = 24/25 free-tier daily).
 * - `global_etf` → GLD. Gold is the macro-hedge the family most cares
 *   about when they visit this card; TLT is alternative but GLD's
 *   price chart is more narratively rich (inflation/USD story). EWJ
 *   / MCHI / INDA are country-specific and would mis-represent the
 *   "글로벌 ETF" label. This is a UX choice: if the user pushes back,
 *   swap here — no schema change needed.
 * - `crypto` → BTC. CoinGecko ID `bitcoin`, but stored in
 *   `price_readings` under ticker `BTC` (see ingest-prices route).
 *   ETH / SOL are also in price_readings; Step 10 could add a
 *   multi-line crypto overlay later, but single-ticker BTC matches the
 *   semantics of every other card.
 *
 * Consumers: `src/lib/data/prices.ts` via `pickRepresentativeTicker`,
 * and `src/app/(protected)/asset/[slug]/asset-content.tsx` when it
 * passes `ticker={...}` to `<ScorePriceOverlay>`.
 *
 * Caveat: if the user ever requests a ticker-selector UI ("show me
 * NVDA instead"), promote this from a static map into a per-page
 * searchParam. For now the map wins on simplicity.
 */
export const REPRESENTATIVE_TICKER_BY_ASSET: Record<AssetType, string> = {
  common: "SPY",
  us_equity: "SPY",
  kr_equity: "005930.KS",
  crypto: "BTC",
  global_etf: "GLD",
};

/**
 * Pure helper — returns the representative ticker for an asset type.
 *
 * Extracted as a function (not just an inline lookup) so it can be
 * unit-tested without a Supabase mock, and so a future refactor to
 * per-user overrides has exactly one call site to change.
 */
export function pickRepresentativeTicker(assetType: AssetType): string {
  return REPRESENTATIVE_TICKER_BY_ASSET[assetType];
}
