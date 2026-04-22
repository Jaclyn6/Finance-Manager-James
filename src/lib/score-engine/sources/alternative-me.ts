import "server-only";

import {
  parseAlternativeMeFngResponse,
  makeErrorResult,
  type CryptoFearGreedClassification,
  type CryptoFearGreedObservation,
  type CryptoFearGreedFetchStatus,
  type CryptoFearGreedResult,
} from "./alternative-me-parse";

/**
 * alternative.me Crypto Fear & Greed fetcher for the Phase 2 on-chain
 * composite layer (blueprint §3.1, §4.5). One call fetches the whole
 * history window in a single request — alternative.me supports a
 * `limit` query param and is generous with rate limits (~100/min).
 *
 * Design choices (mirrors Phase 1 `fred.ts` and Phase 2 `alpha-vantage.ts`):
 *
 * 1. **Never throws on upstream failure.** Network errors, non-200
 *    HTTP, malformed JSON — all return a `CryptoFearGreedResult` with
 *    `fetch_status: "error"`. The Step 7 cron's per-source loop must
 *    not let one bad source poison the others (blueprint §0.5 tenet 1:
 *    "silent success, loud failure").
 *
 * 2. **Hard 15s timeout per call.** alternative.me is usually fast but
 *    we still cap wall-clock time in case the upstream hangs. Worst-
 *    case total cron time stays bounded.
 *
 * 3. **`cache: "no-store"`.** Next 16 Route Handlers don't cache fetch
 *    by default, but be explicit — the cron always wants fresh data.
 *
 * 4. **No API key required.** alternative.me's Crypto F&G endpoint is
 *    public. We still keep the `"server-only"` guard so the fetcher
 *    symbol never gets tree-pulled into a client bundle, for parity
 *    with the keyed sources.
 *
 * 5. **NO back-off needed.** The endpoint is well-documented as
 *    generous (100/min+), stable, and used by many public dashboards.
 *    Plain `fetch` is fine — no exponential retry loop (contrast with
 *    CNN F&G which needs `fetchWithBackOff`).
 *
 * 6. **Distinct from CNN F&G.** Per blueprint §4.5, crypto F&G feeds
 *    the on-chain composite; CNN F&G drives the EXTREME_FEAR stock
 *    signal. They are NOT interchangeable.
 */

export type {
  CryptoFearGreedClassification,
  CryptoFearGreedObservation,
  CryptoFearGreedFetchStatus,
  CryptoFearGreedResult,
};
export { parseAlternativeMeFngResponse };

export interface FetchAlternativeMeFngOptions {
  /**
   * Number of most-recent days to request. Default 730 (~2 years) —
   * enough runway for Z-score / percentile windows in the on-chain
   * composite. Upstream accepts `limit=0` for full history; we prefer
   * an explicit bound to keep payloads small.
   */
  limit?: number;
}

const ALTERNATIVE_ME_BASE_URL = "https://api.alternative.me/fng/";
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch alternative.me's Crypto Fear & Greed Index and return a
 * parsed, chronological-ascending result. Never throws on network /
 * HTTP / upstream-shape failure.
 */
export async function fetchAlternativeMeFng(
  options: FetchAlternativeMeFngOptions = {},
): Promise<CryptoFearGreedResult> {
  const limit = options.limit ?? 730;

  const url = new URL(ALTERNATIVE_ME_BASE_URL);
  url.searchParams.set("limit", String(limit));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      return makeErrorResult(
        `alternative.me HTTP ${response.status} ${response.statusText}`,
      );
    }

    const body = (await response.json()) as unknown;
    return parseAlternativeMeFngResponse(body);
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `alternative.me request timed out after ${FETCH_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err);
    return makeErrorResult(message);
  } finally {
    clearTimeout(timeoutId);
  }
}
