/**
 * Shared output type for Phase 3.0 daily-bar adapters
 * (Twelve Data, Yahoo Finance, future Alpha Vantage shim).
 *
 * Defined here so the fallback chain in `ingest-technical/route.ts`
 * (Phase 3.0 Step 3) can swap sources without branching on adapter
 * shape. The pre-existing `AlphaVantageFetchResult` from
 * `alpha-vantage-parse.ts` is NOT touched — Step 3 wraps it with a
 * small adapter call-site to expose `source_name: "alpha_vantage"`
 * and align `"success" → "ok"`.
 *
 * Reference: docs/phase3_0_data_recovery_blueprint.md §2.1
 */

/** One daily OHLCV bar. Identical fields to `AlphaVantageDailyBar`. */
export interface DailyBar {
  /** Calendar date, ISO YYYY-MM-DD. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type DailyBarFetchStatus = "ok" | "partial" | "error";

/**
 * Common return shape for Phase 3.0+ daily-bar adapters.
 * `bars` is chronological ascending (oldest first).
 */
export interface DailyBarSeries {
  ticker: string;
  bars: ReadonlyArray<DailyBar>;
  /** Most recent bar, or null if bars is empty. */
  latest: DailyBar | null;
  /** Discriminator so the fallback chain audit log knows which tier served. */
  source_name: "alpha_vantage" | "twelvedata" | "yahoo_finance";
  fetch_status: DailyBarFetchStatus;
  /** Populated when fetch_status !== "ok". */
  error?: string;
  /** ISO timestamp of parse completion. */
  fetched_at: string;
}
