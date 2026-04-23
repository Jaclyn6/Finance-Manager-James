import { cacheLife, cacheTag } from "next/cache";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AssetType } from "@/lib/score-engine/types";
import type { Tables } from "@/types/database";

import { CACHE_TAGS } from "./tags";

/**
 * Composite-snapshot readers for the protected UI.
 *
 * ─ Why the ADMIN client inside `'use cache'` ─────────────────────
 *
 * These `'use cache'` functions use `getSupabaseAdminClient()` (the
 * service-role, RLS-bypassing client) instead of the user-authenticated
 * `getSupabaseServerClient()`. Three reasons (blueprint §7 open
 * question #3):
 *
 * 1. The data is NOT per-user. `composite_snapshots` is family-wide
 *    macro data — all 3 family members see the same rows. Per-user
 *    gating already happens upstream in `src/proxy.ts`, which
 *    redirects unauthenticated requests to `/login` before they ever
 *    reach these readers. A cached reader that returns identical rows
 *    for every authenticated caller is correct and maximizes cache hits.
 *
 * 2. `'use cache'` cannot safely call `cookies()`. The user-auth server
 *    client depends on `await cookies()` — a runtime API. Under Next 16
 *    `cacheComponents: true`, a runtime API inside a cached scope
 *    breaks the static shell and force-dynamic-renders the whole page.
 *    The admin client has no cookie dependency, so it's cache-compatible.
 *
 * 3. Captured values in a cached scope must be serializable. A
 *    `SupabaseClient` isn't. These functions create a fresh client
 *    inside the function body (not captured from outer scope), so
 *    serializability doesn't enter the picture — Next.js only
 *    serializes arguments (cache key) and return values (cache value),
 *    both of which are plain JSON here.
 *
 * ─ Cache tag + cadence strategy ──────────────────────────────────
 *
 * - `getLatestCompositeSnapshots()` → `cacheTag(macro-snapshot) +
 *   cacheLife('days')`. Aligns with the 24h cron; the cron's
 *   `revalidateTag('macro-snapshot', { expire: 0 })` evicts this on
 *   fresh data arrival, so users never see stale composites.
 *
 * - `getCompositeSnapshotsForDate(date)` → same tag, but
 *   `cacheLife('weeks')`. Historical snapshots are immutable (the
 *   same past date queried today and next week must return byte-for-byte
 *   the same row), so longer cache is safe and reduces DB load when
 *   users scrub through history via the date picker.
 *
 * - `getClosestEarlierSnapshotDate(date)` → same tag, `cacheLife('days')`.
 *   Cadence tracks "latest" because its answer shifts forward as new
 *   snapshots land.
 *
 * Separate functions (not one with an optional `date?` arg) because
 * `'use cache'` keys on arguments: a function called with `undefined`
 * and with `"2026-04-19"` gets two cache entries. Splitting them makes
 * the cadence difference explicit in the signature.
 *
 * ─ `model_version` cross-version policy ─────────────────────────
 *
 * Readers DO NOT filter on `model_version`. Blueprint §4.2 plus plan
 * §0.2 #9 (greenfield cutover) specify that v1 and v2 rows coexist
 * in the table but never share a (asset_type, snapshot_date) tuple —
 * v1 covers pre-cutover dates, v2 covers post-cutover. Returning
 * every version lets the dashboard show historical v1 data at
 * `/dashboard?date=2026-04-01` after the cutover to v2.0.0, which
 * blueprint §4.4 Step 4 explicitly requires. The composite_snapshots
 * unique index `(asset_type, snapshot_date, model_version)`
 * guarantees no dupes within one date; callers that dedupe by
 * (asset, date) need no version tiebreak under the greenfield
 * policy.
 *
 * The UI surfaces which version produced each displayed row via the
 * `ScoreTrendLine` cutover ReferenceLine (Step 6) and the header
 * `ModelVersionBadge`. Phase 3 backtest replay against a pinned
 * historical version should add a parallel version-scoped reader
 * (`getCompositeSnapshotsForDateAndVersion`) rather than re-adding
 * the hard filter here.
 */

type CompositeSnapshot = Tables<"composite_snapshots">;

/**
 * Number of asset_type_enum values. Used to size the lookback query
 * for the "latest per asset_type" dedupe below. If the enum ever
 * gains a 6th value, bump this — a too-small value risks missing
 * rows on partial-failure weeks.
 */
const ASSET_TYPE_COUNT = 5;

/** Days of history to scan when deduping "latest per asset_type". */
const LATEST_LOOKBACK_DAYS = 7;

/**
 * Returns the most recent composite snapshot for each asset_type.
 *
 * Semantic: "for each of the 5 asset_type_enum values, give me its
 * freshest row." NOT "the 5 most recent rows" (those can double up on
 * the same asset_type across a partial-failure day and leave another
 * asset_type missing).
 *
 * Implementation: fetch a 7-day window newest-first (today + 6
 * prior days), then dedupe in memory keeping the first row per
 * asset_type. Cheap (≤35 rows), robust to up to 6 consecutive missed
 * ingest days — an outage longer than that produces an empty result
 * and the UI surfaces it via the staleness badge. Single query.
 *
 * Under the cron invariant "every successful run writes one row per
 * asset_type", the typical case is 5 rows returned, all from today.
 */
export async function getLatestCompositeSnapshots(): Promise<
  CompositeSnapshot[]
> {
  "use cache";
  cacheTag(CACHE_TAGS.macroSnapshot);
  cacheLife("days");

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("composite_snapshots")
    .select("*")
    // Intentionally NOT filtered on model_version — blueprint §4.4 Step 4
    // + plan §0.2 #9 (greenfield cutover) require historical v1 rows to
    // remain visible after MODEL_VERSION bumps. v1 and v2 rows don't
    // overlap by date under the greenfield policy — EXCEPT on the
    // cutover day itself if the pre-cutover cron fires against an
    // older deployment before the cutover-day redeploy. Secondary sort
    // on model_version DESC ensures the Map dedupe below prefers the
    // newest regime when both versions landed for the same
    // (asset_type, date) pair.
    .order("snapshot_date", { ascending: false })
    .order("model_version", { ascending: false })
    .limit(LATEST_LOOKBACK_DAYS * ASSET_TYPE_COUNT);

  if (error) {
    throw new Error(
      `getLatestCompositeSnapshots failed: ${error.message} (${error.code ?? "no code"})`,
    );
  }

  const latestByAsset = new Map<AssetType, CompositeSnapshot>();
  for (const row of data ?? []) {
    if (!latestByAsset.has(row.asset_type)) {
      latestByAsset.set(row.asset_type, row);
    }
  }
  return Array.from(latestByAsset.values());
}

/**
 * Returns all composite snapshots for one specific calendar date.
 *
 * Under the cron invariant (one row per asset_type per day), this
 * returns up to 5 rows. Callers that find zero rows should render
 * the no-snapshot empty state (Step 10.5's
 * `src/components/shared/no-snapshot-notice.tsx`) and can call
 * {@link getClosestEarlierSnapshotDate} to produce a quick-jump link.
 *
 * @param date `YYYY-MM-DD` — already validated and clamped to
 *   [project_epoch, today] by the page-level `searchParams` handler.
 */
export async function getCompositeSnapshotsForDate(
  date: string,
): Promise<CompositeSnapshot[]> {
  "use cache";
  cacheTag(CACHE_TAGS.macroSnapshot);
  cacheLife("weeks");

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("composite_snapshots")
    .select("*")
    .eq("snapshot_date", date);
    // No model_version filter — see getLatestCompositeSnapshots for
    // rationale (greenfield v1↔v2 coexistence per plan §0.2 #9).

  if (error) {
    throw new Error(
      `getCompositeSnapshotsForDate(${date}) failed: ${error.message} (${error.code ?? "no code"})`,
    );
  }

  return data ?? [];
}

/**
 * Returns every snapshot for one `asset_type` within the last `days`
 * days ending at `endDate`, ordered oldest-first for chart plotting.
 *
 * Rationale for a third reader (vs. `getCompositeSnapshotsForDate` or
 * a `.filter()` on all-assets results): the trend chart on
 * `/asset/[slug]` wants an asset-scoped rolling window, and fetching
 * all five asset_types for 90 days (5×90 = 450 rows) just to drop
 * 80% of them in memory is wasteful. A scoped query lets Postgres
 * narrow on `(asset_type, snapshot_date)` — indexed via the primary
 * unique key — and returns only the asset's own ~90 rows.
 *
 * Cache cadence: `cacheLife('days')` same as `getLatestCompositeSnapshots`,
 * because if `endDate` is today the newest row moves daily with the
 * cron, and the cron's `revalidateTag('macro-snapshot', { expire: 0 })`
 * invalidates this reader too. Historical rolling windows also
 * benefit from daily-life eviction — slightly wasteful vs. weeks for
 * the oldest segments, but consistent and simple, and the cost is
 * negligible for a 4-user dashboard.
 *
 * @param assetType the `asset_type_enum` value — caller has already
 *   resolved the URL slug via `slugToAssetType()`
 * @param endDate inclusive upper bound (`YYYY-MM-DD`)
 * @param days non-negative window size (e.g. 90 for "last 90 days");
 *   malformed inputs clamp to 30 so the chart always renders
 *   something rather than 500-ing on a caller bug
 */
export async function getCompositeSnapshotsForAssetRange(
  assetType: AssetType,
  endDate: string,
  days: number,
): Promise<CompositeSnapshot[]> {
  "use cache";
  cacheTag(CACHE_TAGS.macroSnapshot);
  cacheLife("days");

  const safeDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 30;
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  // On malformed endDate, fall back to a tiny window that produces an
  // empty result rather than spanning the whole table.
  const startDate = Number.isFinite(endMs)
    ? new Date(endMs - safeDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
    : endDate;

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("composite_snapshots")
    .select("*")
    .eq("asset_type", assetType)
    // No model_version filter — rolling windows that span the v1→v2
    // cutover MUST show both versions so the trend chart's
    // ReferenceLine at the cutover date makes sense (blueprint §3.4).
    // Without this, the 90-day window on day N post-cutover shows
    // only N points instead of 90 and the chart looks broken.
    //
    // BUT: if both versions landed for the same (asset_type, date)
    // pair (cutover-day dual cron), the trend chart would plot two
    // points at that date. The outer reader should dedupe; here we
    // keep both rows in the ASC stream and document that consumers
    // expecting one row per date must dedupe on (ticker, date,
    // MAX(model_version)).
    .gte("snapshot_date", startDate)
    .lte("snapshot_date", endDate)
    .order("snapshot_date", { ascending: true });

  if (error) {
    throw new Error(
      `getCompositeSnapshotsForAssetRange(${assetType}, ${endDate}, ${days}) failed: ${error.message} (${error.code ?? "no code"})`,
    );
  }

  return data ?? [];
}

/**
 * Returns the most recent `snapshot_date` strictly before `date`,
 * across any asset_type. Used by the no-snapshot empty state to offer
 * a "jump to 2026-04-18" link when the user picks a day without data.
 *
 * Returns `null` if no earlier date exists — e.g. the user selected a
 * date before project_epoch, or the table is empty.
 *
 * Selects only `snapshot_date` (not `*`) so the cache value is a tiny
 * string rather than a full row.
 */
export async function getClosestEarlierSnapshotDate(
  date: string,
): Promise<string | null> {
  "use cache";
  cacheTag(CACHE_TAGS.macroSnapshot);
  cacheLife("days");

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("composite_snapshots")
    .select("snapshot_date")
    // No model_version filter — the no-snapshot notice needs to offer a
    // jump-link to the CLOSEST valid date regardless of regime; a user
    // picking 2026-02-01 (before Phase 1's 2026-03-21 epoch) should get
    // a link to 2026-03-21 (v1), not "no data ever".
    .lt("snapshot_date", date)
    .order("snapshot_date", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(
      `getClosestEarlierSnapshotDate(${date}) failed: ${error.message} (${error.code ?? "no code"})`,
    );
  }

  return data?.[0]?.snapshot_date ?? null;
}
