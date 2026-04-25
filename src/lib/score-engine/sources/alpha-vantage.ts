import "server-only";

import {
  parseAlphaVantageDailyResponse,
  makeErrorResult,
  type AlphaVantageDailyBar,
  type AlphaVantageFetchResult,
  type AlphaVantageFetchStatus,
} from "./alpha-vantage-parse";
import { redactSecretsFromErrorMessage } from "./_redact";

/**
 * Alpha Vantage TIME_SERIES_DAILY fetcher for Phase 2 technical-layer
 * price ingest (blueprint §3.1, §3.2). One call = one ticker = one
 * chronological daily-bar series.
 *
 * Design choices (mirrors Phase 1 `fred.ts`):
 *
 * 1. **Never throws on upstream failure.** Network errors, non-200
 *    HTTP, malformed JSON, and the three Alpha Vantage "error-in-a-200"
 *    payloads (`Information`, `Note`, `Error Message`) all return a
 *    `AlphaVantageFetchResult` with `fetch_status: "error"`. The Step 7
 *    cron loops over tickers and must not let one bad ticker poison
 *    the run (blueprint §0.5 tenet 1: "silent success, loud failure"
 *    — we return a loud error object, we don't swallow it as null).
 *
 * 2. **Hard 15s timeout per call.** Alpha Vantage free tier is 25/day
 *    + 5/min, so the cron paces itself between tickers. Each individual
 *    call still deserves a wall-clock limit in case the upstream hangs.
 *
 * 3. **`cache: "no-store"`.** Next 16 Route Handlers don't cache fetch
 *    by default, but be explicit — the cron always wants fresh data.
 *
 * 4. **Pure parser extracted to `alpha-vantage-parse.ts`.** Keeps
 *    Vitest + scripts free of the `"server-only"` guard.
 *
 * 5. **`import "server-only"` guard.** ALPHA_VANTAGE_API_KEY must never
 *    leak to browser bundles.
 *
 * Rate-limit note for the cron implementer (Step 7): the free tier's
 * 5-req/minute ceiling means 22 tickers takes ≥5 minutes if serialized.
 * The cron should either (a) sleep 13s between requests, or (b) accept
 * that the run takes ~5min and schedule accordingly. On 429 or any of
 * the three rate-limit payloads detected by the parser, back off for
 * the remainder of the minute.
 */

export type {
  AlphaVantageDailyBar,
  AlphaVantageFetchStatus,
  AlphaVantageFetchResult,
};
export { parseAlphaVantageDailyResponse };

export interface FetchAlphaVantageDailyOptions {
  /**
   * `"full"` returns 20+ years of history; `"compact"` returns 100
   * most recent rows.
   *
   * Default is `"compact"`.
   *
   * Verified 2026-04-25: AV moved `outputsize=full` to premium tier;
   * `compact` (100 daily bars) is what the free `TIME_SERIES_DAILY`
   * endpoint returns. Calling with `outputsize=full` on the free key
   * returns an HTTP 200 with `{ "Information": "... premium feature ..." }`
   * — the parser routes that to `fetch_status: "error"` so the cron's
   * per-ticker loop logs and continues. With 100 bars, MA(200) is
   * unavailable — it falls through to null per blueprint §2.2 tenet 1
   * ("null-propagation"), and Disparity (which divides by MA200) does
   * the same.
   */
  outputSize?: "full" | "compact";
}

const ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query";
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch one Alpha Vantage daily-bar series and return a parsed,
 * scoring-ready result. Never throws on network/HTTP/upstream failure.
 * Throws only when `ALPHA_VANTAGE_API_KEY` is unset — a config error.
 */
export async function fetchAlphaVantageDaily(
  ticker: string,
  options: FetchAlphaVantageDailyOptions = {},
): Promise<AlphaVantageFetchResult> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ALPHA_VANTAGE_API_KEY is not set — add it to .env.local (dev) or Vercel env (prod)",
    );
  }

  const outputSize = options.outputSize ?? "compact";

  const url = new URL(ALPHA_VANTAGE_BASE_URL);
  url.searchParams.set("function", "TIME_SERIES_DAILY");
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("outputsize", outputSize);
  url.searchParams.set("apikey", apiKey);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      return makeErrorResult(
        ticker,
        `Alpha Vantage HTTP ${response.status} ${response.statusText}`,
      );
    }

    const body = (await response.json()) as unknown;
    return parseAlphaVantageDailyResponse(ticker, body);
  } catch (err) {
    // Scrub `?apikey=<key>` from the error message in case undici
    // embedded the request URL — see `_redact.ts` for rationale.
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `Alpha Vantage request timed out after ${FETCH_TIMEOUT_MS}ms`
        : err instanceof Error
          ? redactSecretsFromErrorMessage(err.message)
          : redactSecretsFromErrorMessage(String(err));
    return makeErrorResult(ticker, message);
  } finally {
    clearTimeout(timeoutId);
  }
}
