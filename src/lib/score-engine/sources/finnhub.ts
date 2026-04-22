import "server-only";

import {
  parseFinnhubSentimentResponse,
  makeErrorResult,
  type FinnhubSentimentResult,
  type FinnhubFetchStatus,
} from "./finnhub-parse";
import { redactSecretsFromErrorMessage } from "./_redact";

/**
 * Finnhub news-sentiment fetcher for Phase 2 sentiment-layer ingest
 * (blueprint §3.1, §4.4). One call = one ticker = one weekly sentiment
 * snapshot.
 *
 * Design choices (mirrors Phase 1 `fred.ts`):
 *
 * 1. **Never throws on upstream failure.** Network errors, non-200
 *    HTTP, malformed JSON, and Finnhub's `{ error: "..." }` payloads
 *    all return a result with `fetch_status: "error"`. The Step 7
 *    cron loops over tickers and must not let one bad ticker poison
 *    the run (blueprint §0.5 tenet 1).
 *
 * 2. **Hard 15s timeout per call.** Finnhub free tier is 60/min, so
 *    22 tickers fits within a single minute comfortably. Individual
 *    calls still deserve a wall-clock limit in case the upstream hangs.
 *
 * 3. **`cache: "no-store"`.** Explicit — cron always wants fresh data.
 *
 * 4. **Pure parser extracted to `finnhub-parse.ts`.** Keeps Vitest +
 *    scripts free of the `"server-only"` guard.
 *
 * 5. **`import "server-only"` guard.** FINNHUB_API_KEY must never leak
 *    to browser bundles.
 *
 * 6. **Raw fields only.** The `score_0_100` column on `news_sentiment`
 *    is populated by the Step 5 sentiment module, not here — this
 *    fetcher's contract is "give me the raw Finnhub fields, unmodified".
 *    See `finnhub-parse.ts` header for rationale.
 *
 * Note for the Step 7 cron implementer: FINNHUB_API_KEY is NEW — it is
 * not yet set in Vercel/local env at Step 2. The env-missing path
 * throws (config error, not transient), so Step 7 must confirm the key
 * is set in .env.local + Vercel envs before enabling the sentiment
 * portion of the cron.
 */

export type { FinnhubFetchStatus, FinnhubSentimentResult };
export { parseFinnhubSentimentResponse };

const FINNHUB_BASE_URL = "https://finnhub.io/api/v1/news-sentiment";
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch one Finnhub news-sentiment snapshot for a ticker and return
 * a parsed result. Never throws on network/HTTP/upstream failure.
 * Throws only when `FINNHUB_API_KEY` is unset — a config error.
 */
export async function fetchFinnhubSentiment(
  ticker: string,
): Promise<FinnhubSentimentResult> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    throw new Error(
      "FINNHUB_API_KEY is not set — add it to .env.local (dev) or Vercel env (prod)",
    );
  }

  const url = new URL(FINNHUB_BASE_URL);
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("token", apiKey);

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
        `Finnhub HTTP ${response.status} ${response.statusText}`,
      );
    }

    const body = (await response.json()) as unknown;
    return parseFinnhubSentimentResponse(ticker, body);
  } catch (err) {
    // Scrub `?token=<key>` from the error message in case undici
    // embedded the request URL — see `_redact.ts` for rationale.
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `Finnhub request timed out after ${FETCH_TIMEOUT_MS}ms`
        : err instanceof Error
          ? redactSecretsFromErrorMessage(err.message)
          : redactSecretsFromErrorMessage(String(err));
    return makeErrorResult(ticker, message);
  } finally {
    clearTimeout(timeoutId);
  }
}
