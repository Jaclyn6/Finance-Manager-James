/**
 * Phase 3.0 ticker registry — 19 symbols total (12 US/global via the
 * Alpha Vantage / Twelve Data / Yahoo Finance fallback chain primary
 * + 7 KR via Yahoo Finance only). Daily bars feed both the
 * `technical_readings` pipeline (RSI / MACD / MA50 / MA200 / Bollinger /
 * Disparity per blueprint §4.3) and the `price_readings` visualization
 * table (§7.4 visualization-only invariant — same fetch, two writes,
 * see §3.3).
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
 * KR equity history (2026-04-25 carve-out → 2026-04-26 reinstatement):
 * ------------------------------------------------------------------
 * The 2026-04-25 carve-out removed 7 KR `.KS` tickers because Alpha
 * Vantage's free tier rejects `KOSPI / KOSDAQ` formats outright
 * (`Invalid API call` for `.KS`, `.KQ`, `.KOSPI`, `.KRX`, and the
 * bare 6-digit code).
 *
 * Phase 3.0 (2026-04-26) reinstates the 7 tickers under a tiered
 * fallback chain: Yahoo Finance `query2/v8/finance/chart` is the
 * PRIMARY source for `.KS` / `.KQ` symbols. AV and Twelve Data are
 * skipped for KR tickers via `isKrTicker()` in
 * `src/lib/score-engine/sources/daily-bar-fetcher.ts`. Yahoo's
 * `chart` endpoint serves Samsung 005930.KS, KODEX 069500.KS,
 * KODEX KOSDAQ150 229200.KQ etc. with no key required.
 *
 * Consequence: the `kr_equity` technical category is once again live.
 * `aggregateTechnical("kr_equity")` returns a non-null score; the
 * blueprint §10.3 25-pt technical weight is fully populated.
 *
 * KR ticker selection rationale (kept identical to pre-carve-out
 * 2026-04-23 list for cross-period reproducibility):
 *   005930.KS Samsung Electronics, 000660.KS SK Hynix,
 *   373220.KS LG Energy Solution, 207940.KS Samsung Biologics,
 *   005380.KS Hyundai Motor — five KOSPI large-caps;
 *   069500.KS KODEX 200 ETF (KOSPI broad-index proxy);
 *   229200.KQ KODEX KOSDAQ150 ETF (KOSDAQ broad-index proxy).
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
 * The 19 Phase 3.0 tickers, frozen per blueprint §3.2 + 3.0 §5 Step 4.
 *
 * Order is intentional: SPY + QQQ lead the list because they are the
 * most load-bearing tickers in the downstream graph (signals.ts
 * MOMENTUM_TURN, category-aggregators.ts broad-index aggregator). If a
 * mid-loop outage curtails the run, the load-bearing tickers have
 * already landed.
 *
 * Pacing budget: only the AV-served tickers (12 US/global) need 13s
 * spacing for the 5 req/min free-tier ceiling. The 7 KR tickers route
 * through Yahoo Finance via `daily-bar-fetcher.ts` and have NO
 * per-minute throttle, so the cron sleeps 13s only between AV calls.
 * Total walltime: 11 AV sleeps × 13s + 12 AV fetches + 7 Yahoo
 * fetches ≈ 165–185s — comfortably inside Vercel Hobby's 300s
 * `maxDuration` ceiling (single-batch design preserved from Phase 2).
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
  // ----- 3 regional / country ETFs (AV-served) -----
  { ticker: "EWJ", asset_type: "global_etf" }, // Japan
  { ticker: "MCHI", asset_type: "global_etf" }, // China
  { ticker: "INDA", asset_type: "global_etf" }, // India
  // ----- 2 macro-hedge ETFs (AV-served) -----
  { ticker: "GLD", asset_type: "global_etf" }, // Gold
  { ticker: "TLT", asset_type: "global_etf" }, // Long Treasuries
  // ----- 5 KR large-caps (Yahoo-served via fallback chain) -----
  { ticker: "005930.KS", asset_type: "kr_equity" }, // Samsung Electronics
  { ticker: "000660.KS", asset_type: "kr_equity" }, // SK Hynix
  { ticker: "373220.KS", asset_type: "kr_equity" }, // LG Energy Solution
  { ticker: "207940.KS", asset_type: "kr_equity" }, // Samsung Biologics
  { ticker: "005380.KS", asset_type: "kr_equity" }, // Hyundai Motor
  // ----- 2 KR broad-index ETFs (Yahoo-served) -----
  { ticker: "069500.KS", asset_type: "kr_equity" }, // KODEX 200 (KOSPI proxy)
  { ticker: "229200.KQ", asset_type: "kr_equity" }, // KODEX KOSDAQ150 (KOSDAQ proxy)
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
