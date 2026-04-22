import "server-only";

import {
  parseCoinGeckoResponse,
  makeErrorResult,
  type CoinGeckoDailyBar,
  type CoinGeckoFetchResult,
  type CoinGeckoFetchStatus,
} from "./coingecko-parse";

/**
 * CoinGecko `/coins/{id}/market_chart` fetcher for Phase 2 crypto
 * price ingest (blueprint §3.1, §3.2). Covers the 3 crypto ids —
 * `bitcoin`, `ethereum`, `solana`. Visualization-only per PRD §8.5;
 * the on-chain category's price-dependent inputs come from Bitbo
 * (MVRV Z, SOPR) and CoinGlass (ETF flow), not from CoinGecko.
 *
 * Design choices (mirrors Phase 1 `fred.ts`):
 *
 * 1. **Never throws on upstream failure.** Network errors, non-200 HTTP,
 *    malformed JSON, and CoinGecko error-in-a-200 bodies (e.g.
 *    `{ "error": "coin not found" }`) all return a `CoinGeckoFetchResult`
 *    with `fetch_status: "error"`. The Step 7 cron loops over coin ids
 *    and must not let one bad id poison the run (blueprint §0.5 tenet 1:
 *    "silent success, loud failure" — we return a loud error object).
 *
 * 2. **Hard 15s timeout per call.** Small budget; parallel-friendly in
 *    `Promise.all`.
 *
 * 3. **`cache: "no-store"`.** Always hit upstream during cron — the
 *    per-snapshot caching lives at the DB layer, not in the fetcher.
 *
 * 4. **No back-off needed.** CoinGecko's public API advertises ~30/min;
 *    our 3-coins-per-daily-cron schedule is well inside it. If we ever
 *    need hourly crypto price ingest we'd revisit, but then the right
 *    answer is a paid CoinGecko Pro tier with its own header-gated
 *    limits, not layering retries.
 *
 * 5. **`import "server-only"` guard.** No API key is required (CoinGecko
 *    free tier is unauthenticated), but the fetcher is server-side
 *    infrastructure and should never ship in a client bundle — keeps
 *    the invariant symmetric with FRED / Alpha Vantage.
 *
 * 6. **Pure parser extracted to `coingecko-parse.ts`.** Vitest +
 *    scripts import the parser without tripping the `"server-only"`
 *    guard.
 */

export type {
  CoinGeckoDailyBar,
  CoinGeckoFetchStatus,
  CoinGeckoFetchResult,
};
export { parseCoinGeckoResponse };

export interface FetchCoinGeckoMarketChartOptions {
  /** Days of history to request. Default 365 (1 year daily). */
  days?: number;
}

const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";
const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_DAYS = 365;
const COIN_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

/**
 * Fetch one CoinGecko coin's daily price chart and return a parsed,
 * scoring-ready result. Never throws on network/HTTP/upstream failure —
 * CoinGecko has no required env var, so there is no config-error path
 * that would justify a throw.
 */
export async function fetchCoinGeckoMarketChart(
  id: string,
  options: FetchCoinGeckoMarketChartOptions = {},
): Promise<CoinGeckoFetchResult> {
  const days = options.days ?? DEFAULT_DAYS;

  // Guard: `id` is interpolated into the URL path (not a searchParams
  // value), so a bad string could path-traverse or inject extra query
  // params. Our Phase 2 callers always pass one of the three
  // blueprint §3.2 IDs (`bitcoin`, `ethereum`, `solana`), but this
  // allow-list regex future-proofs against cron refactors that might
  // accept external input. CoinGecko coin slugs are lowercase
  // alphanumeric + hyphens.
  if (!COIN_ID_PATTERN.test(id)) {
    return makeErrorResult(
      id,
      `Invalid CoinGecko coin id (expected /^[a-z0-9-]{1,64}$/)`,
    );
  }

  const url = new URL(`${COINGECKO_BASE_URL}/coins/${id}/market_chart`);
  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("days", String(days));
  url.searchParams.set("interval", "daily");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      return makeErrorResult(
        id,
        `CoinGecko HTTP ${response.status} ${response.statusText}`,
      );
    }

    const body = (await response.json()) as unknown;
    return parseCoinGeckoResponse(id, body);
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `CoinGecko request timed out after ${FETCH_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err);
    return makeErrorResult(id, message);
  } finally {
    clearTimeout(timeoutId);
  }
}
