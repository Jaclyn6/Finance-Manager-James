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
 * Bitbo on-chain-metric fetcher for Phase 2 on-chain category
 * (blueprint §3.1, §4.1). Covers two metrics — MVRV Z-Score and SOPR —
 * each on its own per-metric endpoint.
 *
 * **Unofficial API caveat.** Bitbo's JSON endpoints are NOT covered by
 * a public stability contract. URLs and response shapes are a defensive
 * best-effort based on observable behaviour at authoring time
 * (2026-04-23). Before Phase 2 Step 7 ships, the cron implementer MUST
 * hit the live endpoint, confirm the URL + body shape match the
 * assumptions in this file + `bitbo-parse.ts`, and update both + the
 * tests if anything differs. Do NOT paper over a mismatch inside the
 * fetcher — the parser is the single source of truth for shape.
 *
 * Design choices (mirrors Phase 1 `fred.ts` with the Phase 2 back-off
 * addition from blueprint §3.1):
 *
 * 1. **Never throws on upstream failure.** Network errors, non-200 HTTP
 *    (after retries are exhausted), malformed JSON, and unexpected
 *    shapes all return a `BitboFetchResult` with `fetch_status: "error"`.
 *    The Step 7 cron loops over metrics and must not let one bad metric
 *    poison the run (blueprint §0.5 tenet 1: "silent success, loud
 *    failure" — we return a loud error object, never swallow).
 *
 * 2. **Hard 15s timeout per ATTEMPT.** With `fetchWithBackOff`'s default
 *    of 2 retries, worst-case wall time is 3 × 15s = 45s plus ~3.5s of
 *    back-off sleep. Still well under Vercel Fluid Compute's 300s cap,
 *    and the cron only hits 2 metrics in parallel.
 *
 * 3. **Back-off on 429/5xx.** Bitbo is unofficial and may flap under
 *    load. One or two retries materially lift the success rate; the
 *    `fetchWithBackOff` helper handles the retry loop, fresh
 *    AbortController per attempt, and exponential delay.
 *
 * 4. **`cache: "no-store"`.** Cron always wants fresh data.
 *
 * 5. **No API key required.** Unlike FRED / Alpha Vantage / Finnhub,
 *    Bitbo is key-free — so there is no config-error path that would
 *    justify a throw. Fetcher never throws.
 *
 * 6. **Pure parser extracted to `bitbo-parse.ts`.** Vitest + scripts
 *    import the parser without tripping the `"server-only"` guard.
 */

export type {
  BitboMetric,
  BitboObservation,
  BitboFetchStatus,
  BitboFetchResult,
};
export { parseBitboResponse };

// Base URL. The exact per-metric path is appended in `endpointFor`.
const BITBO_BASE_URL = "https://bitbo.io/metrics";
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Map a metric id to its unofficial JSON endpoint. **Verify these paths
 * against the live Bitbo dashboard at Step 7** — if the real API paths
 * use different slugs or a `.json` suffix is not required, update here.
 */
function endpointFor(metric: BitboMetric): string {
  switch (metric) {
    case "mvrv-z-score":
      return `${BITBO_BASE_URL}/mvrv-z-score.json`;
    case "sopr":
      return `${BITBO_BASE_URL}/sopr.json`;
  }
}

/**
 * Fetch one Bitbo on-chain metric and return a parsed, scoring-ready
 * result. Never throws on network/HTTP/upstream failure.
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
        headers: { Accept: "application/json" },
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
