/**
 * Date utilities for the data layer and the date-picker UI.
 *
 * All functions operate on `YYYY-MM-DD` strings rather than Date
 * objects, because our `snapshot_date` and `change_date` columns are
 * Postgres DATE (not TIMESTAMPTZ). Coercing through a local-timezone
 * Date object drifts by up to a day whenever the user's timezone isn't
 * UTC, which would cause the date picker to snap "today" to the wrong
 * day for Korean users. String-in / string-out, with UTC-only math in
 * the middle, keeps this correct.
 *
 * Framework-agnostic — no React, no Next.js. Safe to import from
 * Server Components, Client Components, `'use cache'` scopes, and
 * Vitest Node-env tests.
 */

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Returns true iff `s` parses as a valid `YYYY-MM-DD` calendar date.
 *
 * Rejects:
 * - Malformed shapes (`"2026-4-1"`, `"2026/04/01"`, `""`).
 * - Impossible dates (`"2026-02-30"` — Date coerces this to March 2nd
 *   in JS, but we require the round-trip to match).
 *
 * The round-trip check (`formatIsoDate(new Date(...)) === s`) is what
 * catches `2026-02-30` → `2026-03-02`: the reformat differs from the
 * input, so we reject.
 */
export function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE_PATTERN.test(s)) return false;
  const parsed = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return formatIsoDate(parsed) === s;
}

/**
 * Formats a `Date` as `YYYY-MM-DD` using UTC components.
 *
 * Using `.toISOString().slice(0, 10)` is the terse form of the same
 * thing — kept as a helper so the timezone intent is explicit at call
 * sites and can't accidentally flip to the `Date.prototype.toLocale*`
 * family.
 */
export function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Symmetric window around an anchor date: ±`windowDays`.
 *
 * Used by the changelog reader to bound the query. Returns the anchor
 * itself on both sides if the input is invalid, so the downstream
 * query returns empty rather than spanning the entire table.
 *
 * @param anchor  `YYYY-MM-DD` string
 * @param windowDays  Non-negative integer number of days on each side
 */
export function computeDateWindow(
  anchor: string,
  windowDays: number,
): { start: string; end: string } {
  if (!isValidIsoDate(anchor) || !Number.isFinite(windowDays) || windowDays < 0) {
    return { start: anchor, end: anchor };
  }

  const anchorMs = new Date(`${anchor}T00:00:00Z`).getTime();
  const startDate = new Date(anchorMs - windowDays * MS_PER_DAY);
  const endDate = new Date(anchorMs + windowDays * MS_PER_DAY);

  return {
    start: formatIsoDate(startDate),
    end: formatIsoDate(endDate),
  };
}
