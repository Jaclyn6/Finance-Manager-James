/**
 * Pure alternative.me Crypto Fear & Greed response parser.
 *
 * Split out of `alternative-me.ts` so that:
 *
 * - Vitest can test the parser in a plain Node env (no network) —
 *   the wrapper `alternative-me.ts` carries `import "server-only"` for
 *   consistency with other sources, even though alternative.me is a
 *   public (keyless) API.
 * - Phase 2 backfill / ad-hoc scripts can reuse the parser without
 *   dragging in the `"server-only"` guard that blocks Node-env scripts.
 *
 * Everything here is framework-agnostic — no React, no Next.js, no
 * Supabase, no `process.env` reads.
 *
 * alternative.me Crypto F&G quirks this parser handles:
 *
 * 1. The upstream returns newest-first. We sort the parsed rows by
 *    date ascending (not `.reverse()`) to match the Phase 1 FRED
 *    convention and make `latest = observations[observations.length - 1]`
 *    the canonical selection. Sorting rather than reversing is
 *    defensive against any future upstream re-ordering — a simple
 *    reverse would only be correct if alternative.me always emits
 *    strictly newest-first.
 * 2. `value` is a stringly-typed integer 0-100. We coerce and bounds-
 *    check; out-of-range values drop the row rather than poison the
 *    batch (mirrors the FRED "one bad row doesn't kill the parse"
 *    contract).
 * 3. `timestamp` is a Unix-seconds string. We convert to YYYY-MM-DD in
 *    UTC and enforce the strict `/^\d{4}-\d{2}-\d{2}$/` regex before
 *    accepting — Postgres DATE columns crash on off-format strings and
 *    would take down the whole batch upsert on indicator_readings.
 * 4. `value_classification` is a human-readable string ("Extreme Fear",
 *    "Fear", "Neutral", "Greed", "Extreme Greed"). We normalize to
 *    snake_case enum values for DB-friendliness. Unknown
 *    classifications flip the result to `partial` with a descriptive
 *    error rather than throwing.
 */

/** Snake-case normalized form of alternative.me's value_classification. */
export type CryptoFearGreedClassification =
  | "extreme_fear"
  | "fear"
  | "neutral"
  | "greed"
  | "extreme_greed";

export interface CryptoFearGreedObservation {
  /** Calendar date of the observation (UTC), YYYY-MM-DD. */
  date: string;
  /** 0-100 integer. */
  value: number;
  classification: CryptoFearGreedClassification;
}

export type CryptoFearGreedFetchStatus = "success" | "error" | "partial";

export interface CryptoFearGreedResult {
  /** Chronological ASCENDING (reversed from the upstream default). */
  observations: CryptoFearGreedObservation[];
  /** Last element of `observations`, or null when no rows parsed. */
  latest: CryptoFearGreedObservation | null;
  fetch_status: CryptoFearGreedFetchStatus;
  /** Populated when fetch_status !== "success". */
  error?: string;
  /** ISO timestamp of parse completion. */
  fetched_at: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Pure parser for alternative.me's `/fng/` response. Never throws.
 * Any unexpected payload shape yields a well-formed error result;
 * individual malformed rows are dropped without killing the parse.
 */
export function parseAlternativeMeFngResponse(
  body: unknown,
): CryptoFearGreedResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return makeErrorResult("alternative.me response was not an object");
  }

  const bodyObj = body as Record<string, unknown>;
  const rawData = bodyObj["data"];
  if (!Array.isArray(rawData)) {
    return makeErrorResult("alternative.me response missing data[]");
  }

  const parsed: CryptoFearGreedObservation[] = [];
  let sawUnknownClassification = false;

  for (const item of rawData) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;

    // Value: stringly-typed int 0-100.
    if (typeof rec["value"] !== "string") continue;
    const value = Number(rec["value"]);
    if (!Number.isFinite(value)) continue;
    if (value < 0 || value > 100) continue; // out-of-range: drop row
    const intValue = Math.round(value);

    // Timestamp: unix-seconds string.
    if (typeof rec["timestamp"] !== "string") continue;
    const ts = Number(rec["timestamp"]);
    if (!Number.isFinite(ts)) continue;
    const date = unixSecondsToUtcDate(ts);
    if (date === null) continue;
    if (!ISO_DATE.test(date)) continue; // Postgres DATE safety

    // Classification: human-readable string; normalize.
    if (typeof rec["value_classification"] !== "string") continue;
    const classification = normalizeClassification(rec["value_classification"]);
    if (classification === null) {
      // Unknown classification string — don't crash; skip the row and
      // mark the whole result partial so the caller can log a shape
      // drift warning.
      sawUnknownClassification = true;
      continue;
    }

    parsed.push({ date, value: intValue, classification });
  }

  if (parsed.length === 0) {
    return {
      observations: [],
      latest: null,
      fetch_status: "partial",
      error: sawUnknownClassification
        ? "no observations after parsing (unknown value_classification)"
        : "no observations after parsing",
      fetched_at: new Date().toISOString(),
    };
  }

  // Reverse: upstream is newest-first, we want chronological ascending.
  // Sort explicitly instead of relying on insertion order — defensive
  // against any upstream re-ordering.
  parsed.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    observations: parsed,
    latest: parsed[parsed.length - 1],
    fetch_status: sawUnknownClassification ? "partial" : "success",
    error: sawUnknownClassification
      ? "some rows dropped: unknown value_classification"
      : undefined,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Build a canonical error-shape result. Exported for reuse by the
 * fetcher wrapper on network/HTTP failure.
 */
export function makeErrorResult(message: string): CryptoFearGreedResult {
  return {
    observations: [],
    latest: null,
    fetch_status: "error",
    error: message,
    fetched_at: new Date().toISOString(),
  };
}

function normalizeClassification(
  raw: string,
): CryptoFearGreedClassification | null {
  switch (raw.trim().toLowerCase()) {
    case "extreme fear":
      return "extreme_fear";
    case "fear":
      return "fear";
    case "neutral":
      return "neutral";
    case "greed":
      return "greed";
    case "extreme greed":
      return "extreme_greed";
    default:
      return null;
  }
}

/**
 * Convert Unix seconds to YYYY-MM-DD in UTC, or null on invalid input.
 * We stay in UTC (never local time) so the cron's per-day partition
 * boundary is deterministic across deployments.
 */
function unixSecondsToUtcDate(unixSeconds: number): string | null {
  if (!Number.isFinite(unixSeconds)) return null;
  const ms = unixSeconds * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  // toISOString() is always YYYY-MM-DDTHH:mm:ss.sssZ; the first 10
  // chars are the UTC calendar date.
  return d.toISOString().slice(0, 10);
}
