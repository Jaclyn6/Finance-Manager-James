/**
 * Pure on-chain-metric response parser for MVRV Z-Score and SOPR.
 *
 * **History.** Originally targeted Bitbo's unofficial JSON endpoints at
 * `https://bitbo.io/metrics/{mvrv-z-score,sopr}.json`. Those paths were
 * removed in 2026 (HTTP 404). The interactive Bitbo charts at
 * `https://charts.bitbo.io/...` migrated to a paid API tier (`api_key=...`).
 * To preserve a key-free, free-tier source for the family hobby tool, the
 * fetcher was repointed at **bitcoin-data.com** (BGeometrics), which
 * publishes both metrics under a public REST API at
 * `https://api.bitcoin-data.com/v1/{mvrv-zscore,sopr}`. Verified working
 * 2026-04-25.
 *
 * The file/type/function names ("Bitbo*") are kept for blast-radius
 * reasons — the consumer route in `ingest-onchain/route.ts` and several
 * tests import these symbols. The semantics — fetch MVRV-Z and SOPR from
 * a key-free public source — are unchanged.
 *
 * **Response shape (bitcoin-data.com).** The full-history endpoint
 * returns a top-level JSON array; the `/last` variant returns a single
 * object. Each entry uses metric-specific value keys:
 *
 * ```json
 * [
 *   { "d": "2026-04-23", "unixTs": 1776902400, "mvrvZscore": 0.84 },
 *   { "d": "2026-04-24", "unixTs": 1776988800, "mvrvZscore": 0.83 }
 * ]
 * ```
 *
 * For SOPR the value key is `sopr` instead of `mvrvZscore`. The parser
 * handles both keys plus a generic `value` fallback so a downstream
 * shape rename doesn't immediately break the cron.
 *
 * **Legacy {data: [...]} shape.** Older Bitbo-style payloads with a
 * top-level `{data: [{date, value}]}` envelope are still accepted —
 * cheap insurance + keeps the existing test fixtures meaningful for
 * regression coverage. The parser auto-detects which shape it has.
 *
 * Split out of `bitbo.ts` so:
 * - Vitest can test parsing without the server-only guard.
 * - Phase 2 backfill scripts can reuse the parser in Node env.
 *
 * Blueprint §4.5 ties both metrics to signals:
 *   - MVRV_Z → CRYPTO_UNDERVALUED (`MVRV_Z ≤ 0`)
 *   - SOPR → CAPITULATION (`SOPR < 1`)
 * so a failed parse must propagate as `fetch_status: "error"`, never
 * as silent zeros — otherwise the signal engine would mis-fire on
 * missing data (tenet 1, plan §0.5).
 */

/** Metric identifier (kept stable across the source-URL change). */
export type BitboMetric = "mvrv-z-score" | "sopr";

/**
 * One daily observation of an on-chain metric.
 */
export interface BitboObservation {
  /** Calendar date of the observation, YYYY-MM-DD. */
  date: string;
  /** Parsed numeric value of the metric for that date. */
  value: number;
}

export type BitboFetchStatus = "success" | "error" | "partial" | "stale";

export interface BitboFetchResult {
  metric: BitboMetric;
  /** All observations in chronological ascending order. */
  observations: BitboObservation[];
  /** Most recent observation, or null if none could be parsed. */
  latest: BitboObservation | null;
  fetch_status: BitboFetchStatus;
  /** Populated when fetch_status !== "success". */
  error?: string;
  /** ISO timestamp of parse completion. */
  fetched_at: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Pure parser for the daily-metric response.
 *
 * Accepts three observed shapes:
 *  1. `bitcoin-data.com` array:    `[{d, unixTs, mvrvZscore|sopr|value}, ...]`
 *  2. `bitcoin-data.com` /last:    single `{d, unixTs, mvrvZscore|sopr|value}`
 *  3. Legacy Bitbo wrapper:        `{data: [{date, value}, ...]}`
 *
 * Never throws. Any unexpected payload shape yields a well-formed
 * error result; individual malformed rows are skipped so one bad
 * entry does not poison the batch.
 */
export function parseBitboResponse(
  metric: BitboMetric,
  body: unknown,
): BitboFetchResult {
  if (body === null || body === undefined) {
    return makeErrorResult(metric, "Bitbo response was null/undefined");
  }

  // Shape 1 — top-level array (bitcoin-data.com full-history).
  if (Array.isArray(body)) {
    return parseEntries(metric, body);
  }

  if (typeof body !== "object") {
    return makeErrorResult(metric, "Bitbo response was not an object");
  }

  const obj = body as Record<string, unknown>;

  // Shape 3 — legacy `{data: [...]}` wrapper.
  if (Array.isArray(obj["data"])) {
    return parseEntries(metric, obj["data"] as unknown[]);
  }

  // Shape 2 — single-object /last response. Treat as a one-element array.
  if ("d" in obj || "date" in obj) {
    return parseEntries(metric, [obj]);
  }

  return makeErrorResult(metric, "Bitbo response missing data[]");
}

/**
 * Parse an array of raw entries into well-formed observations. Skips
 * malformed rows. Returns success/partial/error appropriately.
 */
function parseEntries(
  metric: BitboMetric,
  raw: unknown[],
): BitboFetchResult {
  const observations: BitboObservation[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;

    const date = extractDate(rec);
    if (date === null) continue;

    const value = extractValue(metric, rec);
    if (value === null) continue;

    observations.push({ date, value });
  }

  if (observations.length === 0) {
    return {
      metric,
      observations: [],
      latest: null,
      fetch_status: "partial",
      error: "no observations after parsing",
      fetched_at: new Date().toISOString(),
    };
  }

  // Sort ascending by date. Don't trust upstream order — cheap insurance.
  observations.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  return {
    metric,
    observations,
    latest: observations[observations.length - 1],
    fetch_status: "success",
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Pull a YYYY-MM-DD date string out of an entry. Accepts:
 *  - `d` (bitcoin-data.com)
 *  - `date` (legacy Bitbo)
 *  - `unixTs` (seconds-since-epoch number — used as a fallback if `d`
 *    is missing or malformed; we re-derive the calendar date in UTC).
 */
function extractDate(rec: Record<string, unknown>): string | null {
  const direct = rec["d"] ?? rec["date"];
  if (typeof direct === "string" && ISO_DATE.test(direct)) {
    return direct;
  }

  const unixTs = rec["unixTs"];
  if (typeof unixTs === "number" && Number.isFinite(unixTs)) {
    // Heuristic: bitcoin-data.com publishes seconds; if a future
    // payload uses ms, scale appropriately.
    const ms = unixTs > 1e12 ? unixTs : unixTs * 1000;
    const iso = new Date(ms).toISOString().slice(0, 10);
    return ISO_DATE.test(iso) ? iso : null;
  }

  return null;
}

/**
 * Pull the numeric metric value out of an entry. Tries metric-specific
 * keys first (`mvrvZscore` / `sopr`), then a generic `value` legacy
 * fallback. String numerics are accepted (some upstream APIs return
 * stringified floats); NaN / Infinity / non-finite are rejected.
 */
function extractValue(
  metric: BitboMetric,
  rec: Record<string, unknown>,
): number | null {
  const keys: string[] =
    metric === "mvrv-z-score"
      ? ["mvrvZscore", "mvrv_zscore", "value"]
      : ["sopr", "value"];

  for (const k of keys) {
    if (!(k in rec)) continue;
    const raw = rec[k];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string") {
      // Pre-trim and reject empty strings — `Number("")` returns 0
      // (finite!), which would silently coerce a missing value into a
      // false signal: SOPR<1 → CAPITULATION, MVRV_Z≤0 → CRYPTO_UNDERVALUED.
      // Treat empty/whitespace-only strings as missing, not zero.
      const trimmed = raw.trim();
      if (trimmed === "") continue;
      const n = Number(trimmed);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * Build a canonical error-shape result. Exported for reuse by the
 * fetcher wrapper on network/HTTP failure.
 */
export function makeErrorResult(
  metric: BitboMetric,
  message: string,
): BitboFetchResult {
  return {
    metric,
    observations: [],
    latest: null,
    fetch_status: "error",
    error: message,
    fetched_at: new Date().toISOString(),
  };
}
