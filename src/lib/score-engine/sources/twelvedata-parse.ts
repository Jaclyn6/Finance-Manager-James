/**
 * Pure Twelve Data time_series response parser (Phase 3.0 Tier 2 adapter).
 *
 * Split out of `twelvedata.ts` so Vitest can test the parser in a plain
 * Node env without triggering the `"server-only"` guard on the fetcher.
 * Mirrors the alpha-vantage-parse / bitbo-parse split pattern.
 *
 * Twelve Data quirks handled:
 *
 * 1. Error responses arrive as JSON `{ "status": "error", "code": NNN }`
 *    — may come as HTTP 200 OR as HTTP 4xx. The parser handles the JSON
 *    layer; the fetcher in `twelvedata.ts` handles the HTTP layer.
 * 2. `values` array is reverse-chronological (newest first) — reversed
 *    on return so consumers get oldest-first like AV's parser.
 * 3. All numeric fields (open/high/low/close/volume) come as STRINGS —
 *    parseFloat. Mirrors AV's `1. open`, `2. high` stringly-typed quirk.
 * 4. Date keys MUST match /^\d{4}-\d{2}-\d{2}$/ before acceptance —
 *    Postgres DATE columns crash on off-format strings. Mirrors
 *    `alpha-vantage-parse.ts` `ISO_DATE` guard.
 * 5. One malformed row → skip the row, don't kill the parse. Mirrors
 *    AV's "one bad row doesn't poison the batch" contract.
 *
 * References:
 * - Twelve Data time_series API: https://twelvedata.com/docs#time-series
 * - Twelve Data pricing/limits: https://twelvedata.com/pricing (free 800/d, 8/min)
 * - docs/phase3_0_data_recovery_blueprint.md §2.1, §5 Step 1
 */

import type { DailyBar, DailyBarSeries } from "./daily-bar-types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_NAME = "twelvedata" as const;

/**
 * Pure parser for the Twelve Data time_series response.
 * Never throws. Any unexpected payload shape yields a well-formed
 * error result; one malformed row yields a partial/ok result with
 * the good rows intact.
 */
export function parseTwelveDataResponse(
  ticker: string,
  body: unknown,
): DailyBarSeries {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return makeTwelveDataErrorResult(
      ticker,
      "Twelve Data response was not an object",
    );
  }

  const b = body as Record<string, unknown>;

  // JSON-level error payload: bad key (401), rate limit (429), bad symbol (400).
  if (b["status"] === "error") {
    const code = typeof b["code"] === "number" ? b["code"] : 0;
    const msg =
      typeof b["message"] === "string" ? b["message"] : "unknown error";
    if (code === 429) {
      return makeTwelveDataErrorResult(
        ticker,
        `Twelve Data rate limit (429): ${msg}`,
      );
    }
    if (code === 401) {
      return makeTwelveDataErrorResult(
        ticker,
        `Twelve Data invalid API key (401): ${msg}`,
      );
    }
    return makeTwelveDataErrorResult(
      ticker,
      `Twelve Data error (${code}): ${msg}`,
    );
  }

  const rawValues = b["values"];
  if (!Array.isArray(rawValues)) {
    return makeTwelveDataErrorResult(
      ticker,
      "Twelve Data response missing 'values' array",
    );
  }

  if (rawValues.length === 0) {
    return makeTwelveDataErrorResult(
      ticker,
      "Twelve Data returned empty 'values' array",
    );
  }

  const bars: DailyBar[] = [];

  for (const entry of rawValues) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;

    const dateRaw = e["datetime"];
    if (typeof dateRaw !== "string" || !ISO_DATE.test(dateRaw)) continue;

    const open = toFiniteNumber(e["open"]);
    const high = toFiniteNumber(e["high"]);
    const low = toFiniteNumber(e["low"]);
    const close = toFiniteNumber(e["close"]);
    const volume = toFiniteNumber(e["volume"]);

    if (
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      volume === null
    ) {
      continue;
    }

    bars.push({ date: dateRaw, open, high, low, close, volume });
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

  // Twelve Data returns newest-first; sort ascending so consumers
  // (technical.ts MA/RSI/MACD windows) get oldest-first like AV.
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
 * Build a canonical Twelve Data error-shape result. Exported for reuse
 * by `twelvedata.ts` on network/HTTP failure.
 */
export function makeTwelveDataErrorResult(
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

function toFiniteNumber(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}
