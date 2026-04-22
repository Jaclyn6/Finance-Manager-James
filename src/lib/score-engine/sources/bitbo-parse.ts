/**
 * Pure Bitbo on-chain-metric response parser.
 *
 * **Unofficial API caveat.** Bitbo (bitbo.io) publishes a public
 * dashboard of Bitcoin on-chain metrics with JSON endpoints, but those
 * endpoints are NOT covered by a versioned stability contract. The
 * response shape below is a defensive best-effort based on the public
 * dashboard's observable behaviour at authoring time (2026-04-23):
 *
 * ```json
 * {
 *   "metric": "mvrv-z-score",
 *   "data": [
 *     { "date": "2026-04-22", "value": 1.45 },
 *     { "date": "2026-04-23", "value": 1.48 }
 *   ]
 * }
 * ```
 *
 * The real live endpoint MUST be verified at Phase 2 Step 7 (cron
 * implementation). If the shape differs (e.g. top-level array instead
 * of `{data: [...]}`, different key names, Unix timestamps instead of
 * YYYY-MM-DD), update this parser and the bitbo.test.ts fixtures —
 * don't paper over the mismatch inside the fetcher.
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

/** Metric identifier on the Bitbo unofficial API. */
export type BitboMetric = "mvrv-z-score" | "sopr";

/**
 * One daily observation of a Bitbo on-chain metric.
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
 * Pure parser for the Bitbo daily-metric response.
 *
 * Never throws. Any unexpected payload shape yields a well-formed
 * error result; individual malformed rows are skipped so one bad
 * entry does not poison the batch.
 */
export function parseBitboResponse(
  metric: BitboMetric,
  body: unknown,
): BitboFetchResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return makeErrorResult(metric, "Bitbo response was not an object");
  }

  const rawData = (body as { data?: unknown }).data;
  if (!Array.isArray(rawData)) {
    return makeErrorResult(metric, "Bitbo response missing data[]");
  }

  const observations: BitboObservation[] = [];
  for (const entry of rawData) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const rec = entry as { date?: unknown; value?: unknown };
    if (typeof rec.date !== "string" || !ISO_DATE.test(rec.date)) continue;
    if (typeof rec.value !== "number" || !Number.isFinite(rec.value)) continue;
    observations.push({ date: rec.date, value: rec.value });
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
