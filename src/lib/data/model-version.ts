import { cacheLife, cacheTag } from "next/cache";

import { MODEL_VERSION } from "@/lib/score-engine/weights";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

import { CACHE_TAGS } from "./tags";

/**
 * Readers for `model_version_history` — the cutover marker table
 * seeded by migration 0009 (blueprint §4.4, §8.5).
 *
 * The table is INSERT-only (one row per historical cutover). Two rows
 * for the foreseeable future — `v1.0.0` (2026-03-21) and `v2.0.0`
 * (2026-04-23). The UI surfaces them in two places:
 *
 * 1. Dashboard header badge: "모델 v2.0.0 — 2026-04-23 전환" with a
 *    hover tooltip documenting the Phase 1 → Phase 2 transition
 *    (blueprint §4.4 Step 3).
 * 2. `/asset/[slug]` trend chart: a vertical Recharts `ReferenceLine`
 *    at the v2 cutover date marks the v1→v2 model discontinuity
 *    (blueprint §3.4, §4.4 Step 4).
 *
 * ─ Admin client inside `'use cache'` ─────────────────────────────
 *
 * Same rationale as `indicators.ts`: this data is family-wide (the
 * cutover date is the same for every authenticated user), cookies()
 * would force-dynamic the caller, and the captured SupabaseClient is
 * created inside each function body (not captured) so serializability
 * stays intact.
 *
 * ─ Cache cadence ────────────────────────────────────────────────
 *
 * `cacheLife('days')` rather than `'weeks'` because a `MODEL_VERSION`
 * bump lands a new row and the dashboard must reflect it within a
 * day. The cron does NOT call `revalidateTag(modelVersion)` — cutover
 * rows are inserted manually as part of a migration deployment — so
 * the cache-life boundary is the only invalidation path. A day is
 * short enough that a human cutover rollout (which takes hours, not
 * minutes) becomes visible to all users before end-of-day.
 */

/**
 * Public row shape exported to the UI layer. Excludes `created_at`
 * (internal audit field — the UI wants the event date, not the
 * insertion wall-clock), and matches the partial-select shape used
 * across both readers so the Supabase-generated `Tables<>` type's
 * required-`created_at` field doesn't poison the narrower API.
 */
export interface ModelVersionRow {
  /** Semver string — e.g. "v2.0.0". */
  model_version: string;
  /** `YYYY-MM-DD`. The calendar date the version went live. */
  cutover_date: string;
  /** Free-form human description. `null` if the seed row omitted it. */
  notes: string | null;
}

function toModelVersionRow(row: {
  model_version: string;
  cutover_date: string;
  notes: string | null;
}): ModelVersionRow {
  return {
    model_version: row.model_version,
    cutover_date: row.cutover_date,
    notes: row.notes,
  };
}

/**
 * Returns every cutover row, oldest first.
 *
 * Oldest-first ordering mirrors the chronological reading order a
 * reviewer would expect ("v1 came first, then v2"). Callers that want
 * "current version only" should use {@link getCurrentModelCutoverDate}
 * or {@link getModelVersionRow} — don't hand-filter this list with
 * `.find()` in UI code, because the point of the dedicated readers is
 * to hit Postgres with an indexed `model_version` primary-key lookup
 * rather than scanning the full history in memory.
 */
export async function getModelVersionHistory(): Promise<ModelVersionRow[]> {
  "use cache";
  cacheTag(CACHE_TAGS.modelVersion);
  cacheLife("days");

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("model_version_history")
    .select("model_version, cutover_date, notes")
    .order("cutover_date", { ascending: true });

  if (error) {
    throw new Error(
      `getModelVersionHistory failed: ${error.message} (${error.code ?? "no code"})`,
    );
  }

  return (data ?? []).map((row) => ({
    model_version: row.model_version,
    cutover_date: row.cutover_date,
    notes: row.notes,
  }));
}

/**
 * Returns the cutover row whose `model_version` equals `version`, or
 * `null` if the row is not seeded yet.
 *
 * The `null` return is the graceful path the dashboard badge uses:
 * in a fresh local dev DB that hasn't run migration 0009, the badge
 * renders a minimal "v2.0.0" pill without a cutover-date line rather
 * than crashing the whole protected layout.
 *
 * @param version e.g. `"v2.0.0"` — typically {@link MODEL_VERSION}
 */
export async function getModelVersionRow(
  version: string,
): Promise<ModelVersionRow | null> {
  "use cache";
  cacheTag(CACHE_TAGS.modelVersion);
  cacheLife("days");

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("model_version_history")
    .select("model_version, cutover_date, notes")
    .eq("model_version", version)
    .maybeSingle();

  if (error) {
    throw new Error(
      `getModelVersionRow(${version}) failed: ${error.message} (${error.code ?? "no code"})`,
    );
  }

  return data ? toModelVersionRow(data) : null;
}

/**
 * Returns the cutover date of the current {@link MODEL_VERSION}, or
 * `null` if the row isn't seeded.
 *
 * Convenience wrapper for the trend-chart path on `/asset/[slug]`:
 * the server component fetches this string once and passes it to the
 * client Recharts wrapper as a `cutoverDate` prop. Callers that also
 * need the notes/version metadata should use
 * {@link getModelVersionRow} directly to avoid a second round-trip.
 */
export async function getCurrentModelCutoverDate(): Promise<string | null> {
  const row = await getModelVersionRow(MODEL_VERSION);
  return row?.cutover_date ?? null;
}
