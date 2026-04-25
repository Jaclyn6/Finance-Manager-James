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
 * **Source URL (re-verified 2026-04-25).** Originally CoinGlass v2
 * public, then bitbo.io/treasuries/etf-flows/. Both broke:
 *
 *   - CoinGlass v4 — paid `coinglassSecret` key required.
 *   - bitbo.io — returns 200 OK to local curl with a Chrome UA but
 *     consistently 500s from Vercel Fluid Compute IPs. We tested every
 *     header permutation (full Chrome UA + Accept + Accept-Language +
 *     Referer: https://bitbo.io/) — Bitbo's CDN appears to maintain an
 *     IP/ASN block on Vercel ranges, not a UA filter, so header tuning
 *     can't recover the source.
 *
 * The fetcher is now repointed at **farside.co.uk** — the canonical
 * upstream that both Bitbo and CoinGlass aggregate from:
 *
 *   GET `https://farside.co.uk/btc/`
 *
 * Farside renders a server-side HTML table of daily per-ETF + Total net
 * flows (millions USD), updated every U.S. trading session. The page
 * predates and outlives the broken aggregators; it's been online with
 * the same general layout since the spot-ETF launch in Jan 2024.
 * Verified working from local 2026-04-25 (200 OK, ~87KB, hundreds of
 * data rows). The pure parser (`coinglass-parse.ts`) handles the
 * HTML → observations conversion.
 *
 * Why not bitbo.io with header-tuning: tested. The block is IP-based.
 * Why not farside.co.uk/btc-etf-flow-all/: 404; that path doesn't
 *   exist. The flow table lives at /btc/ directly.
 * Why not CoinGlass v4: paid key, blueprint §0.6 "key-free Phase 2".
 *
 * **Farside HTML shape highlights** (full details in coinglass-parse.ts):
 *   - Date format: `DD Mon YYYY` ("06 Apr 2026"), British convention.
 *   - Negative values: `<span class="redFont">(17.1)</span>` — accountancy
 *     parentheses, not minus sign. Parser must convert (X) → -X.
 *   - Total: rightmost cell of each data row. Multi-row thead (icon,
 *     ticker symbol, fee), so the first 3 `<tr>` blocks are headers
 *     and skipped naturally by the date-prefix filter.
 *
 * The exported types ("CoinGlass*") are kept for blast-radius reasons —
 * the consumer route + downstream tests import these symbols. The
 * semantics — fetch BTC Spot ETF daily net flow from a key-free public
 * source — are unchanged.
 *
 * **Unofficial caveat.** Farside's HTML is hand-styled (inline `<div>`
 * + `<span class="tabletext">` tags — no semantic table classes), which
 * is good news for stability: a redesign would be a UX project for
 * them, not a routine deploy. If the parser starts dropping all rows
 * after a future Farside refresh, the next move is Glassnode paid tier
 * (Phase 3 escalation per blueprint §3.2).
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
 * 3. **Back-off on 429/5xx.** Farside is a small UK-hosted page that
 *    can flap under load (Cloudflare in front). `fetchWithBackOff`
 *    handles the retry loop, fresh AbortController per attempt, and
 *    exponential delay. Default `retryOnRateLimit:true` is fine —
 *    Farside's rate limit (if any) replenishes within retry seconds.
 *
 * 4. **`cache: "no-store"`.** Always hit upstream during cron.
 *
 * 5. **No API key required.**
 *
 * 6. **Full Chrome User-Agent + Accept-Language.** Farside's bot
 *    filter blocks default fetch UAs (and `Mozilla/5.0 (finance-manager)`
 *    returned 403 in WebFetch testing). A real-browser UA with a sane
 *    `Accept-Language` tuple gets through reliably.
 *
 * 7. **`Accept: text/html`.** We're scraping HTML.
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

// Farside Investors Spot Bitcoin ETF flow page. Verified 2026-04-25.
// Same dataset that Bitbo + CoinGlass historically aggregated from;
// going to the source removes both the Bitbo IP block and the
// CoinGlass paywall from the dependency chain.
const ETF_FLOW_URL = "https://farside.co.uk/btc/";
const FETCH_TIMEOUT_MS = 15_000;
// Real-browser UA — Farside's bot filter rejects default fetch UAs and
// the `Mozilla/5.0 (finance-manager)` minimal string with HTTP 403.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

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
          // Farside's bot filter rejects default UAs — see JSDoc.
          "User-Agent": USER_AGENT,
          // Full HTML accept tuple matches what real Chrome sends; the
          // q-weighted variants pacify any UA-fingerprint sniffer that
          // looks for trailing image/webp.
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9," +
            "image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
      },
      { timeoutMs: FETCH_TIMEOUT_MS },
    );

    if (!response.ok) {
      // Keep the "CoinGlass HTTP …" prefix for log-search continuity
      // even though the upstream is now Farside — the consumer route
      // labels rows with `source_name: "coinglass"` for the same
      // blast-radius reason the type names are unchanged. Cite Farside
      // in the message body so on-call doesn't chase ghosts.
      return makeErrorResult(
        `CoinGlass HTTP ${response.status} ${response.statusText} (upstream: farside.co.uk)`,
      );
    }

    const body = await response.text();
    return parseCoinGlassEtfFlowResponse(body);
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `CoinGlass request timed out after ${FETCH_TIMEOUT_MS}ms per attempt (upstream: farside.co.uk)`
        : err instanceof Error
          ? err.message
          : String(err);
    return makeErrorResult(message);
  }
}
