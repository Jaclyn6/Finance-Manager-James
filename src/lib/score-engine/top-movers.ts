import type { CompositeResult } from "./types";

/**
 * Top-movers computation — diffs today's composite contributions vs
 * the prior snapshot's and picks the indicators that moved most.
 *
 * Feeds `score_changelog.top_movers` JSONB (§11.3 "변화 로그") so the
 * dashboard can display "오늘 점수가 3점 오른 주된 이유: VIX -2.3,
 * HY spread -0.9, DGS10 +0.5" without the UI recomputing from raw
 * indicator_readings.
 *
 * Pure / framework-agnostic — safe to unit-test without DB.
 */
export interface TopMover {
  /** Indicator key, e.g. "VIXCLS". */
  key: string;
  /** Contribution in the prior day's composite (0 if first-seen today). */
  prior_contribution: number;
  /** Contribution in today's composite (0 if dropped today). */
  current_contribution: number;
  /** current - prior. Sign indicates direction; magnitude indicates impact. */
  delta: number;
}

/**
 * Returns up to `limit` movers, sorted by `|delta|` descending.
 *
 * Tolerates:
 * - `prior === null | undefined` → treats all current keys as new
 *   (delta = current_contribution). First-ever snapshot is a no-op
 *   because the caller (cron) skips changelog writes when no prior
 *   snapshot row exists, but the function itself is defensive anyway.
 * - `prior` being a JSONB blob of unknown shape → best-effort parse;
 *   malformed entries silently drop to 0.
 * - Keys present in only one side — the missing side is treated as 0,
 *   so a newly-added indicator shows up with positive `delta` and a
 *   dropped indicator shows up with negative `delta`.
 */
export function computeTopMovers(
  current: CompositeResult["contributing"],
  prior: unknown,
  limit: number = 3,
): TopMover[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];

  const priorMap = parsePriorContributions(prior);

  const allKeys = new Set<string>([
    ...Object.keys(current),
    ...Object.keys(priorMap),
  ]);

  const movers: TopMover[] = [];
  for (const key of allKeys) {
    const cur = current[key]?.contribution ?? 0;
    const pri = priorMap[key] ?? 0;
    const delta = cur - pri;
    if (delta === 0) continue; // unchanged — not a mover
    movers.push({
      key,
      prior_contribution: pri,
      current_contribution: cur,
      delta,
    });
  }

  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return movers.slice(0, Math.floor(limit));
}

/**
 * Defensive parse of a Supabase JSONB column that's supposed to match
 * `CompositeResult["contributing"]` — `{ [key]: { score, weight,
 * contribution } }`. Only `contribution` matters here; score/weight
 * are left for future UI surfaces.
 */
function parsePriorContributions(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const c = (value as { contribution?: unknown }).contribution;
    if (typeof c === "number" && Number.isFinite(c)) {
      result[key] = c;
    }
  }
  return result;
}
