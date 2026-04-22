import "server-only";

import { fetchWithBackOff } from "./_back-off";
import {
  parseCoinGlassEtfFlowResponse,
  makeErrorResult,
  type CoinGlassEtfFlowObservation,
  type CoinGlassEtfFlowResult,
  type CoinGlassFetchStatus,
} from "./coinglass-parse";

/**
 * CoinGlass BTC Spot ETF flow fetcher for Phase 2 on-chain category
 * (blueprint §3.1, §4.1). Feeds the on-chain composite — NOT a signal
 * boolean per §4.5; the signal boolean for on-chain is
 * `CRYPTO_UNDERVALUED` / `CAPITULATION` (driven by Bitbo MVRV/SOPR).
 *
 * **Unofficial API caveat.** CoinGlass's public indicator endpoints are
 * NOT covered by a stability contract. URL and response shape are a
 * defensive best-effort based on observable behaviour at authoring time
 * (2026-04-23). Before Phase 2 Step 7 ships, the cron implementer MUST
 * hit the live endpoint, confirm the URL + body shape match the
 * assumptions in this file + `coinglass-parse.ts`, and update both +
 * the tests if anything differs. Do NOT paper over a mismatch inside
 * the fetcher — the parser is the single source of truth for shape.
 *
 * Design choices (mirrors Phase 1 `fred.ts` with the Phase 2 back-off
 * addition from blueprint §3.1):
 *
 * 1. **Never throws on upstream failure.** Network errors, non-200 HTTP
 *    (after retries), malformed JSON, CoinGlass non-success `code`
 *    fields, and unexpected shapes all return a `CoinGlassEtfFlowResult`
 *    with `fetch_status: "error"` (blueprint §0.5 tenet 1: "silent
 *    success, loud failure" — we return a loud error object, never
 *    swallow).
 *
 * 2. **Hard 15s timeout per ATTEMPT.** With `fetchWithBackOff`'s default
 *    of 2 retries, worst-case wall time is 3 × 15s = 45s plus ~3.5s of
 *    back-off sleep — inside Vercel Fluid Compute's 300s cap.
 *
 * 3. **Back-off on 429/5xx.** CoinGlass is unofficial and may flap
 *    under load. `fetchWithBackOff` handles the retry loop, fresh
 *    AbortController per attempt, and exponential delay.
 *
 * 4. **`cache: "no-store"`.** Always hit upstream during cron.
 *
 * 5. **No API key required** at the free/indicator tier — so there is
 *    no config-error path that would justify a throw. Fetcher never
 *    throws.
 *
 * 6. **Pure parser extracted to `coinglass-parse.ts`.** Vitest + scripts
 *    import the parser without tripping the `"server-only"` guard.
 */

export type {
  CoinGlassEtfFlowObservation,
  CoinGlassEtfFlowResult,
  CoinGlassFetchStatus,
};
export { parseCoinGlassEtfFlowResponse };

const COINGLASS_ETF_FLOW_URL =
  "https://open-api.coinglass.com/public/v2/indicator/bitcoin_etf_flow";
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch BTC Spot ETF daily net flow from CoinGlass and return a parsed,
 * scoring-ready result. Never throws on network/HTTP/upstream failure.
 *
 * Uses `fetchWithBackOff` for 429/5xx retries per blueprint §3.1
 * "unofficial; back-off" policy.
 */
export async function fetchCoinGlassEtfFlow(): Promise<CoinGlassEtfFlowResult> {
  try {
    const response = await fetchWithBackOff(
      COINGLASS_ETF_FLOW_URL,
      {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      },
      { timeoutMs: FETCH_TIMEOUT_MS },
    );

    if (!response.ok) {
      return makeErrorResult(
        `CoinGlass HTTP ${response.status} ${response.statusText}`,
      );
    }

    const body = (await response.json()) as unknown;
    return parseCoinGlassEtfFlowResponse(body);
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `CoinGlass request timed out after ${FETCH_TIMEOUT_MS}ms per attempt`
        : err instanceof Error
          ? err.message
          : String(err);
    return makeErrorResult(message);
  }
}
