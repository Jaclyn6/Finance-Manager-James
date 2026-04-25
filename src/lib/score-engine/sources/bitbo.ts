import "server-only";

import { fetchWithBackOff } from "./_back-off";
import {
  parseBitboResponse,
  makeErrorResult,
  type BitboFetchResult,
  type BitboFetchStatus,
  type BitboMetric,
  type BitboObservation,
} from "./bitbo-parse";

/**
 * On-chain-metric fetcher for Phase 2 on-chain category (blueprint
 * §3.1, §4.1). Covers two metrics — MVRV Z-Score and SOPR — each on
 * its own per-metric endpoint.
 *
 * **Source URL.** Originally targeted `https://bitbo.io/metrics/...json`,
 * which 404'd in 2026. The interactive Bitbo charts moved behind a
 * paid `api_key` tier. To keep the family hobby tool key-free, the
 * fetcher was repointed at **bitcoin-data.com** (BGeometrics):
 *
 *   - MVRV Z-Score: GET `https://api.bitcoin-data.com/v1/mvrv-zscore`
 *   - SOPR:         GET `https://api.bitcoin-data.com/v1/sopr`
 *
 * Verified working 2026-04-25. Returns top-level JSON array of
 * `{d: "YYYY-MM-DD", unixTs: number, mvrvZscore|sopr: number}`.
 *
 * The exported types/functions still carry the "Bitbo*" name for
 * blast-radius reasons — the consumer route + tests import these
 * symbols and renaming would be a much larger diff than the source
 * URL swap warrants.
 *
 * **Unofficial API caveat.** bitcoin-data.com's public REST endpoints
 * are not covered by a versioned stability contract. URL and response
 * shape are a best-effort based on observable behaviour. The parser
 * (`bitbo-parse.ts`) accepts both the new `[{d, unixTs, mvrvZscore}]`
 * shape and the legacy `{data: [{date, value}]}` wrapper. A future
 * ENVELOPE rename (array → object, /last shape) is handled by branching
 * at parseEntries. A KEY rename within an entry (e.g. `mvrvZscore` →
 * `mvrv_z`) is NOT covered by the fallback — it would surface as
 * `fetch_status: "partial"` with zero observations, triggering the
 * staleness gate; manual parser update would be required at that point.
 *
 * Design choices (mirrors Phase 1 `fred.ts` with the Phase 2 back-off
 * addition from blueprint §3.1):
 *
 * 1. **Never throws on upstream failure.** Network errors, non-200 HTTP
 *    (after retries), malformed JSON, and unexpected shapes all return
 *    a `BitboFetchResult` with `fetch_status: "error"`. The Step 7
 *    cron loops over metrics and must not let one bad metric poison
 *    the run (blueprint §0.5 tenet 1).
 *
 * 2. **Hard 15s timeout per ATTEMPT.** With `fetchWithBackOff`'s default
 *    of 2 retries, worst-case wall time is 3 × 15s = 45s plus ~3.5s of
 *    back-off sleep. Well under Vercel Fluid Compute's 300s cap.
 *
 * 3. **Back-off on 429/5xx.** Free public APIs flap under load. One
 *    or two retries materially lifts success rate.
 *
 * 4. **`cache: "no-store"`.** Cron always wants fresh data.
 *
 * 5. **No API key required.** bitcoin-data.com's full-history endpoints
 *    are publicly readable without auth (the registered tier exists
 *    for higher rate limits, not unlock). No env var needed.
 *
 * 6. **Generic User-Agent.** Some CDNs filter requests with no UA or
 *    a default-fetch UA. Send a sane string so we don't get edge-dropped.
 *
 * 7. **Pure parser extracted to `bitbo-parse.ts`.** Vitest + scripts
 *    import the parser without tripping the `"server-only"` guard.
 */

export type {
  BitboMetric,
  BitboObservation,
  BitboFetchStatus,
  BitboFetchResult,
};
export { parseBitboResponse };

// bitcoin-data.com (BGeometrics) public REST API. Verified 2026-04-25.
// The full-history endpoint returns a JSON array spanning several years;
// the `/last` variant returns a single object. We use the full series so
// the cron can hydrate per-day rows for backfill if upstream goes flaky.
const BITCOIN_DATA_BASE_URL = "https://api.bitcoin-data.com/v1";
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = "Mozilla/5.0 (finance-manager)";

/**
 * Map a metric id to its bitcoin-data.com endpoint path. Note: the
 * upstream uses "mvrv-zscore" (no hyphen between Z and Score) while
 * our internal id uses "mvrv-z-score" — keep that translation here.
 */
function endpointFor(metric: BitboMetric): string {
  switch (metric) {
    case "mvrv-z-score":
      return `${BITCOIN_DATA_BASE_URL}/mvrv-zscore`;
    case "sopr":
      return `${BITCOIN_DATA_BASE_URL}/sopr`;
  }
}

/**
 * Fetch one on-chain metric and return a parsed, scoring-ready result.
 * Never throws on network/HTTP/upstream failure.
 *
 * Uses `fetchWithBackOff` for 429/5xx retries per blueprint §3.1
 * "unofficial; back-off" policy.
 */
export async function fetchBitboMetric(
  metric: BitboMetric,
): Promise<BitboFetchResult> {
  const url = endpointFor(metric);

  try {
    const response = await fetchWithBackOff(
      url,
      {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
      },
      { timeoutMs: FETCH_TIMEOUT_MS },
    );

    if (!response.ok) {
      return makeErrorResult(
        metric,
        `Bitbo HTTP ${response.status} ${response.statusText}`,
      );
    }

    const body = (await response.json()) as unknown;
    return parseBitboResponse(metric, body);
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `Bitbo request timed out after ${FETCH_TIMEOUT_MS}ms per attempt`
        : err instanceof Error
          ? err.message
          : String(err);
    return makeErrorResult(metric, message);
  }
}
