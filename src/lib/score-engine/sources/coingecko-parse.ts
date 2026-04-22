/**
 * Pure CoinGecko `/coins/{id}/market_chart` response parser.
 *
 * Split out of `coingecko.ts` so that:
 *
 * - Vitest can test the parser in a plain Node env (no network, no env
 *   vars). The wrapper `coingecko.ts` carries `import "server-only"`
 *   defensively (no API key is needed, but the fetcher itself is
 *   server-side infrastructure and should not end up in a client bundle).
 * - Phase 2 backfill scripts can reuse the parser without dragging in
 *   the `"server-only"` guard.
 *
 * Everything here is framework-agnostic — no React, no Next.js, no
 * Supabase, no `process.env` reads.
 *
 * CoinGecko quirks this parser handles:
 *
 * 1. `prices` is an array of `[unix_ms, usd_price]` tuples. We must
 *    convert the unix-ms timestamp to a Postgres-safe `YYYY-MM-DD`
 *    DATE string in UTC — CoinGecko's daily bars are midnight-UTC
 *    indexed, so no timezone math is needed beyond `.toISOString().slice(0,10)`.
 * 2. Error bodies come back with HTTP 200 in some cases — e.g.
 *    `{ "error": "coin not found" }` on an unknown coin id. We detect
 *    the missing `prices` array and return `fetch_status: "error"`.
 * 3. Individual tuples with non-number entries are skipped (don't kill
 *    the whole batch), mirroring Phase 1 FRED parser's contract.
 */

/**
 * One daily bar from CoinGecko market_chart response.
 */
export interface CoinGeckoDailyBar {
  /** Calendar date of the bar, YYYY-MM-DD, UTC-indexed. */
  date: string;
  /** USD close price. */
  close: number;
}

export type CoinGeckoFetchStatus = "success" | "error" | "partial" | "stale";

export interface CoinGeckoFetchResult {
  /** CoinGecko coin id — "bitcoin" | "ethereum" | "solana" (§3.2). */
  id: string;
  /** All parsed daily bars in chronological ascending order. */
  bars: CoinGeckoDailyBar[];
  /** Most recent bar, or null if none could be parsed. */
  latest: CoinGeckoDailyBar | null;
  fetch_status: CoinGeckoFetchStatus;
  /** Populated when fetch_status !== "success". */
  error?: string;
  /** ISO timestamp of parse completion. */
  fetched_at: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Pure parser for the CoinGecko `/coins/{id}/market_chart` response.
 * Never throws. Any unexpected payload shape yields a well-formed
 * error result; individual malformed tuples are skipped so one bad
 * row does not kill the batch.
 */
export function parseCoinGeckoResponse(
  id: string,
  body: unknown,
): CoinGeckoFetchResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return makeErrorResult(id, "CoinGecko response was not an object");
  }

  const prices = (body as { prices?: unknown }).prices;
  if (!Array.isArray(prices)) {
    // Covers CoinGecko's error bodies like `{ error: "coin not found" }`
    // which come back as HTTP 200 with no `prices` array.
    const errMsg = (body as { error?: unknown }).error;
    if (typeof errMsg === "string") {
      return makeErrorResult(id, `CoinGecko error: ${errMsg}`);
    }
    return makeErrorResult(id, "CoinGecko response missing prices[]");
  }

  const bars: CoinGeckoDailyBar[] = [];
  for (const tuple of prices) {
    if (!Array.isArray(tuple) || tuple.length < 2) continue;
    const [ts, price] = tuple;
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
    if (typeof price !== "number" || !Number.isFinite(price)) continue;

    const date = unixMsToIsoDate(ts);
    // Defensive: toISOString() always produces YYYY-MM-DD...-prefixed
    // strings for finite epoch values, but guard against a future
    // refactor breaking the invariant. Also guards us from NaN ts
    // slipping past the isFinite check in some engines.
    if (!ISO_DATE.test(date)) continue;

    bars.push({ date, close: price });
  }

  if (bars.length === 0) {
    return {
      id,
      bars: [],
      latest: null,
      fetch_status: "partial",
      error: "no bars after parsing",
      fetched_at: new Date().toISOString(),
    };
  }

  // CoinGecko returns prices chronologically ascending, but we can't
  // rely on insertion order — sort explicitly.
  bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    id,
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
  id: string,
  message: string,
): CoinGeckoFetchResult {
  return {
    id,
    bars: [],
    latest: null,
    fetch_status: "error",
    error: message,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Convert a unix-ms timestamp to a `YYYY-MM-DD` UTC date string.
 * CoinGecko's daily bars are emitted at 00:00:00 UTC, so the UTC
 * slice of the ISO string is the correct calendar date.
 */
function unixMsToIsoDate(unixMs: number): string {
  return new Date(unixMs).toISOString().slice(0, 10);
}
