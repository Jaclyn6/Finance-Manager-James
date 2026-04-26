/**
 * Pure Yahoo Finance chart-API response parser (Phase 3.0 Tier 3 / KR primary).
 *
 * Split out of `yahoo-finance.ts` so Vitest can test the parser in a
 * plain Node env without the `"server-only"` guard. Mirrors the
 * alpha-vantage-parse / twelvedata-parse split pattern.
 *
 * Yahoo `query2.finance.yahoo.com/v8/finance/chart/{ticker}` quirks:
 *
 * 1. Response wraps everything in `{ chart: { result: [...], error } }`.
 *    `error` is `null` on success; an object on failure.
 * 2. `result[0].timestamp[]` is Unix seconds, market-open time. We
 *    convert to UTC YYYY-MM-DD. NOTE: Yahoo's timestamps are the
 *    market-open instant in the exchange timezone but expressed in
 *    UTC seconds. For a daily bar, the resulting UTC calendar date
 *    matches the trade date for US tickers but can be off-by-one for
 *    KR (`.KS`/`.KQ`) since KR markets open at 00:00 UTC. We use
 *    `gmtoffset` from `meta` to localise, matching what users see on
 *    finance.yahoo.com.
 * 3. `result[0].indicators.quote[0]` holds parallel arrays
 *    `{ open, high, low, close, volume }`. Any element can be null
 *    (illiquid days, half-trading sessions); we drop those rows.
 * 4. Empty `result` array → invalid ticker. Empty `timestamp` →
 *    no bars in window.
 * 5. Yahoo's "chart" endpoint requires a UA header but no cookie/
 *    crumb (the crumb requirement is for `quoteSummary` only).
 *
 * References:
 * - Yahoo Finance chart endpoint shape: https://query2.finance.yahoo.com/v8/finance/chart/SPY
 * - yfinance lib (community wrapper): https://github.com/ranaroussi/yfinance
 * - docs/phase3_0_data_recovery_blueprint.md §2.1, §5 Step 2
 */

import type { DailyBar, DailyBarSeries } from "./daily-bar-types";

const SOURCE_NAME = "yahoo_finance" as const;

/**
 * Pure parser for Yahoo's `chart` endpoint response. Never throws.
 * Any unexpected payload yields a well-formed error result; one
 * malformed row yields a partial/ok result with the good rows intact.
 */
export function parseYahooFinanceResponse(
  ticker: string,
  body: unknown,
): DailyBarSeries {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return makeYahooErrorResult(
      ticker,
      "Yahoo Finance response was not an object",
    );
  }

  const b = body as Record<string, unknown>;
  const chart = b["chart"];
  if (!chart || typeof chart !== "object" || Array.isArray(chart)) {
    return makeYahooErrorResult(
      ticker,
      "Yahoo Finance response missing 'chart' object",
    );
  }

  const c = chart as Record<string, unknown>;

  // Surface upstream errors (invalid symbol, etc.) as fetch_status:'error'.
  const upstreamErr = c["error"];
  if (upstreamErr && typeof upstreamErr === "object") {
    const e = upstreamErr as Record<string, unknown>;
    const code = typeof e["code"] === "string" ? e["code"] : "unknown";
    const description =
      typeof e["description"] === "string"
        ? e["description"]
        : "no description";
    return makeYahooErrorResult(
      ticker,
      `Yahoo Finance error (${code}): ${description}`,
    );
  }

  const result = c["result"];
  if (!Array.isArray(result) || result.length === 0) {
    return makeYahooErrorResult(
      ticker,
      "Yahoo Finance response missing 'result' array (likely invalid ticker)",
    );
  }

  const r0 = result[0];
  if (!r0 || typeof r0 !== "object" || Array.isArray(r0)) {
    return makeYahooErrorResult(
      ticker,
      "Yahoo Finance result[0] not an object",
    );
  }

  const r = r0 as Record<string, unknown>;

  // Per-exchange timezone offset (in seconds) from meta. Used to
  // resolve a Unix timestamp to the LOCAL market date — for KR, the
  // 32400s (KST) offset matters; without it we'd file 2026-04-25's
  // Samsung close under 2026-04-24 in UTC.
  const meta = r["meta"];
  const gmtoffset =
    meta &&
    typeof meta === "object" &&
    !Array.isArray(meta) &&
    typeof (meta as Record<string, unknown>)["gmtoffset"] === "number"
      ? ((meta as Record<string, unknown>)["gmtoffset"] as number)
      : 0;

  const timestamp = r["timestamp"];
  if (!Array.isArray(timestamp) || timestamp.length === 0) {
    return makeYahooErrorResult(
      ticker,
      "Yahoo Finance result[0] missing or empty 'timestamp' array",
    );
  }

  const indicators = r["indicators"];
  if (!indicators || typeof indicators !== "object") {
    return makeYahooErrorResult(
      ticker,
      "Yahoo Finance result[0] missing 'indicators'",
    );
  }
  const quote = (indicators as Record<string, unknown>)["quote"];
  if (!Array.isArray(quote) || quote.length === 0) {
    return makeYahooErrorResult(
      ticker,
      "Yahoo Finance result[0].indicators missing 'quote' array",
    );
  }
  const q = quote[0];
  if (!q || typeof q !== "object" || Array.isArray(q)) {
    return makeYahooErrorResult(
      ticker,
      "Yahoo Finance result[0].indicators.quote[0] not an object",
    );
  }
  const qObj = q as Record<string, unknown>;

  const opens = numArrayOrEmpty(qObj["open"]);
  const highs = numArrayOrEmpty(qObj["high"]);
  const lows = numArrayOrEmpty(qObj["low"]);
  const closes = numArrayOrEmpty(qObj["close"]);
  const volumes = numArrayOrEmpty(qObj["volume"]);

  // The five OHLCV arrays must align in length with `timestamp`.
  // If they don't, Yahoo gave us malformed data — bail loudly.
  const n = timestamp.length;
  if (
    opens.length !== n ||
    highs.length !== n ||
    lows.length !== n ||
    closes.length !== n ||
    volumes.length !== n
  ) {
    return makeYahooErrorResult(
      ticker,
      "Yahoo Finance OHLCV arrays length mismatch with timestamp",
    );
  }

  const bars: DailyBar[] = [];
  for (let i = 0; i < n; i++) {
    const ts = timestamp[i];
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;

    const open = opens[i];
    const high = highs[i];
    const low = lows[i];
    const close = closes[i];
    const volume = volumes[i];

    // Any null in OHLC drops the row (illiquid / half-trading day).
    // Volume can legitimately be 0 (some KR ETFs on holidays); allow.
    if (
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      volume === null
    ) {
      continue;
    }

    const date = unixToLocalIsoDate(ts, gmtoffset);
    if (!date) continue;

    bars.push({ date, open, high, low, close, volume });
  }

  if (bars.length === 0) {
    return {
      ticker,
      bars: [],
      latest: null,
      source_name: SOURCE_NAME,
      fetch_status: "partial",
      error: "no bars after parsing",
      fetched_at: new Date().toISOString(),
    };
  }

  // Yahoo already returns ascending; defensively sort anyway so consumers
  // get the same oldest-first guarantee as AV / Twelve Data.
  bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    ticker,
    bars,
    latest: bars[bars.length - 1] ?? null,
    source_name: SOURCE_NAME,
    fetch_status: "ok",
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Build a canonical Yahoo Finance error-shape result. Exported for
 * reuse by `yahoo-finance.ts` on network/HTTP failure.
 */
export function makeYahooErrorResult(
  ticker: string,
  message: string,
): DailyBarSeries {
  return {
    ticker,
    bars: [],
    latest: null,
    source_name: SOURCE_NAME,
    fetch_status: "error",
    error: message,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Convert a Unix-seconds timestamp + a GMT-offset (seconds) into a
 * YYYY-MM-DD calendar date in the exchange's local timezone.
 *
 * Yahoo's `timestamp` is the market-open instant in UTC seconds. For a
 * KR ticker (gmtoffset=32400 = 9h), 2026-04-25 09:00 KST = 2026-04-25
 * 00:00 UTC. We add the offset and slice the ISO string before "T".
 */
function unixToLocalIsoDate(unixSec: number, gmtoffset: number): string | null {
  const ms = (unixSec + gmtoffset) * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  // Use the UTC slice of the offset-shifted Date so we don't depend on
  // the runtime's local TZ.
  return d.toISOString().slice(0, 10);
}

/** Parse a possibly-mixed array into number[] with nulls preserved. */
function numArrayOrEmpty(raw: unknown): Array<number | null> {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => {
    if (v === null) return null;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    return null;
  });
}
