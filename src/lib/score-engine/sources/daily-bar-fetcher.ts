import "server-only";

/**
 * Phase 3.0 Step 3 — daily-bar fallback chain.
 *
 * Single entrypoint for `ingest-technical/route.ts`. Replaces the
 * direct `fetchAlphaVantageDaily(ticker)` call with a tiered chain
 * so the cron survives any one source going down + populates MA(200)
 * (which AV's free-tier `compact` 100-bar response cannot supply).
 *
 * Tiers per blueprint §2.2:
 *   - Tier 1 (US/global only): Alpha Vantage `compact` (existing).
 *     KEPT for two reasons: (a) it's already wired with retry/parse;
 *     (b) <= 100 bars suffices for RSI(14) / MACD / MA(50) / BB(20),
 *     so the cheaper-to-debug primary path still runs first. We then
 *     CHECK the bar count: if < 200 we fall through to Tier 2 to get
 *     enough history for MA(200).
 *   - Tier 2 (US/global only): Twelve Data `outputsize=300`. KR
 *     tickers (`.KS` / `.KQ`) skip this — Twelve Data doesn't cover
 *     KOSPI / KOSDAQ on the free plan.
 *   - Tier 3 (universal): Yahoo Finance `chart?range=2y`. PRIMARY for
 *     KR tickers. Last-resort tertiary for US/global.
 *
 * The chain stops at the first tier returning `fetch_status: "ok"`
 * with `bars.length >= 200`. If all tiers fail or all return < 200
 * bars, the chain returns the highest-quality partial result it has
 * (preferring Tier 1's < 200 bars over a Tier 3 hard error, since the
 * cron downstream can still compute RSI/MACD/MA50/BB20 with 100 bars
 * and write `MA_200='partial'` — same null-propagation contract that
 * applied before Phase 3.0).
 *
 * Reference: docs/phase3_0_data_recovery_blueprint.md §2.2
 */

import {
  fetchAlphaVantageDaily,
  type AlphaVantageFetchResult,
} from "./alpha-vantage";
import { fetchTwelveDataDaily } from "./twelvedata";
import { fetchYahooFinanceDaily } from "./yahoo-finance";
import type { DailyBarSeries } from "./daily-bar-types";

/**
 * Minimum bar count required to compute MA(200) and Disparity. Below
 * this, the fallback chain still tries the next tier in case it can
 * deliver 200+ bars.
 */
const MA_200_MIN_BARS = 200;

/**
 * Adapt the legacy `AlphaVantageFetchResult` shape (kept stable for
 * other callers) to the unified `DailyBarSeries`. The two shapes have
 * identical bar fields; only the wrapper differs.
 */
function avToDailyBarSeries(
  ticker: string,
  result: AlphaVantageFetchResult,
): DailyBarSeries {
  const fetched_at = result.fetched_at;
  const error = result.error;
  if (result.fetch_status === "success") {
    return {
      ticker,
      bars: result.bars,
      latest: result.latest,
      source_name: "alpha_vantage",
      fetch_status: "ok",
      fetched_at,
    };
  }
  if (result.fetch_status === "partial") {
    return {
      ticker,
      bars: result.bars,
      latest: result.latest,
      source_name: "alpha_vantage",
      fetch_status: "partial",
      ...(error ? { error } : {}),
      fetched_at,
    };
  }
  return {
    ticker,
    bars: result.bars,
    latest: result.latest,
    source_name: "alpha_vantage",
    fetch_status: "error",
    ...(error ? { error } : {}),
    fetched_at,
  };
}

/**
 * Detect KR tickers (KOSPI `.KS`, KOSDAQ `.KQ`). AV and Twelve Data
 * both reject these; Yahoo Finance is the only free option.
 */
export function isKrTicker(ticker: string): boolean {
  return /\.(KS|KQ)$/.test(ticker);
}

/**
 * Per-tier outcome captured for the route's audit / `ingest_runs`
 * notes. The route doesn't currently persist a per-tier breakdown,
 * but emitting one here means a future audit-log refactor can wire
 * it in without changing the call signature.
 */
export interface TieredFetchOutcome {
  /** The series the route should write to DB. */
  result: DailyBarSeries;
  /** Diagnostic — which tiers were tried in this call. */
  tiersAttempted: ReadonlyArray<DailyBarSeries["source_name"]>;
}

/**
 * Fetch one ticker through the 3-tier fallback chain.
 *
 * Returns the highest-quality `DailyBarSeries` available from
 * any tier, plus the per-tier diagnostic. Never throws on upstream
 * failure (each adapter swallows its own).
 */
export async function fetchDailyBars(
  ticker: string,
): Promise<TieredFetchOutcome> {
  const tiersAttempted: Array<DailyBarSeries["source_name"]> = [];

  // For KR tickers, skip Tier 1 + 2 directly. AV/Twelve Data both
  // reject `.KS` / `.KQ` formats — calling them would burn quota
  // for a guaranteed error.
  if (isKrTicker(ticker)) {
    tiersAttempted.push("yahoo_finance");
    const yahoo = await fetchYahooFinanceDaily(ticker);
    return { result: yahoo, tiersAttempted };
  }

  // ---- Tier 1: Alpha Vantage (compact) ----
  tiersAttempted.push("alpha_vantage");
  const av = await fetchAlphaVantageDaily(ticker);
  const avNormalized = avToDailyBarSeries(ticker, av);

  // Tier 1 fully sufficient → return immediately. AV's free tier
  // returns 100 bars (compact), which is BELOW the 200 floor, so
  // this branch only activates if AV ever serves >= 200 bars
  // (e.g. account upgraded to premium). For now Tier 1 always
  // falls through to Tier 2.
  if (
    avNormalized.fetch_status === "ok" &&
    avNormalized.bars.length >= MA_200_MIN_BARS
  ) {
    return { result: avNormalized, tiersAttempted };
  }

  // ---- Tier 2: Twelve Data (300 bars) ----
  tiersAttempted.push("twelvedata");
  const td = await fetchTwelveDataDaily(ticker);
  if (td.fetch_status === "ok" && td.bars.length >= MA_200_MIN_BARS) {
    return { result: td, tiersAttempted };
  }

  // ---- Tier 3: Yahoo Finance (2y range) ----
  tiersAttempted.push("yahoo_finance");
  const yahoo = await fetchYahooFinanceDaily(ticker);
  if (yahoo.fetch_status === "ok" && yahoo.bars.length >= MA_200_MIN_BARS) {
    return { result: yahoo, tiersAttempted };
  }

  // ---- All tiers failed or returned < 200 bars ----
  // Pick the best available with strict status preference:
  //   1. Any tier with `ok` status, ranked by bars.length DESC.
  //   2. Then any tier with `partial` status (i.e. bars present but
  //      flagged degraded), ranked by bars.length DESC.
  //   3. Hard `error` results never win this selection — using one
  //      would let stale/cached bars in an error result override a
  //      clean partial with fewer bars (Reviewer #4 R4.1, R2.1).
  // This preserves the pre-3.0 behavior where AV-compact 100-bar
  // responses still let the cron compute RSI/MACD/MA50/BB20 and
  // write MA_200='partial'.
  const candidates = [avNormalized, td, yahoo];
  const okCandidates = candidates.filter((c) => c.fetch_status === "ok");
  if (okCandidates.length > 0) {
    okCandidates.sort((a, b) => b.bars.length - a.bars.length);
    return { result: okCandidates[0]!, tiersAttempted };
  }

  const partialCandidates = candidates.filter(
    (c) => c.fetch_status === "partial" && c.bars.length > 0,
  );
  if (partialCandidates.length > 0) {
    partialCandidates.sort((a, b) => b.bars.length - a.bars.length);
    return { result: partialCandidates[0]!, tiersAttempted };
  }

  // Worst case: every tier returned a hard error. Surface the AV
  // (Tier 1) error since the route's existing diagnostics already
  // speak Alpha-Vantage-isms; future iterations can pivot.
  return { result: avNormalized, tiersAttempted };
}
