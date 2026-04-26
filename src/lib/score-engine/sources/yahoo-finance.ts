import "server-only";

/**
 * Yahoo Finance chart-API daily-bar fetcher (Phase 3.0 Tier 3 / KR primary).
 *
 * Returns daily OHLCV bars for a given ticker in chronological ascending
 * order, conforming to `DailyBarSeries`. Used by the fallback chain in
 * `ingest-technical/route.ts` (Phase 3.0 Step 3) as:
 *
 *   - Tier 3 (last resort) for US/global tickers — after AV `compact` and
 *     Twelve Data 800/d both fail.
 *   - Tier 1 (primary) for KR tickers (`.KS` / `.KQ`) — AV rejects the
 *     suffix and Twelve Data doesn't cover KR. Yahoo is the only free
 *     option that resolves Samsung 005930.KS, KODEX 229200.KQ, etc.
 *
 * Endpoint:
 *   GET https://query2.finance.yahoo.com/v8/finance/chart/{ticker}
 *     ?range=2y&interval=1d
 *   Headers: User-Agent: Mozilla/5.0 ...
 *
 * No API key. Yahoo's "chart" endpoint requires only a UA header (the
 * cookie/crumb requirement applies to `quoteSummary`, not `chart`).
 * Rate limit is undocumented; community reports ~360 req/hr per IP. For
 * 19 tickers × 1/day from a single GHA runner IP this is trivially safe.
 *
 * References:
 * - Yahoo Finance chart endpoint: https://query2.finance.yahoo.com/v8/finance/chart/SPY
 * - yfinance lib (community wrapper): https://github.com/ranaroussi/yfinance
 * - docs/phase3_0_data_recovery_blueprint.md §2.1, §5 Step 2
 *
 * Design choices (mirrors `alpha-vantage.ts` / `twelvedata.ts`):
 *
 * 1. Never throws on upstream failure. Network errors, non-200 HTTP,
 *    malformed JSON, and Yahoo's `chart.error` payloads all return
 *    DailyBarSeries with `fetch_status: "error"`. The fallback chain
 *    must not let one bad ticker poison the run (blueprint §0.5
 *    tenet 1).
 * 2. Hard 15s timeout per call.
 * 3. `cache: "no-store"`. The cron always wants fresh data.
 * 4. No retries on 429 — fail loud. Yahoo's 429s persist for tens of
 *    minutes once tripped; auto-retry just chains failures.
 * 5. Pure parser extracted to `yahoo-finance-parse.ts`. Vitest stays
 *    free of `"server-only"`.
 * 6. `import "server-only"` guard. No env var needed but the fetcher
 *    does cron-side work so we keep the boundary explicit.
 *
 * KR-ticker note (Step 3 / 4 implementer): Yahoo accepts `005930.KS`,
 * `069500.KS`, `229200.KQ`. The `.KS` suffix is KOSPI; `.KQ` is KOSDAQ.
 * Use the same registry strings as `ticker-registry.ts` Step 4.
 */

import {
  parseYahooFinanceResponse,
  makeYahooErrorResult,
} from "./yahoo-finance-parse";
import { redactSecretsFromErrorMessage } from "./_redact";
import type { DailyBarSeries } from "./daily-bar-types";

export type { DailyBarSeries };
export { parseYahooFinanceResponse };

const YAHOO_BASE_URL = "https://query2.finance.yahoo.com/v8/finance/chart";
const FETCH_TIMEOUT_MS = 15_000;
const RANGE = "2y";
const INTERVAL = "1d";

/**
 * Browser-like UA header. Empty/missing UA returns 200 with empty
 * body from Yahoo (intentional anti-scraping degradation).
 */
const USER_AGENT =
  "Mozilla/5.0 (compatible; finance-manager/1.0; +https://finance-manager-james.vercel.app)";

/**
 * Fetch one Yahoo Finance daily-bar series and return a parsed,
 * scoring-ready result. Never throws on network/HTTP/upstream failure.
 */
export async function fetchYahooFinanceDaily(
  ticker: string,
): Promise<DailyBarSeries> {
  const url = new URL(`${YAHOO_BASE_URL}/${encodeURIComponent(ticker)}`);
  url.searchParams.set("range", RANGE);
  url.searchParams.set("interval", INTERVAL);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const detail =
        response.status === 429
          ? "Yahoo Finance HTTP 429 rate limit (IP throttled — wait 10+ minutes)"
          : `Yahoo Finance HTTP ${response.status} ${response.statusText}`;
      return makeYahooErrorResult(ticker, detail);
    }

    const body = (await response.json()) as unknown;
    return parseYahooFinanceResponse(ticker, body);
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `Yahoo Finance request timed out after ${FETCH_TIMEOUT_MS}ms`
        : err instanceof Error
          ? redactSecretsFromErrorMessage(err.message)
          : redactSecretsFromErrorMessage(String(err));
    return makeYahooErrorResult(ticker, message);
  } finally {
    clearTimeout(timeoutId);
  }
}
