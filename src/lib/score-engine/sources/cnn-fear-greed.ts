import "server-only";

import { fetchWithBackOff } from "./_back-off";
import {
  parseCnnFearGreedResponse,
  makeErrorResult,
  type CnnFearGreedObservation,
  type CnnFearGreedRating,
  type CnnFearGreedFetchStatus,
  type CnnFearGreedResult,
} from "./cnn-fear-greed-parse";

/**
 * CNN Markets Data Fear & Greed (stock) fetcher for the Phase 2
 * EXTREME_FEAR signal (blueprint §4.5 / §3.1). One call returns both
 * the latest reading and a multi-year historical time series.
 *
 * UNOFFICIAL endpoint: response shape is as of 2026-04-23. CNN has
 * historically changed this endpoint without notice. If live responses
 * stop parsing, inspect the raw body and adjust
 * `cnn-fear-greed-parse.ts` accordingly. The blueprint's EXTREME_FEAR
 * signal depends on CNN F&G being available; total outage requires
 * falling back to VIX-only per the `VIX >= 35 || CNN_FG < 25` OR
 * semantics — see blueprint §4.5.
 *
 * Design choices (mirrors the other Phase 2 source fetchers):
 *
 * 1. **Never throws on upstream failure.** Network errors, non-200
 *    HTTP, malformed JSON — all return a `CnnFearGreedResult` with
 *    `fetch_status: "error"`. The Step 7 cron's per-source loop must
 *    not let one bad source poison the others (blueprint §0.5 tenet 1:
 *    "silent success, loud failure").
 *
 * 2. **Back-off via `fetchWithBackOff`** (shared helper in
 *    `./_back-off.ts`). CNN's dataviz endpoint has no published rate
 *    limit and can flap under load; one retry on 429/5xx lifts the
 *    success rate of each cron cycle without courting retry storms.
 *    FRED / Alpha Vantage / Finnhub don't use back-off because they
 *    have documented contracts and the cron paces at schedule time.
 *
 * 3. **Generic `User-Agent` header.** CNN's edge has been observed
 *    to filter null / `node-fetch` user-agents. We send a generic
 *    browser UA with our app tag appended — the family hobby tool
 *    isn't trying to spoof anything, but it does need to avoid being
 *    dropped at the edge. Adjust the UA if CNN ever starts blocking.
 *
 * 4. **`cache: "no-store"`.** Next 16 Route Handlers don't cache
 *    fetch by default, but be explicit — the cron always wants
 *    fresh data.
 *
 * 5. **Pure parser extracted to `cnn-fear-greed-parse.ts`.** Keeps
 *    Vitest + scripts free of the `"server-only"` guard and the
 *    back-off runtime dependency.
 *
 * 6. **Distinct from alternative.me Crypto F&G.** Per blueprint §4.5,
 *    CNN F&G drives the EXTREME_FEAR stock signal; crypto F&G feeds
 *    the on-chain composite. They are NOT interchangeable.
 */

export type {
  CnnFearGreedObservation,
  CnnFearGreedRating,
  CnnFearGreedFetchStatus,
  CnnFearGreedResult,
};
export { parseCnnFearGreedResponse };

const CNN_FNG_URL =
  "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
const USER_AGENT = "Mozilla/5.0 (finance-manager)";

/**
 * Fetch CNN Markets Data Fear & Greed and return a parsed result.
 * Never throws on network / HTTP / shape failure — folds everything
 * into `CnnFearGreedResult.fetch_status`.
 */
export async function fetchCnnFearGreed(): Promise<CnnFearGreedResult> {
  try {
    const response = await fetchWithBackOff(CNN_FNG_URL, {
      headers: {
        // CNN's edge has been observed to filter requests without a
        // sane User-Agent. See JSDoc above.
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return makeErrorResult(
        `CNN F&G HTTP ${response.status} ${response.statusText}`,
      );
    }

    const body = (await response.json()) as unknown;
    return parseCnnFearGreedResponse(body);
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "CNN F&G request timed out"
        : err instanceof Error
          ? err.message
          : String(err);
    return makeErrorResult(message);
  }
}
