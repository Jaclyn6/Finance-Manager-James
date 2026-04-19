import "server-only";

/**
 * FRED (St. Louis Federal Reserve Economic Data) series fetcher.
 *
 * One function per call: the ingest cron (src/app/api/cron/ingest-macro/route.ts)
 * loops over `INDICATOR_KEYS` and awaits `fetchFredSeries(key)` for each.
 *
 * Design choices:
 *
 * 1. **Never throws on upstream failure.** Network errors, non-200 HTTP,
 *    malformed JSON — all return a `FredFetchResult` with
 *    `fetch_status: "error"`. The cron's partial-failure policy
 *    (blueprint §3 / PRD §8.1: "cron continues with remaining indicators,
 *    partial data > no data") depends on this: one bad indicator must
 *    not poison the others.
 *
 * 2. **Hard timeout per call.** `AbortController` fires after 15s.
 *    Seven indicators × 15s worst-case = 105s total wall time, well under
 *    the Vercel Fluid Compute 300s default timeout.
 *
 * 3. **Pure parser extracted.** `parseFredResponse(id, body)` is a
 *    named export so Vitest can feed synthetic payloads without going
 *    over the network. The wrapper `fetchFredSeries` is the thin
 *    HTTP concern.
 *
 * 4. **`"."` is a missing-data sentinel.** FRED uses a literal period
 *    to denote "no value for this date" (common at recent month-ends
 *    for monthly series). We represent this as `value: null` in
 *    `FredObservation` — keeping the date slot lets us see the gap,
 *    but numeric callers filter nulls out of the Z-score window.
 *
 * 5. **`import "server-only"` guard.** FRED_API_KEY lives in
 *    `process.env.FRED_API_KEY` (no NEXT_PUBLIC_ prefix) so it never
 *    ships to the browser, but the import chain guard enforces this
 *    at build time instead of runtime.
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

export interface FetchFredSeriesOptions {
  /** Years of history to request. Default 5, matching INDICATOR_CONFIG. */
  windowYears?: number;
}

const FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations";
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch one FRED series and return a parsed, scoring-ready result.
 * Never throws on network/HTTP failure. Throws only if `FRED_API_KEY`
 * is unset — a programmer/config error, not a transient upstream issue.
 */
export async function fetchFredSeries(
  seriesId: string,
  options: FetchFredSeriesOptions = {},
): Promise<FredFetchResult> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    throw new Error(
      "FRED_API_KEY is not set — add it to .env.local (dev) or Vercel env (prod)",
    );
  }

  const windowYears = options.windowYears ?? 5;
  const startDate = new Date();
  startDate.setUTCFullYear(startDate.getUTCFullYear() - windowYears);
  const observationStart = startDate.toISOString().slice(0, 10);

  const url = new URL(FRED_BASE_URL);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("observation_start", observationStart);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      // Route Handlers in Next 16 don't cache fetch by default, but
      // the cron's whole purpose is "always hit upstream" — be explicit.
      cache: "no-store",
    });

    if (!response.ok) {
      return makeErrorResult(
        seriesId,
        `FRED HTTP ${response.status} ${response.statusText}`,
      );
    }

    const body = (await response.json()) as unknown;
    return parseFredResponse(seriesId, body);
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `FRED request timed out after ${FETCH_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err);
    return makeErrorResult(seriesId, message);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Pure parser. Safe to call with any `unknown` payload — returns a
 * well-shaped error result for anything that doesn't match FRED's
 * documented `{ observations: [{date, value}, ...] }` schema.
 *
 * Exported for Vitest; the network wrapper is the only other caller.
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

  const observations: FredObservation[] = [];
  for (const item of rawObs) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { date?: unknown; value?: unknown };
    if (typeof rec.date !== "string") continue;
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

function makeErrorResult(seriesId: string, message: string): FredFetchResult {
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
