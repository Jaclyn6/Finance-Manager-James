import "server-only";

import {
  parseFredResponse,
  type FredFetchResult,
  type FredObservation,
  type FredFetchStatus,
} from "./fred-parse";

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
 *    The cron route calls `fetchFredSeries` in parallel via
 *    `Promise.all`, so worst-case total wall time is ~15s (the slowest
 *    series), not 7×15s. Well under the Vercel Fluid Compute 300s
 *    default timeout.
 *
 * 3. **Pure parser extracted to `fred-parse.ts`.** `parseFredResponse(id, body)`
 *    lives there so Vitest (and the Phase 1 backfill script) can
 *    exercise it without the `"server-only"` guard this file carries.
 *    Re-exported from here for backward compatibility with existing
 *    callers.
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

export type { FredObservation, FredFetchStatus, FredFetchResult };
export { parseFredResponse };

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
      return {
        series_id: seriesId,
        observations: [],
        latest: null,
        window: [],
        fetch_status: "error",
        error: `FRED HTTP ${response.status} ${response.statusText}`,
        fetched_at: new Date().toISOString(),
      };
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
    return {
      series_id: seriesId,
      observations: [],
      latest: null,
      window: [],
      fetch_status: "error",
      error: message,
      fetched_at: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
