/**
 * Frozen Phase 2 ticker registry — the 19 Alpha Vantage symbols whose
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
 *   `.KS` suffix                            → 'kr_equity'
 *   SPY / QQQ / NVDA / AAPL / MSFT / GOOGL /
 *     AMZN                                  → 'us_equity'
 *   EWJ / MCHI / INDA / GLD / TLT           → 'global_etf'
 *
 * Crypto IDs (bitcoin / ethereum / solana) are NOT in this registry —
 * they come from CoinGecko and live in the `ingest-prices` route's
 * own small constant, since only price-readings (not technical) are
 * computed for crypto at Phase 2.
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
 * The 19 Phase 2 Alpha Vantage tickers, frozen per blueprint §3.2.
 *
 * Order is intentional: SPY + QQQ lead the list because the C2
 * batch-split (`?batch=1|2`) takes the first 10 in batch 1. SPY/QQQ
 * feed the MOMENTUM_TURN signal in `signals.ts` and the broad-index
 * aggregator in `category-aggregators.ts`, so if batch 2 ever fails we
 * still have the most-load-bearing tickers ingested.
 *
 * After SPY/QQQ the order is (US large-caps → KR equities/ETFs →
 * region ETFs → macro-hedge ETFs). Indices 0-9 form batch 1 (SPY, QQQ,
 * NVDA, AAPL, MSFT, GOOGL, AMZN, three KR), indices 10-18 form batch 2
 * (remaining four KR + three region ETFs + two macro-hedge ETFs).
 *
 * The cron walks this list sequentially with a 13-second sleep between
 * calls to respect Alpha Vantage's 5 req/min free-tier ceiling (see
 * `alpha-vantage.ts` design note 1). A change to the order doesn't
 * affect correctness — but does affect which batch a ticker lands in,
 * which matters for the failure-mode reasoning above.
 */
export const TICKER_REGISTRY: readonly TickerRegistryEntry[] = [
  // ----- Batch 1 (indices 0-9) — load-bearing tickers first -----
  // SPY + QQQ lead so they survive a batch-2 outage (see header note).
  { ticker: "SPY", asset_type: "us_equity" },
  { ticker: "QQQ", asset_type: "us_equity" },
  { ticker: "NVDA", asset_type: "us_equity" },
  { ticker: "AAPL", asset_type: "us_equity" },
  { ticker: "MSFT", asset_type: "us_equity" },
  { ticker: "GOOGL", asset_type: "us_equity" },
  { ticker: "AMZN", asset_type: "us_equity" },
  { ticker: "005930.KS", asset_type: "kr_equity" }, // 삼성전자
  { ticker: "000660.KS", asset_type: "kr_equity" }, // SK하이닉스
  { ticker: "373220.KS", asset_type: "kr_equity" }, // LG에너지솔루션
  // ----- Batch 2 (indices 10-18) -----
  { ticker: "207940.KS", asset_type: "kr_equity" }, // 삼성바이오로직스
  { ticker: "005380.KS", asset_type: "kr_equity" }, // 현대차
  { ticker: "069500.KS", asset_type: "kr_equity" }, // KODEX 200
  { ticker: "232080.KS", asset_type: "kr_equity" }, // TIGER 코스닥150
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
 * Total wall-clock budget per batch (post-C2 split):
 *   Batch 1 (10 tickers): 9 sleeps × 13s + 10 fetches ≈ 130-150s.
 *   Batch 2 (9 tickers):  8 sleeps × 13s + 9 fetches  ≈ 115-135s.
 * Both comfortably inside the Vercel Hobby 300s `maxDuration` ceiling
 * — the pre-split single-shot run was hitting ~285-310s on bad days
 * (GHA run 24920958904 timed out at 4m18s).
 *
 * Exported so the ticker-registry test can assert the multiplied total
 * stays inside the route's `maxDuration` budget.
 */
export const ALPHA_VANTAGE_SLEEP_MS = 13_000;
