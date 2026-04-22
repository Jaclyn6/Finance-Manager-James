/**
 * Pure Alpha Vantage TIME_SERIES_DAILY response parser.
 *
 * Split out of `alpha-vantage.ts` so that:
 *
 * - Vitest can test the parser in a plain Node env (no network, no env
 *   vars) — the wrapper `alpha-vantage.ts` still carries
 *   `import "server-only"` to prevent ALPHA_VANTAGE_API_KEY from leaking
 *   to client bundles.
 * - Phase 2 backfill / ad-hoc scripts can reuse the parser without
 *   dragging in the `"server-only"` guard that blocks Node-env scripts.
 *
 * Everything here is framework-agnostic — no React, no Next.js, no
 * Supabase, no `process.env` reads.
 *
 * Alpha Vantage quirks this parser handles:
 *
 * 1. Rate-limit payloads come back as a 200 OK with body like
 *    `{ "Information": "..." }` (new) or `{ "Note": "..." }` (old).
 *    We must detect these and return `fetch_status: "error"` so the
 *    Step 7 cron's per-ticker loop can log + continue with the next
 *    ticker instead of silently inserting an empty bars array.
 * 2. Invalid tickers come back as `{ "Error Message": "..." }`.
 * 3. The daily-bars map uses stringly-typed numeric fields with
 *    ordinal prefixes ("1. open", "4. close", etc.). Any one of them
 *    being non-numeric is a malformed row — skip the row, don't kill
 *    the parse. This mirrors the Phase 1 FRED parser's
 *    "one bad row doesn't poison the batch" contract.
 * 4. Date keys MUST match /^\d{4}-\d{2}-\d{2}$/ before we accept them
 *    — Postgres DATE columns crash on off-format strings and would
 *    take down the whole batch upsert.
 */

/**
 * One daily OHLCV bar for an Alpha Vantage ticker.
 */
export interface AlphaVantageDailyBar {
  /** Calendar date of the bar, YYYY-MM-DD. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type AlphaVantageFetchStatus = "success" | "error" | "partial" | "stale";

export interface AlphaVantageFetchResult {
  ticker: string;
  /** All daily bars in chronological ascending order. */
  bars: AlphaVantageDailyBar[];
  /** Most recent bar, or null if none could be parsed. */
  latest: AlphaVantageDailyBar | null;
  fetch_status: AlphaVantageFetchStatus;
  /** Populated when fetch_status !== "success". */
  error?: string;
  /** ISO timestamp of parse completion. */
  fetched_at: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Pure parser for the Alpha Vantage TIME_SERIES_DAILY response.
 * Never throws. Any unexpected payload shape yields a well-formed
 * error result; one malformed row yields a partial result with the
 * good rows intact.
 */
export function parseAlphaVantageDailyResponse(
  ticker: string,
  body: unknown,
): AlphaVantageFetchResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return makeErrorResult(ticker, "Alpha Vantage response was not an object");
  }

  const bodyObj = body as Record<string, unknown>;

  // Detect the three Alpha Vantage error/rate-limit payloads. All three
  // come back as HTTP 200 with the data keys simply absent, so if we
  // don't special-case them we'd silently return empty bars.
  if (typeof bodyObj["Information"] === "string") {
    return makeErrorResult(
      ticker,
      `Alpha Vantage rate limit / info: ${bodyObj["Information"]}`,
    );
  }
  if (typeof bodyObj["Note"] === "string") {
    return makeErrorResult(
      ticker,
      `Alpha Vantage rate limit note: ${bodyObj["Note"]}`,
    );
  }
  if (typeof bodyObj["Error Message"] === "string") {
    return makeErrorResult(
      ticker,
      `Alpha Vantage error: ${bodyObj["Error Message"]}`,
    );
  }

  const rawSeries = bodyObj["Time Series (Daily)"];
  if (!rawSeries || typeof rawSeries !== "object" || Array.isArray(rawSeries)) {
    return makeErrorResult(
      ticker,
      "Alpha Vantage response missing 'Time Series (Daily)'",
    );
  }

  const bars: AlphaVantageDailyBar[] = [];
  const seriesObj = rawSeries as Record<string, unknown>;

  for (const [dateKey, rawBar] of Object.entries(seriesObj)) {
    if (!ISO_DATE.test(dateKey)) continue; // Postgres DATE safety
    if (!rawBar || typeof rawBar !== "object" || Array.isArray(rawBar)) continue;
    const bar = rawBar as Record<string, unknown>;

    const open = toFiniteNumber(bar["1. open"]);
    const high = toFiniteNumber(bar["2. high"]);
    const low = toFiniteNumber(bar["3. low"]);
    const close = toFiniteNumber(bar["4. close"]);
    const volume = toFiniteNumber(bar["5. volume"]);

    if (
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      volume === null
    ) {
      continue; // malformed row — skip, don't kill the batch
    }

    bars.push({ date: dateKey, open, high, low, close, volume });
  }

  if (bars.length === 0) {
    return {
      ticker,
      bars: [],
      latest: null,
      fetch_status: "partial",
      error: "no bars after parsing",
      fetched_at: new Date().toISOString(),
    };
  }

  // Alpha Vantage returns most-recent-first, but we can't rely on
  // insertion order — sort explicitly to ascending chronological.
  bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    ticker,
    bars,
    latest: bars[bars.length - 1],
    fetch_status: "success",
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Build a canonical error-shape result. Exported for reuse by the
 * fetcher wrapper on network/HTTP failure.
 */
export function makeErrorResult(
  ticker: string,
  message: string,
): AlphaVantageFetchResult {
  return {
    ticker,
    bars: [],
    latest: null,
    fetch_status: "error",
    error: message,
    fetched_at: new Date().toISOString(),
  };
}

function toFiniteNumber(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
