import { cacheLife, cacheTag } from "next/cache";

import { MODEL_VERSION } from "@/lib/score-engine/weights";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { computeDateWindow } from "@/lib/utils/date";
import type { Tables } from "@/types/database";

import { CACHE_TAGS } from "./tags";

/**
 * Score-changelog reader for the `/changelog?date=` page.
 *
 * See the design notes on admin-client use in
 * `src/lib/data/indicators.ts` — same rationale applies here: the
 * changelog data is family-wide (not per-user), and per-user
 * authentication is enforced at the proxy before this reader runs.
 *
 * ─ Cache strategy ────────────────────────────────────────────────
 *
 * Tag: `changelog` (distinct from `macro-snapshot`). The cron
 * invalidates the two tags separately — a composite_snapshots write
 * doesn't always produce a changelog row (first-ever snapshot has no
 * prior day to delta against), and future data maintenance jobs might
 * touch one table without the other.
 *
 * `cacheLife('days')` matches the 24h cron cadence. A longer life
 * would be safe for deep-historical windows (rows don't change once
 * written), but the changelog page is typically anchored on recent
 * dates where freshness matters more than longevity.
 *
 * Like the composite-snapshot readers in `indicators.ts`, this reader
 * filters on `model_version = MODEL_VERSION` so a version bump cleanly
 * separates histories: the user sees the current model's changelog
 * only. Old-version rows stay in the table for backtest replay but
 * don't leak into the live UI.
 */

type ScoreChangelogRow = Tables<"score_changelog">;

/** Default window size (days on each side of the anchor date). */
const DEFAULT_WINDOW_DAYS = 14;

/**
 * Returns changelog rows whose `change_date` is within ±`windowDays`
 * of `anchorDate`, ordered newest-first.
 *
 * PRD §11.6 framing: "최근 변화" — show a human-readable band-change
 * history around the selected date. Default window of 14 days gives
 * ~2 weeks of context without overwhelming the page.
 *
 * @param anchorDate `YYYY-MM-DD` — already validated by the page-level
 *   `searchParams` handler.
 * @param windowDays Non-negative integer; out-of-range input falls back
 *   to a zero-width window (returns just the anchor-day rows, if any).
 */
export async function getChangelogAroundDate(
  anchorDate: string,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<ScoreChangelogRow[]> {
  "use cache";
  cacheTag(CACHE_TAGS.changelog);
  cacheLife("days");

  const { start, end } = computeDateWindow(anchorDate, windowDays);

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("score_changelog")
    .select("*")
    .eq("model_version", MODEL_VERSION)
    .gte("change_date", start)
    .lte("change_date", end)
    .order("change_date", { ascending: false });

  if (error) {
    throw new Error(
      `getChangelogAroundDate(${anchorDate}, ${windowDays}) failed: ${error.message} (${error.code ?? "no code"})`,
    );
  }

  return data ?? [];
}
