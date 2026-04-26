import "server-only";

/**
 * Twelve Data time_series daily-bar fetcher (Phase 3.0 Tier 2 adapter).
 *
 * Returns up to 300 daily OHLCV bars for a given ticker in chronological
 * ascending order, conforming to `DailyBarSeries`. The fallback chain in
 * `ingest-technical/route.ts` (Phase 3.0 Step 3) calls this between
 * Alpha Vantage (Tier 1, capped at 100 bars on the free tier) and
 * Yahoo Finance (Tier 3, no key) so MA(200) / Disparity / MACD-7d windows
 * have enough history to compute.
 *
 * Endpoint:
 *   GET https://api.twelvedata.com/time_series
 *     ?symbol={ticker}&interval=1day&outputsize=300&apikey={key}
 *
 * References:
 * - Twelve Data time_series API: https://twelvedata.com/docs#time-series
 * - Twelve Data pricing/limits: https://twelvedata.com/pricing (free 800/d, 8/min)
 * - docs/phase3_0_data_recovery_blueprint.md §2.1, §5 Step 1
 *
 * Design choices (mirrors `alpha-vantage.ts`):
 *
 * 1. Never throws on upstream failure. Network errors, non-200 HTTP,
 *    malformed JSON, and error-in-body payloads all return DailyBarSeries
 *    with `fetch_status: "error"`. The fallback chain must not let one
 *    bad ticker poison the run (blueprint §0.5 tenet 1).
 * 2. Hard 15s timeout per call. Free tier is 8/min; each individual
 *    call still deserves a wall-clock limit in case upstream hangs.
 * 3. `cache: "no-store"`. The cron always wants fresh data.
 * 4. No retries on 429 (`retryOnRateLimit: false` style — mirrors
 *    `bitbo.ts`). A 429 inside the per-minute window will not succeed
 *    on retry; retrying just burns more quota. Fail loud immediately
 *    so the fallback chain moves to Yahoo Finance.
 * 5. Pure parser extracted to `twelvedata-parse.ts`. Keeps Vitest free
 *    of the `"server-only"` guard. Same split as alpha-vantage / parse.
 * 6. `import "server-only"` guard. TWELVEDATA_API_KEY must never reach
 *    a browser bundle.
 *
 * Rate-limit note (Step 3 implementer): free tier is 800/day, 8/min.
 * With 19 tickers × ~2s fetch + 13s sleep gates between AV requests
 * (existing pattern), per-minute usage stays well under 8. On 429
 * `fetch_status:'error'` propagates and Step 3 falls to Yahoo (Tier 3).
 */

import {
  parseTwelveDataResponse,
  makeTwelveDataErrorResult,
} from "./twelvedata-parse";
import { redactSecretsFromErrorMessage } from "./_redact";
import type { DailyBarSeries } from "./daily-bar-types";

export type { DailyBarSeries };
export { parseTwelveDataResponse };

const TWELVEDATA_BASE_URL = "https://api.twelvedata.com/time_series";
const FETCH_TIMEOUT_MS = 15_000;
const OUTPUT_SIZE = 300;

/**
 * Fetch one Twelve Data daily-bar series and return a parsed,
 * scoring-ready result. Never throws on network/HTTP/upstream failure.
 * Throws only when `TWELVEDATA_API_KEY` is unset — a configuration error.
 */
export async function fetchTwelveDataDaily(
  ticker: string,
): Promise<DailyBarSeries> {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "TWELVEDATA_API_KEY is not set — add it to .env.local (dev) or Vercel env (prod)",
    );
  }

  const url = new URL(TWELVEDATA_BASE_URL);
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("interval", "1day");
  url.searchParams.set("outputsize", String(OUTPUT_SIZE));
  url.searchParams.set("apikey", apiKey);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const detail =
        response.status === 429
          ? "Twelve Data HTTP 429 rate limit (8/min free tier exhausted)"
          : `Twelve Data HTTP ${response.status} ${response.statusText}`;
      return makeTwelveDataErrorResult(ticker, detail);
    }

    const body = (await response.json()) as unknown;
    return parseTwelveDataResponse(ticker, body);
  } catch (err) {
    // Scrub `?apikey=<key>` from error message in case undici embeds
    // the request URL — see `_redact.ts` for rationale.
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `Twelve Data request timed out after ${FETCH_TIMEOUT_MS}ms`
        : err instanceof Error
          ? redactSecretsFromErrorMessage(err.message)
          : redactSecretsFromErrorMessage(String(err));
    return makeTwelveDataErrorResult(ticker, message);
  } finally {
    clearTimeout(timeoutId);
  }
}
