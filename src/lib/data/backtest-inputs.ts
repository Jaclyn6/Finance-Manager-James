import "server-only";

/**
 * Phase 3.4 Step 2 — DB loader for the backtest replay engine.
 *
 * Loads historical `composite_snapshots` rows for a given (asset_type,
 * date range, model_version) tuple and unpacks the
 * `contributing_indicators` JSONB into the typed `OriginalSnapshot`
 * shape that `runBacktest()` consumes.
 *
 * Reference: docs/phase3_4_backtest_blueprint.md §2.1, §9 Step 2
 *
 * Design:
 * 1. Single SELECT — no per-day round trip. The supabase client is
 *    given `.in()` / `.lte()` / `.gte()` filters and we slice the
 *    result into a `Map<date, OriginalSnapshot>` for O(1) lookup.
 * 2. Defensive parser — `contributing_indicators` is typed `Json`
 *    in the generated DB types. Anything off-shape is silently
 *    dropped per category (loud failure surfaces at the engine
 *    layer via the `gaps` field on each BacktestSnapshot).
 * 3. `import "server-only"` guard — admin client + service-role
 *    key must never reach client bundles.
 */

import type { CategoryName } from "@/lib/score-engine/types";
import type { OriginalSnapshot } from "@/lib/score-engine/backtest";
import type { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

type AssetType = Database["public"]["Enums"]["asset_type_enum"];
type SupabaseAdmin = ReturnType<typeof getSupabaseAdminClient>;

const KNOWN_CATEGORIES: ReadonlySet<CategoryName> = new Set([
  "macro",
  "technical",
  "onchain",
  "sentiment",
  "valuation",
  "regional_overlay",
]);

/**
 * Load original composite snapshots for the given asset_type + date
 * range + model_version. Returns a Map keyed by ISO YYYY-MM-DD so the
 * caller (engine orchestrator) can do O(1) lookups while iterating
 * the calendar date list.
 *
 * If multiple `model_version` rows exist for the same date (e.g. a
 * v2.0.0 → v2.1.0 cutover happened mid-range), only the row matching
 * `modelVersion` is returned. Caller decides which model_version to
 * pull — typically passes `MODEL_VERSION` from `weights.ts`.
 */
export async function loadOriginalSnapshots(
  supabase: SupabaseAdmin,
  assetType: AssetType,
  dateRange: { from: string; to: string },
  modelVersion: string,
): Promise<Map<string, OriginalSnapshot>> {
  const { data, error } = await supabase
    .from("composite_snapshots")
    .select(
      "snapshot_date, asset_type, model_version, score_0_100, band, contributing_indicators",
    )
    .eq("asset_type", assetType)
    .eq("model_version", modelVersion)
    .gte("snapshot_date", dateRange.from)
    .lte("snapshot_date", dateRange.to)
    .order("snapshot_date", { ascending: true });

  if (error) {
    throw new Error(
      `composite_snapshots SELECT failed: ${error.message} (${error.code ?? "no code"})`,
    );
  }

  const out = new Map<string, OriginalSnapshot>();
  for (const row of data ?? []) {
    const snap = parseCompositeRow(row);
    if (snap) out.set(snap.date, snap);
  }
  return out;
}

/**
 * Parse one composite_snapshots row into OriginalSnapshot. Returns
 * null on shape errors so the caller can skip silently rather than
 * blow up the whole batch. Defensive against the loose `Json` type
 * on `contributing_indicators`.
 *
 * Exported for unit tests.
 */
export function parseCompositeRow(row: {
  snapshot_date: string;
  asset_type: AssetType;
  model_version: string;
  score_0_100: number | null;
  band: string | null;
  contributing_indicators: unknown;
}): OriginalSnapshot | null {
  if (typeof row.snapshot_date !== "string") return null;

  const perCategory = parseContributingIndicators(row.contributing_indicators);

  return {
    date: row.snapshot_date,
    assetType: row.asset_type,
    modelVersion: row.model_version,
    score0to100: row.score_0_100,
    band: row.band,
    perCategory,
  };
}

/**
 * Defensive parser for `composite_snapshots.contributing_indicators`.
 * Expected shape: `{[CategoryName]: {score, weight, contribution}}`.
 * Silently drops keys that aren't recognized categories OR whose
 * values are off-shape. Returns `{}` on null / non-object input.
 *
 * Exported for unit tests.
 */
export function parseContributingIndicators(
  raw: unknown,
): OriginalSnapshot["perCategory"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: OriginalSnapshot["perCategory"] = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!KNOWN_CATEGORIES.has(key as CategoryName)) continue;
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const v = val as Record<string, unknown>;
    const score = typeof v.score === "number" ? v.score : null;
    const weight = typeof v.weight === "number" ? v.weight : 0;
    const contribution =
      typeof v.contribution === "number" ? v.contribution : 0;
    out[key as CategoryName] = {
      // CategoryContribution.score is `number` in types/types.ts —
      // null is unrepresentable. Use a sentinel `null as unknown as number`
      // here so the engine's `Number.isFinite` check correctly skips it.
      score: score === null ? (null as unknown as number) : score,
      weight,
      contribution,
    };
  }
  return out;
}
