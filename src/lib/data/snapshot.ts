import { revalidateTag } from "next/cache";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { TablesInsert } from "@/types/database";

import { CACHE_TAGS } from "./tags";

/**
 * Writers for the ingest cron pipeline.
 *
 * All functions here use the admin (service_role) client and bypass
 * RLS. They are called exclusively from the cron Route Handler at
 * `src/app/api/cron/ingest-macro/route.ts` (scheduled for blueprint
 * §9 Step 8). None should be reachable from a Client Component — the
 * service-role key is a write-everywhere credential and must not ship
 * to the browser. Two overlapping guards enforce this:
 *
 * 1. `getSupabaseAdminClient()` reads `SUPABASE_SERVICE_ROLE_KEY` from
 *    `process.env`, which Next.js does not inline into client bundles.
 * 2. The admin client is imported only from server-only modules
 *    (this file + the cron route handler). Adding a `"use client"`
 *    consumer would break this chain; keep `supabase/admin.ts` out of
 *    any UI code path.
 *
 * Idempotency strategy — the cron can re-run for the same day
 * (manual retrigger, Vercel cron retry on a 5xx) without duplicating
 * data. We upsert on the natural unique keys declared in migration
 * `0001_initial_schema.sql`:
 *
 *   indicator_readings    → (indicator_key, observed_at, model_version)
 *   composite_snapshots   → (asset_type, snapshot_date, model_version)
 *
 * `score_changelog` has NO unique index today (the schema leaves it
 * open-ended), so `writeScoreChangelog` does a plain `.insert()`. If
 * the cron double-fires, duplicate delta rows can accrue for the same
 * (asset_type, change_date). The TODO below tracks closing this gap.
 *
 * TODO(blueprint §9 Step 8): add `score_changelog_dedup` unique index
 * on `(asset_type, change_date, model_version)` via a new migration,
 * then switch `writeScoreChangelog` to an upsert on that constraint.
 *
 * `ingest_runs` is a plain append — each cron execution is its own
 * audit record, so duplication is expected on retry (each retry gets
 * its own row with independent success/failure counts).
 */

type IndicatorReadingInsert = TablesInsert<"indicator_readings">;
type CompositeSnapshotInsert = TablesInsert<"composite_snapshots">;
type ScoreChangelogInsert = TablesInsert<"score_changelog">;
type IngestRunInsert = TablesInsert<"ingest_runs">;

/**
 * Bulk-upsert indicator observations into `indicator_readings`.
 *
 * Conflict on `(indicator_key, observed_at, model_version)` → the new
 * row replaces the old. That matters when FRED publishes a revision:
 * the `is_revised=true` flag differentiates first-seen vs corrected.
 *
 * Empty batch is a no-op with zero network cost — the cron can pass
 * whatever it fetched without pre-filtering.
 */
export async function writeIndicatorReadings(
  readings: IndicatorReadingInsert[],
): Promise<void> {
  if (readings.length === 0) return;

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("indicator_readings")
    .upsert(readings, {
      onConflict: "indicator_key,observed_at,model_version",
    });

  if (error) {
    throw new Error(
      `writeIndicatorReadings failed: ${error.message} (${error.code ?? "no code"})`,
    );
  }
}

/**
 * Upsert one composite snapshot. Dashboard reads these directly.
 *
 * Conflict on `(asset_type, snapshot_date, model_version)` → the new
 * row replaces the old. On same-day rerun, the latest calculation
 * wins — correct when cron retries after a partial failure and more
 * indicators are available the second time.
 */
export async function writeCompositeSnapshot(
  snapshot: CompositeSnapshotInsert,
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("composite_snapshots")
    .upsert(snapshot, {
      onConflict: "asset_type,snapshot_date,model_version",
    });

  if (error) {
    throw new Error(
      `writeCompositeSnapshot failed: ${error.message} (${error.code ?? "no code"})`,
    );
  }
}

/**
 * Insert one score-changelog row. Plain `.insert()` — see the
 * file-level TODO about the missing unique index.
 */
export async function writeScoreChangelog(
  entry: ScoreChangelogInsert,
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("score_changelog").insert(entry);

  if (error) {
    throw new Error(
      `writeScoreChangelog failed: ${error.message} (${error.code ?? "no code"})`,
    );
  }
}

/**
 * Append one cron-execution audit row. Every call produces a new
 * row — there is no dedupe.
 */
export async function writeIngestRun(run: IngestRunInsert): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("ingest_runs").insert(run);

  if (error) {
    throw new Error(
      `writeIngestRun failed: ${error.message} (${error.code ?? "no code"})`,
    );
  }
}

/**
 * Invalidate every cached read that depends on composite_snapshots.
 *
 * Called by the cron AFTER all writes succeed. `{ expire: 0 }` is the
 * Next 16 immediate-expiration form: the next dashboard request blocks
 * on fresh data rather than serving stale-while-revalidating. That's
 * the right semantic for a daily signal — a user opening the dashboard
 * 1 second after the cron finishes must see today's snapshot, not
 * yesterday's-while-we-revalidate.
 *
 * The single-argument form `revalidateTag('...')` is a TypeScript
 * error in Next 16; the `profile` parameter is required.
 */
export function invalidateMacroSnapshotCache(): void {
  revalidateTag(CACHE_TAGS.macroSnapshot, { expire: 0 });
}

export function invalidateChangelogCache(): void {
  revalidateTag(CACHE_TAGS.changelog, { expire: 0 });
}
