import { cacheLife, cacheTag } from "next/cache";

import { MODEL_VERSION } from "@/lib/score-engine/weights";
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
 * ─ `model_version` filter ────────────────────────────────────────
 *
 * Every reader filters on `model_version = MODEL_VERSION`
 * (current). Blueprint §4.2 says bumping `MODEL_VERSION` "writes new
 * rows that coexist with old under a different version tag", i.e. old
 * and new can share the same (asset_type, snapshot_date). Without
 * this filter, the dashboard would non-deterministically mix versions
 * per asset card after a bump. Explicit filtering also means a
 * `MODEL_VERSION` bump immediately cuts off stale composites even if
 * the cache hasn't been invalidated yet.
 *
 * If Phase 3 ever wants to browse historical versions side-by-side
 * (blueprint §4.2 mentions backtest replay), add a parallel
 * `getCompositeSnapshotsForDateAndVersion(date, version)` reader
 * rather than loosening this filter.
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
    .eq("model_version", MODEL_VERSION)
    .order("snapshot_date", { ascending: false })
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
    .eq("snapshot_date", date)
    .eq("model_version", MODEL_VERSION);

  if (error) {
    throw new Error(
      `getCompositeSnapshotsForDate(${date}) failed: ${error.message} (${error.code ?? "no code"})`,
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
    .eq("model_version", MODEL_VERSION)
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
