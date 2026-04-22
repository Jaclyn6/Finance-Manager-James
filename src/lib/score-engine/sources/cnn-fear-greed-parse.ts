/**
 * Pure CNN Fear & Greed (stock) response parser.
 *
 * Unofficial endpoint. The response shape modelled here is as of
 * 2026-04-23. CNN has historically changed this endpoint without
 * notice; if live responses stop parsing, inspect the raw body and
 * adjust this parser. The blueprint's EXTREME_FEAR signal (§4.5)
 * depends on CNN F&G being available; total outage requires falling
 * back to VIX-only per the `VIX >= 35 || CNN_FG < 25` OR semantics.
 *
 * Split out of `cnn-fear-greed.ts` so that:
 *
 * - Vitest can test the parser in a plain Node env (no network) —
 *   the wrapper carries `import "server-only"` and the back-off
 *   helper import, both of which are awkward in unit tests.
 * - Phase 2 backfill / ad-hoc scripts can reuse the parser without
 *   pulling in `"server-only"` or the back-off runtime.
 *
 * Everything here is framework-agnostic — no React, no Next.js, no
 * Supabase, no `process.env` reads.
 *
 * CNN F&G quirks this parser handles:
 *
 * 1. The response has 7 sub-indicators (market_momentum_sp500,
 *    stock_price_strength, etc.). We only consume `fear_and_greed`
 *    (current) and `fear_and_greed_historical.data[]` (time series).
 *    The six other sub-indicators, plus `previous_close`/`previous_*`
 *    fields inside `fear_and_greed`, are intentionally ignored.
 * 2. Historical `data[]` entries use `x: unix_ms` (milliseconds, not
 *    seconds) and `y: score`. We convert `x` to YYYY-MM-DD UTC and
 *    enforce the strict `/^\d{4}-\d{2}-\d{2}$/` regex for Postgres
 *    DATE safety.
 * 3. `rating` is already snake_case in the wild
 *    ("extreme_fear" | "fear" | "neutral" | "greed" | "extreme_greed")
 *    but we still validate with an allowlist — if CNN ever changes
 *    the enum, we flip the parser to a partial/error instead of
 *    propagating an unknown string into the DB.
 * 4. Missing `fear_and_greed` (but otherwise valid object) → partial
 *    (we still try to salvage history). Missing both → error.
 * 5. `score` is a float (e.g. 42.5). We keep it as a float rather
 *    than rounding — the downstream EXTREME_FEAR signal uses a
 *    `< 25` threshold, and rounding would change boundary behaviour.
 */

/** Allowlist matching CNN's documented rating enum. */
export type CnnFearGreedRating =
  | "extreme_fear"
  | "fear"
  | "neutral"
  | "greed"
  | "extreme_greed";

export interface CnnFearGreedObservation {
  /** Calendar date of the observation (UTC), YYYY-MM-DD. */
  date: string;
  /** 0-100, may be a float. */
  score: number;
  rating: CnnFearGreedRating;
}

export type CnnFearGreedFetchStatus = "success" | "error" | "partial";

export interface CnnFearGreedResult {
  /** Current reading from the `fear_and_greed` object. */
  latest: CnnFearGreedObservation | null;
  /** Time series from `fear_and_greed_historical.data[]`, chronological ASC. */
  history: CnnFearGreedObservation[];
  fetch_status: CnnFearGreedFetchStatus;
  /** Populated when fetch_status !== "success". */
  error?: string;
  /** ISO timestamp of parse completion. */
  fetched_at: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const VALID_RATINGS: ReadonlySet<CnnFearGreedRating> = new Set([
  "extreme_fear",
  "fear",
  "neutral",
  "greed",
  "extreme_greed",
]);

/**
 * Pure parser for CNN's Markets Data fear-and-greed response. Never
 * throws. Any unexpected top-level shape yields a well-formed error
 * result; individual malformed history rows are dropped without
 * killing the parse; a missing `fear_and_greed` but valid history
 * yields partial (and vice versa).
 */
export function parseCnnFearGreedResponse(
  body: unknown,
): CnnFearGreedResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return makeErrorResult("CNN F&G response was not an object");
  }

  const bodyObj = body as Record<string, unknown>;

  const latest = parseLatest(bodyObj["fear_and_greed"]);
  const { history, historyDropped } = parseHistory(
    bodyObj["fear_and_greed_historical"],
  );

  // Both missing → can't extract anything useful.
  if (latest === null && history.length === 0) {
    return {
      latest: null,
      history: [],
      fetch_status: "error",
      error:
        "CNN F&G response missing both fear_and_greed and fear_and_greed_historical.data",
      fetched_at: new Date().toISOString(),
    };
  }

  // One of the two populated → partial.
  let status: CnnFearGreedFetchStatus = "success";
  let error: string | undefined;
  if (latest === null) {
    status = "partial";
    error = "fear_and_greed missing or malformed";
  } else if (history.length === 0) {
    status = "partial";
    error = "fear_and_greed_historical.data missing or empty";
  } else if (historyDropped > 0) {
    status = "partial";
    error = `dropped ${historyDropped} malformed history row(s)`;
  }

  return {
    latest,
    history,
    fetch_status: status,
    error,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Build a canonical error-shape result. Exported for reuse by the
 * fetcher wrapper on network/HTTP failure.
 */
export function makeErrorResult(message: string): CnnFearGreedResult {
  return {
    latest: null,
    history: [],
    fetch_status: "error",
    error: message,
    fetched_at: new Date().toISOString(),
  };
}

function parseLatest(raw: unknown): CnnFearGreedObservation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const score = toFiniteNumber(obj["score"]);
  if (score === null) return null;
  if (score < 0 || score > 100) return null;

  const rating = toRating(obj["rating"]);
  if (rating === null) return null;

  const date = toIsoDateFromAnyTimestamp(obj["timestamp"]);
  if (date === null) return null;

  return { date, score, rating };
}

function parseHistory(raw: unknown): {
  history: CnnFearGreedObservation[];
  historyDropped: number;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { history: [], historyDropped: 0 };
  }
  const obj = raw as Record<string, unknown>;
  const rawData = obj["data"];
  if (!Array.isArray(rawData)) {
    return { history: [], historyDropped: 0 };
  }

  const out: CnnFearGreedObservation[] = [];
  let dropped = 0;

  for (const item of rawData) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      dropped++;
      continue;
    }
    const rec = item as Record<string, unknown>;

    const score = toFiniteNumber(rec["y"]);
    if (score === null || score < 0 || score > 100) {
      dropped++;
      continue;
    }

    const rating = toRating(rec["rating"]);
    if (rating === null) {
      dropped++;
      continue;
    }

    // x is unix milliseconds for the historical series.
    const xNum = toFiniteNumber(rec["x"]);
    if (xNum === null) {
      dropped++;
      continue;
    }
    const date = unixMsToUtcDate(xNum);
    if (date === null || !ISO_DATE.test(date)) {
      dropped++;
      continue;
    }

    out.push({ date, score, rating });
  }

  // Sort ascending defensively — upstream is already chronological in
  // practice, but we don't rely on that.
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return { history: out, historyDropped: dropped };
}

/**
 * CNN's top-level `fear_and_greed.timestamp` is an ISO-8601 string
 * (e.g. "2026-04-23T12:00:00.000Z"). Historical `x` is unix ms. This
 * helper accepts either — it's only used for the latest reading.
 */
function toIsoDateFromAnyTimestamp(raw: unknown): string | null {
  if (typeof raw === "string") {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    const iso = d.toISOString().slice(0, 10);
    return ISO_DATE.test(iso) ? iso : null;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Heuristic: if it's > 10^12 it's likely milliseconds; otherwise
    // seconds. CNN's timestamp is a string in practice, so this
    // branch is belt-and-suspenders.
    const ms = raw > 1e12 ? raw : raw * 1000;
    return unixMsToUtcDate(ms);
  }
  return null;
}

function unixMsToUtcDate(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString().slice(0, 10);
  return ISO_DATE.test(iso) ? iso : null;
}

function toFiniteNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toRating(raw: unknown): CnnFearGreedRating | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  return VALID_RATINGS.has(normalized as CnnFearGreedRating)
    ? (normalized as CnnFearGreedRating)
    : null;
}
