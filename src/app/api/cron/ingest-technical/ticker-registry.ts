/**
 * Frozen Phase 2 ticker registry — the 12 Alpha Vantage symbols whose
 * daily bars feed both the `technical_readings` pipeline (RSI / MACD /
 * MA50 / MA200 / Bollinger / Disparity per blueprint §4.3) and the
 * `price_readings` visualization table (§7.4 visualization-only
 * invariant — same fetch, two writes, see §3.3).
 *
 * Kept in a separate file from `route.ts` so Vitest can import
 * `TICKER_REGISTRY` without dragging in `import "server-only"` or the
 * full Next.js Route Handler runtime. The route handler re-exports
 * nothing from here — call sites simply import `TICKER_REGISTRY` (and
 * optionally `INDICATOR_KEYS`) directly.
 *
 * Registry source of truth: blueprint §3.2.
 * Ticker-list cutover version: `TICKER_LIST_VERSION` in
 * `src/lib/score-engine/weights.ts`. A silent edit to the array below
 * without bumping that constant is a blueprint §11 risk row 5 violation.
 *
 * Asset-type mapping rules (aligned with the `asset_type_enum` in
 * migration 0001):
 *
 *   SPY / QQQ / NVDA / AAPL / MSFT / GOOGL /
 *     AMZN                                  → 'us_equity'
 *   EWJ / MCHI / INDA / GLD / TLT           → 'global_etf'
 *
 * Crypto IDs (bitcoin / ethereum / solana) are NOT in this registry —
 * they come from CoinGecko and live in the `ingest-prices` route's
 * own small constant, since only price-readings (not technical) are
 * computed for crypto at Phase 2.
 *
 * KR equity carve-out (2026-04-25):
 * --------------------------------
 * The previous version of this registry carried 7 `.KS` tickers
 * (005930.KS Samsung, 000660.KS SK Hynix, 373220.KS LGES,
 * 207940.KS Samsung Bio, 005380.KS Hyundai Motor, 069500.KS KODEX 200,
 * 232080.KS TIGER KOSDAQ150). Direct testing against Alpha Vantage's
 * `TIME_SERIES_DAILY` confirmed that the free tier does NOT serve
 * KOSPI / KOSDAQ symbols in ANY format — `.KS`, `.KQ`, `.KOSPI`,
 * `.KRX`, and the bare 6-digit code all return `Invalid API call`.
 * The only KR-related symbol AV serves is the London-listed Samsung
 * ADR `SMSN.LON`, which doesn't represent the local KOSPI tape and
 * isn't useful for the regional-overlay aggregator.
 *
 * Consequence: the `kr_equity` technical category has no AV-sourced
 * inputs at Phase 2. {@link aggregateTechnical} for `kr_equity`
 * therefore returns `null`, which `computeCompositeV2` surfaces in
 * `missingCategories` as a transparent gap (blueprint §2.2 tenet 1
 * "null-propagation, never neutral default"). The `regional_overlay`
 * category (DTWEXBGS + DEXKOUS via FRED) and `sentiment` (CNN_FG)
 * still contribute, so the kr_equity composite remains computable —
 * just on a smaller weight base than the blueprint's nominal 25-pt
 * technical slot.
 *
 * Phase 3 plan: integrate ECOS (한국은행 OpenAPI) or Yahoo Finance
 * for KOSPI/KOSDAQ daily bars. Either source serves KR equities
 * natively without the AV free-tier limitation, restoring the
 * `kr_equity` technical category to full weight. Tracked under
 * blueprint §11 risk row 8.
 */

import type { Database } from "@/types/database";

type AssetType = Database["public"]["Enums"]["asset_type_enum"];

export interface TickerRegistryEntry {
  /** Alpha Vantage symbol as fetched from `TIME_SERIES_DAILY`. */
  ticker: string;
  /** Classification for `technical_readings.asset_type` + `price_readings.asset_type`. */
  asset_type: AssetType;
}

/**
 * The 12 Phase 2 Alpha Vantage tickers, frozen per blueprint §3.2
 * (KR carve-out 2026-04-25 — see file-header note).
 *
 * Order is intentional: SPY + QQQ lead the list because they are the
 * most load-bearing tickers in the downstream graph (signals.ts
 * MOMENTUM_TURN, category-aggregators.ts broad-index aggregator). If a
 * mid-loop AV outage curtails the run, the load-bearing tickers have
 * already landed.
 *
 * The cron walks this list sequentially with a 13-second sleep between
 * calls to respect Alpha Vantage's 5 req/min free-tier ceiling (see
 * `alpha-vantage.ts` design note 1). 12 tickers × ~13s sleep + ~2s
 * fetch latency ≈ 180s, comfortably inside the Vercel Hobby 300s
 * `maxDuration` ceiling — so the registry runs as a single batch
 * (no `?batch=1|2` split needed post-KR removal).
 */
export const TICKER_REGISTRY: readonly TickerRegistryEntry[] = [
  // ----- SPY + QQQ lead — broad-index aggregator dependency -----
  { ticker: "SPY", asset_type: "us_equity" },
  { ticker: "QQQ", asset_type: "us_equity" },
  // ----- 5 US large-caps -----
  { ticker: "NVDA", asset_type: "us_equity" },
  { ticker: "AAPL", asset_type: "us_equity" },
  { ticker: "MSFT", asset_type: "us_equity" },
  { ticker: "GOOGL", asset_type: "us_equity" },
  { ticker: "AMZN", asset_type: "us_equity" },
  // ----- 3 regional / country ETFs -----
  { ticker: "EWJ", asset_type: "global_etf" }, // Japan
  { ticker: "MCHI", asset_type: "global_etf" }, // China
  { ticker: "INDA", asset_type: "global_etf" }, // India
  // ----- 2 macro-hedge ETFs -----
  { ticker: "GLD", asset_type: "global_etf" }, // Gold
  { ticker: "TLT", asset_type: "global_etf" }, // Long Treasuries
] as const;

/**
 * Canonical `indicator_key` strings for the `technical_readings` table.
 *
 * These MUST match the comment at migration 0005 line 24 verbatim —
 * the migration comment is the single source of truth for allowed
 * keys. A mismatch here doesn't break any DB constraint (the column
 * is `TEXT`) but silently splinters the key space so the dashboard's
 * per-indicator reader can't find rows. The ticker-registry test
 * asserts equality with the migration's key list.
 */
export const INDICATOR_KEYS = {
  RSI_14: "RSI_14",
  MACD_12_26_9: "MACD_12_26_9",
  MA_50: "MA_50",
  MA_200: "MA_200",
  BB_20_2: "BB_20_2",
  DISPARITY: "DISPARITY",
} as const;

export type TechnicalIndicatorKey =
  (typeof INDICATOR_KEYS)[keyof typeof INDICATOR_KEYS];

/**
 * Alpha Vantage free-tier pacing — 5 req/min → 12s minimum. We sleep
 * 13s to leave a 1s safety margin for upstream jitter (alpha-vantage.ts
 * design note 1).
 *
 * Total wall-clock budget for the single batch:
 *   12 tickers: 11 sleeps × 13s + 12 fetches ≈ 160-180s.
 * Comfortably inside the Vercel Hobby 300s `maxDuration` ceiling.
 *
 * Exported so the ticker-registry test can assert the multiplied total
 * stays inside the route's `maxDuration` budget.
 */
export const ALPHA_VANTAGE_SLEEP_MS = 13_000;
