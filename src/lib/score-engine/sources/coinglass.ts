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
 * BTC Spot ETF flow fetcher for Phase 2 on-chain category (blueprint
 * §3.1, §4.1). Feeds the on-chain composite — NOT a signal boolean
 * per §4.5.
 *
 * **Source URL.** Originally targeted CoinGlass's public-tier JSON
 * endpoint at `https://open-api.coinglass.com/public/v2/indicator/
 * bitcoin_etf_flow`. That endpoint started 500-ing in 2026 and
 * CoinGlass v4 now requires a paid `coinglassSecret` API key. To keep
 * the family hobby tool key-free, the fetcher was repointed at:
 *
 *   GET `https://bitbo.io/treasuries/etf-flows/`
 *
 * which renders a public HTML table of daily per-ETF + total net flows
 * (millions USD). Verified working 2026-04-25. The pure parser
 * (`coinglass-parse.ts`) handles the HTML → observations conversion.
 *
 * Selector: regex-based row scan; pulls `<tr>` blocks, filters to rows
 * whose first cell matches "Mon DD, YYYY", and reads the last numeric
 * cell as the Totals column. Robust to column-count drift if Bitbo
 * adds a new ETF ticker.
 *
 * The exported types ("CoinGlass*") are kept for blast-radius reasons —
 * the consumer route + downstream tests import these symbols. The
 * semantics — fetch BTC Spot ETF daily net flow from a key-free public
 * source — are unchanged.
 *
 * **Unofficial caveat.** Bitbo's HTML structure can change without
 * notice. If the parser starts dropping all rows, inspect the live
 * page and adjust the row/cell regex in `coinglass-parse.ts`. A
 * wholesale table redesign would push us toward Phase 3 Glassnode
 * migration.
 *
 * Design choices (mirrors the other Phase 2 source fetchers):
 *
 * 1. **Never throws on upstream failure.** Network errors, non-200
 *    HTTP (after retries), malformed HTML, and unexpected shapes all
 *    return a `CoinGlassEtfFlowResult` with `fetch_status: "error"`
 *    (blueprint §0.5 tenet 1: "silent success, loud failure").
 *
 * 2. **Hard 15s timeout per ATTEMPT.** With `fetchWithBackOff`'s
 *    default of 2 retries, worst-case wall time is 3 × 15s = 45s plus
 *    ~3.5s of back-off sleep — inside Vercel Fluid Compute's 300s cap.
 *
 * 3. **Back-off on 429/5xx.** Bitbo's CDN can flap under load.
 *    `fetchWithBackOff` handles the retry loop, fresh AbortController
 *    per attempt, and exponential delay.
 *
 * 4. **`cache: "no-store"`.** Always hit upstream during cron.
 *
 * 5. **No API key required.**
 *
 * 6. **Generic User-Agent.** Bitbo's CDN can drop requests with no UA
 *    or a default-fetch UA. Send a sane string so we don't get
 *    edge-dropped — same approach as cnn-fear-greed.ts.
 *
 * 7. **`Accept: text/html`.** We're scraping HTML now, not JSON.
 *
 * 8. **Pure parser extracted to `coinglass-parse.ts`.** Vitest +
 *    scripts import the parser without tripping the `"server-only"`
 *    guard. The parser accepts both HTML strings (current) and the
 *    legacy `{code, data: [...]}` JSON shape (regression coverage +
 *    future-proof if we ever swap back to a JSON source).
 */

export type {
  CoinGlassEtfFlowObservation,
  CoinGlassEtfFlowResult,
  CoinGlassFetchStatus,
};
export { parseCoinGlassEtfFlowResponse };

const ETF_FLOW_URL = "https://bitbo.io/treasuries/etf-flows/";
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = "Mozilla/5.0 (finance-manager)";

/**
 * Fetch BTC Spot ETF daily net flow and return a parsed, scoring-ready
 * result. Never throws on network/HTTP/upstream failure.
 *
 * Uses `fetchWithBackOff` for 429/5xx retries per blueprint §3.1
 * "unofficial; back-off" policy.
 */
export async function fetchCoinGlassEtfFlow(): Promise<CoinGlassEtfFlowResult> {
  try {
    const response = await fetchWithBackOff(
      ETF_FLOW_URL,
      {
        method: "GET",
        cache: "no-store",
        headers: {
          // Bitbo's CDN has been observed to drop requests without a
          // sane User-Agent. See JSDoc above.
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
        },
      },
      { timeoutMs: FETCH_TIMEOUT_MS },
    );

    if (!response.ok) {
      return makeErrorResult(
        `CoinGlass HTTP ${response.status} ${response.statusText}`,
      );
    }

    const body = await response.text();
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
