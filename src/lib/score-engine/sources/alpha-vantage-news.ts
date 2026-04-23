import "server-only";

import { redactSecretsFromErrorMessage } from "./_redact";
import {
  parseAlphaVantageNewsResponse,
  makeAvNewsError,
  type AlphaVantageNewsResult,
  type AlphaVantageFeedItem,
  type AlphaVantageTickerSentiment,
  type AlphaVantageTickerAggregate,
} from "./alpha-vantage-news-parse";

/**
 * Alpha Vantage NEWS_SENTIMENT fetcher for Phase 2 sentiment-layer
 * ingest (blueprint §3.1, §4.4 — Phase C Step 7).
 *
 * Why this module exists: Finnhub's `/news-sentiment` endpoint is paid-
 * only (the production smoke test against the free tier returned
 * `{"error":"You don't have access to this resource."}`). Alpha
 * Vantage's `NEWS_SENTIMENT` function IS free-tier accessible and
 * returns per-ticker + per-article sentiment scores with higher
 * coverage (observed 20-50 articles per 3-4 ticker call), so the
 * sentiment pipeline now goes through AV. The existing
 * `ALPHA_VANTAGE_API_KEY` is reused — no new env provisioning.
 *
 * Design choices (mirrors `alpha-vantage.ts` / `finnhub.ts`):
 *
 * 1. **Never throws on upstream failure.** Network errors, non-200
 *    HTTP, malformed JSON, and AV's 200-OK error payloads (`Information`,
 *    `Note`, `Error Message`) all return a result with `fetch_status:
 *    "error"`. The Step 7 cron loops over ticker groups and must not
 *    let one bad group poison the run (blueprint §0.5 tenet 1).
 *
 * 2. **Hard 15s timeout per call.** AV free tier is 5/min + 25/day —
 *    two news calls fit comfortably with the technical pipeline's 19.
 *    Individual calls still deserve a wall-clock limit in case the
 *    upstream hangs.
 *
 * 3. **`cache: "no-store"`.** Cron always wants fresh data.
 *
 * 4. **Pure parser + aggregator extracted to `alpha-vantage-news-parse.ts`.**
 *    Keeps Vitest + backfill scripts free of the `"server-only"` guard.
 *    The per-ticker weighted-mean aggregation lives there too so
 *    historical raw payloads can be re-aggregated without re-fetching.
 *
 * 5. **`import "server-only"` guard.** ALPHA_VANTAGE_API_KEY must never
 *    leak to browser bundles.
 *
 * Observed AV NEWS_SENTIMENT constraints (from live probing 2026-04-23):
 *
 *   - `tickers=A,B,C,D&limit=50` → 50 items returned cleanly.
 *   - `tickers=A,B,C,D,E,F,G&limit=50` → 0 items (hidden ticker cap).
 *   - `topics=financial_markets&limit=200` w/o ticker filter → 50
 *     items hard cap, only 5/7 tickers covered in aggregate.
 *
 * → The Step 7 cron issues TWO calls that cover 7 tickers in groups
 * of 4+3. Budget impact: 19 technical + 2 news = 21/25 daily AV calls,
 * leaving 4 headroom for retries.
 */

export type {
  AlphaVantageNewsResult,
  AlphaVantageFeedItem,
  AlphaVantageTickerSentiment,
  AlphaVantageTickerAggregate,
};
export { parseAlphaVantageNewsResponse, makeAvNewsError };

const AV_BASE_URL = "https://www.alphavantage.co/query";
const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_LIMIT = 50;

export interface FetchAvNewsOptions {
  /**
   * Max articles returned. Defaults to 50 — the observed free-tier
   * cap for a multi-ticker call. Lower values save bandwidth but don't
   * reduce the AV quota charge (one call = one call regardless of
   * `limit`).
   */
  limit?: number;
}

/**
 * Fetch Alpha Vantage NEWS_SENTIMENT for a group of tickers and return
 * a parsed, scoring-ready result. Never throws on network / HTTP /
 * upstream failure — all failure modes collapse to a well-formed
 * error result so the cron loop stays un-poisonable.
 *
 * Throws ONLY when `ALPHA_VANTAGE_API_KEY` is unset — that's a config
 * error, not a transient failure, and the route handler detects it up
 * front via the dedicated graceful-missing-key path so the hourly
 * workflow's sibling steps (onchain + cnn-fg) still run.
 */
export async function fetchAlphaVantageNews(
  tickers: readonly string[],
  options: FetchAvNewsOptions = {},
): Promise<AlphaVantageNewsResult> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ALPHA_VANTAGE_API_KEY is not set — add it to .env.local (dev) or Vercel env (prod)",
    );
  }
  if (tickers.length === 0) {
    return makeAvNewsError([], "tickers list is empty");
  }

  const url = new URL(AV_BASE_URL);
  url.searchParams.set("function", "NEWS_SENTIMENT");
  url.searchParams.set("tickers", tickers.join(","));
  url.searchParams.set("limit", String(options.limit ?? DEFAULT_LIMIT));
  url.searchParams.set("apikey", apiKey);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      return makeAvNewsError(
        tickers,
        `Alpha Vantage news HTTP ${response.status} ${response.statusText}`,
      );
    }
    const body = (await response.json()) as unknown;
    return parseAlphaVantageNewsResponse(tickers, body);
  } catch (err) {
    // Scrub `?apikey=<key>` from the error message in case undici
    // embedded the request URL — see `_redact.ts` for rationale.
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `Alpha Vantage news request timed out after ${FETCH_TIMEOUT_MS}ms`
        : err instanceof Error
          ? redactSecretsFromErrorMessage(err.message)
          : redactSecretsFromErrorMessage(String(err));
    return makeAvNewsError(tickers, message);
  } finally {
    clearTimeout(timeoutId);
  }
}
