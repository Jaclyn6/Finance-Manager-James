/**
 * Pure FRED response parser + small observation helpers.
 *
 * Split out of `fred.ts` so that:
 *
 * - Vitest can test the parser in a plain Node env (no network, no env
 *   vars) — the wrapper `fred.ts` still carries `import "server-only"`
 *   to prevent the FRED_API_KEY from leaking to client bundles.
 * - The Phase 1 historical-backfill script (`scripts/backfill-snapshots.ts`)
 *   can reuse the parser without dragging in the `"server-only"` guard
 *   that blocks Node-env scripts.
 *
 * Everything here is framework-agnostic — no React, no Next.js, no
 * Supabase, no `process.env` reads. Safe to import from any environment
 * including backfill tooling and unit tests.
 */

/**
 * One row from the FRED series/observations endpoint.
 */
export interface FredObservation {
  /** Calendar date of the observation, YYYY-MM-DD. */
  date: string;
  /** Parsed numeric value; null when FRED returned its `"."` sentinel. */
  value: number | null;
}

export type FredFetchStatus = "success" | "error" | "stale" | "partial";

export interface FredFetchResult {
  series_id: string;
  /** All observations in the requested window, chronological. */
  observations: FredObservation[];
  /** The most recent observation whose value is non-null, or null. */
  latest: FredObservation | null;
  /**
   * Historical values excluding `latest`. Passable directly as the
   * `series` argument to {@link computeZScore}. Nulls are dropped.
   */
  window: number[];
  fetch_status: FredFetchStatus;
  /** Populated when fetch_status !== "success". */
  error?: string;
  /** ISO timestamp of fetch completion (success or failure). */
  fetched_at: string;
}

/**
 * Pure parser. Safe to call with any `unknown` payload — returns a
 * well-shaped error result for anything that doesn't match FRED's
 * documented `{ observations: [{date, value}, ...] }` schema.
 */
export function parseFredResponse(
  seriesId: string,
  body: unknown,
): FredFetchResult {
  if (!body || typeof body !== "object") {
    return makeErrorResult(seriesId, "FRED response was not an object");
  }

  const rawObs = (body as { observations?: unknown }).observations;
  if (!Array.isArray(rawObs)) {
    return makeErrorResult(seriesId, "FRED response missing observations[]");
  }

  // FRED returns observation dates as `YYYY-MM-DD`. The Postgres
  // `observed_at` column on indicator_readings is a DATE, and an
  // empty string / off-format value would cause the whole batch
  // upsert to throw `invalid input syntax for type date`, killing
  // the ingest run. Be strict here so one malformed upstream row
  // can't poison the batch.
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  const observations: FredObservation[] = [];
  for (const item of rawObs) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { date?: unknown; value?: unknown };
    if (typeof rec.date !== "string" || !ISO_DATE.test(rec.date)) continue;
    if (typeof rec.value !== "string") continue;
    if (rec.value === ".") {
      observations.push({ date: rec.date, value: null });
      continue;
    }
    const parsed = Number(rec.value);
    if (!Number.isFinite(parsed)) continue; // skip malformed rows
    observations.push({ date: rec.date, value: parsed });
  }

  if (observations.length === 0) {
    return {
      series_id: seriesId,
      observations: [],
      latest: null,
      window: [],
      fetch_status: "partial",
      error: "no observations after parsing",
      fetched_at: new Date().toISOString(),
    };
  }

  // Find the index of the most recent non-null observation. FRED returns
  // observations chronologically, so iterate from the end.
  let latestIndex = -1;
  for (let i = observations.length - 1; i >= 0; i--) {
    if (observations[i].value !== null) {
      latestIndex = i;
      break;
    }
  }

  if (latestIndex === -1) {
    // All values are the "." sentinel — upstream effectively has no data.
    return {
      series_id: seriesId,
      observations,
      latest: null,
      window: [],
      fetch_status: "partial",
      error: "all observations are missing (FRED '.' sentinel)",
      fetched_at: new Date().toISOString(),
    };
  }

  const latest = observations[latestIndex];
  const window: number[] = [];
  for (let i = 0; i < latestIndex; i++) {
    const v = observations[i].value;
    if (v !== null) window.push(v);
  }

  return {
    series_id: seriesId,
    observations,
    latest,
    window,
    fetch_status: "success",
    fetched_at: new Date().toISOString(),
  };
}

export function makeErrorResult(
  seriesId: string,
  message: string,
): FredFetchResult {
  return {
    series_id: seriesId,
    observations: [],
    latest: null,
    window: [],
    fetch_status: "error",
    error: message,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Returns the most recent non-null observation with `date <= asOfDate`,
 * or `null` if no such observation exists.
 *
 * Used by the backfill script to answer "what was FRED showing for
 * series X as of date D?" — essential for replaying history because
 * monthly series publish on the 1st and daily series skip weekends /
 * holidays, so the "value for today" often means "the value from the
 * most recent publish".
 *
 * Assumes `observations` is chronological ascending (FRED's default).
 * O(n) linear scan — we're operating on per-indicator 5-year windows
 * (~1,300 daily rows or ~60 monthly rows), so linear is fine; avoids
 * the complexity of binary search for a one-off backfill tool.
 */
export function findObservationAsOf(
  observations: FredObservation[],
  asOfDate: string,
): FredObservation | null {
  let latest: FredObservation | null = null;
  for (const obs of observations) {
    if (obs.date > asOfDate) break; // past the cut-off; done
    if (obs.value !== null) latest = obs;
  }
  return latest;
}
