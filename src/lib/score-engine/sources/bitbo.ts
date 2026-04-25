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
 * **Hard rate-limit gating (re-verified 2026-04-25).** BGeometrics'
 * free tier is 8 requests/hour/IP and returns
 * `{"code":"RATE_LIMIT_HOUR_EXCEEDED"}` once exhausted. The hourly cron
 * fires both metrics in parallel (2 calls/hour worst-case from a single
 * Vercel region) so the budget itself is fine — but Vercel Fluid
 * Compute can route between regional pops, and a previously-failed
 * cycle's retry can stack on top of the next cycle's calls. Mitigation:
 *
 *   1. Pass `retryOnRateLimit: false` to `fetchWithBackOff` — a 429
 *      inside an hourly window CAN'T succeed within back-off seconds,
 *      so retrying just guarantees the same 429 + drains slots faster.
 *      Network errors and 5xx still retry normally.
 *   2. The 429 propagates to the caller as a non-ok Response → the
 *      outer try/catch builds a `fetch_status:'error'` result → the
 *      ingest-onchain route writes a null score row + skips cache
 *      revalidation when zero metrics succeed → Phase 2 staleness gate
 *      surfaces the gap on the dashboard. No silent zeros, no signal
 *      mis-fires (tenet 1, blueprint §0.5).
 *
 * **Migration evaluation (2026-04-25).** A pivot to lookintobitcoin.com
 * was investigated as part of this recovery and ruled out:
 *
 *   - `lookintobitcoin.com/charts/mvrv-zscore/` 301 → `bitcoinmagazinepro.com/charts/mvrv-zscore/`
 *     which renders via Plotly Dash (data loaded by post-render XHR
 *     callback against `_dash-update-component`). Static HTML scrape
 *     yields a SPA shell with no embedded series — not viable without
 *     headless-browser execution which is out of scope for a Vercel
 *     Fluid Compute cron.
 *   - `lookintobitcoin.com/charts/sopr/` 301 → bitcoinmagazinepro 404.
 *     The SOPR page no longer exists at the redirect target.
 *   - Coin Metrics community API (`community-api.coinmetrics.io/v4`) DOES
 *     publish `CapMVRVCur` (raw MVRV ratio) without auth, but `CapMVRVZ`
 *     and `SOPR` return 403 "not available with supplied credentials"
 *     on the community tier. Raw MVRV uses a different threshold
 *     (~1.0 ≤ undervalued) than MVRV-Z (≤0 ≤ undervalued) so swapping
 *     in MVRV would silently corrupt the CRYPTO_UNDERVALUED signal.
 *   - CBBI (`colintalkscrypto.com/cbbi/data/latest.json`) provides MVRV
 *     normalized to a 0–1 confidence band, not raw Z-score. Same
 *     threshold-mismatch hazard. No SOPR.
 *   - Glassnode requires a paid API key.
 *
 * Recovery decision: **stay on BGeometrics with 429 fail-fast**. The
 * cron tolerates partial outages by design; on 429 the dashboard shows
 * a staleness badge for MVRV_Z / SOPR while the other on-chain inputs
 * (CRYPTO_FG, BTC_ETF_NETFLOW) keep flowing. If 429 frequency proves
 * unworkable in production, the next viable fallbacks (orchestrator
 * decision, requires user buy-in):
 *
 *   - Phase 3 Glassnode paid tier ($29/mo studio plan covers MVRV-Z + SOPR).
 *   - Drop both signals; rely on CRYPTO_FG + ETF flow alone for the
 *     on-chain composite.
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
 * 3. **Back-off on 5xx; fail-fast on 429.** Free public APIs flap
 *    under load and 5xx retries materially lift success rate. 429,
 *    however, is a HARD per-hour quota on BGeometrics — retrying inside
 *    the window guarantees the same 429 and burns more slots, so we
 *    pass `retryOnRateLimit:false` and surface the rate-limit hit as
 *    `fetch_status:'error'` immediately.
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
      {
        timeoutMs: FETCH_TIMEOUT_MS,
        // Hard 8/hr quota — see file-header "Hard rate-limit gating".
        retryOnRateLimit: false,
      },
    );

    if (!response.ok) {
      // Tag 429 explicitly so the audit row makes it obvious why this
      // metric was skipped. Other non-ok statuses keep the generic
      // "Bitbo HTTP …" prefix for searchability.
      const detail =
        response.status === 429
          ? "Bitbo HTTP 429 rate limit (BGeometrics 8/hr quota exhausted)"
          : `Bitbo HTTP ${response.status} ${response.statusText}`;
      return makeErrorResult(metric, detail);
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
