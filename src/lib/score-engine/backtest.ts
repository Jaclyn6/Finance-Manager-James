import { clamp } from "./normalize";
import type {
  AssetType,
  CategoryContribution,
  CategoryName,
  CategoryScores,
  PerAssetCategoryWeights,
} from "./types";
import type { EngineWeights } from "./weights-registry";

/**
 * Phase 3.4 Step 2 — pure backtest replay engine.
 *
 * Takes a stream of historical `OriginalSnapshot`s (one per date) plus
 * a target `EngineWeights` snapshot, and re-weights the per-category
 * scores against the new weights. Returns a per-day comparison
 * (replayScore vs originalScore + delta) and summary stats.
 *
 * Reference: docs/phase3_4_backtest_blueprint.md §2.1, §9 Step 2
 *
 * MVP scope (Phase 3.4 base):
 * 1. Re-weight existing per-category scores stored in
 *    `composite_snapshots.contributing_indicators`. Each category's
 *    `score` is the aggregator's output at ingest time and is INDEPENDENT
 *    of the per-asset CATEGORY_WEIGHTS — only the FINAL weighting is
 *    swapped here. So replaying with `v2.0.0-baseline` weights against
 *    a snapshot written under `v2.0.0` must reproduce the original score
 *    within 0.01pp (Step 1 acceptance #2).
 * 2. Aggregator-level changes (INDICATOR_CONFIG.weights for macro,
 *    technical preferred-ticker selection, etc.) are NOT replayed —
 *    that requires re-aggregating from raw rows and is Phase 3.4.1
 *    OOS per blueprint §7.
 *
 * Design principles:
 * - PURE function. No DB, no env, no `server-only`. Caller pre-loads
 *   `OriginalSnapshot[]` from `backtest-inputs.ts` (the DB layer).
 * - Same null-propagation tenet as `composite-v2.ts`: if a category
 *   was null in the original snapshot, it stays null in replay.
 * - Loud failure: missing original snapshots for a date land as
 *   `replayScore: null` with a `gaps` entry, never a fabricated value.
 */

/**
 * Canonical CategoryName ordering — mirrors `composite-v2.ts` so
 * insertion order on emitted contributing maps stays stable.
 */
const CATEGORY_ORDER: readonly CategoryName[] = [
  "macro",
  "technical",
  "onchain",
  "sentiment",
  "valuation",
  "regional_overlay",
];

/**
 * One historical snapshot pulled from `composite_snapshots`. The
 * caller (`backtest-inputs.ts`) reads the full row and unpacks the
 * `contributing_indicators` JSONB into the typed shape below.
 */
export interface OriginalSnapshot {
  /** ISO YYYY-MM-DD. */
  date: string;
  /** asset_type in the source row. Caller filters; engine asserts. */
  assetType: AssetType;
  /** model_version that wrote this row. */
  modelVersion: string;
  /** Composite score at the time of writing. */
  score0to100: number | null;
  /** Band label (e.g. "비중 확대") at the time of writing. */
  band: string | null;
  /**
   * Per-category breakdown. `score` is the aggregator's output BEFORE
   * the cross-category weighting; replay re-weights these scores
   * against the new EngineWeights.
   */
  perCategory: Partial<Record<CategoryName, CategoryContribution>>;
}

/**
 * One row in the per-day output of `runBacktest`. Surfaces both the
 * replay result and the original for comparison + summary stats.
 */
export interface BacktestSnapshot {
  date: string;
  /** Replay-engine score using the chosen EngineWeights. Null if no inputs. */
  replayScore: number | null;
  /** Replay band (matches the score-band mapping at the engine layer). */
  replayBand: string | null;
  /** Per-category contributions under replay weights. */
  replayContributing: Partial<Record<CategoryName, CategoryContribution>>;
  /** Score from the historical composite_snapshots row. Null if no row. */
  originalScore: number | null;
  /** model_version that wrote the historical row. */
  originalModelVersion: string | null;
  /** replayScore - originalScore. Null if either side is null. */
  delta: number | null;
  /** Loud-failure surface — categories or rows missing for replay. */
  gaps: ReadonlyArray<string>;
}

export interface BacktestRequest {
  /** Must match a key in WEIGHTS_REGISTRY (or be a hashed custom-weights variant). */
  weightsVersion: string;
  /** The engine's MODEL_VERSION at request time — for audit only. */
  modelVersion: string;
  assetType: AssetType;
  /** Inclusive ISO YYYY-MM-DD range. */
  dateRange: { from: string; to: string };
}

export interface BacktestSummary {
  /** Calendar days in range (inclusive). */
  totalDays: number;
  /** Days where replay produced a non-null score. */
  daysWithReplay: number;
  /** Days missing the original snapshot OR all input categories. */
  daysMissingInputs: number;
  /** Mean(|replayScore - originalScore|) over days with both sides present. Null if no comparable days. */
  avgAbsDelta: number | null;
  /** Max |delta|. Null if no comparable days. */
  maxAbsDelta: number | null;
  /** Count of days where |delta| > 5pp — Phase 3.0 §4.4 MODEL_VERSION cutover trigger threshold. */
  daysAboveFivePp: number;
}

export interface BacktestResult {
  request: BacktestRequest;
  snapshots: BacktestSnapshot[];
  summary: BacktestSummary;
}

/**
 * Five-band mapping for the replay score. Mirrors the engine's
 * production banding from `lib/score-engine/bands.ts` (or wherever
 * the production score → band mapping lives) — duplicated here as a
 * pure function so backtest doesn't pull in a server-only module.
 *
 * Bands per PRD §7.4:
 *   0–19 강한 비중 축소 / 20–39 비중 축소 / 40–59 유지 /
 *   60–79 비중 확대 / 80–100 강한 비중 확대
 */
function scoreToBand(score: number | null): string | null {
  if (score === null) return null;
  if (!Number.isFinite(score)) return null;
  if (score >= 80) return "강한 비중 확대";
  if (score >= 60) return "비중 확대";
  if (score >= 40) return "유지";
  if (score >= 20) return "비중 축소";
  return "강한 비중 축소";
}

/**
 * Re-run the composite-v2 weighting against a single OriginalSnapshot
 * using the chosen EngineWeights. Returns the replay score + per-
 * category contributions. Pure mirror of `computeCompositeV2` but
 * driven by the snapshot's existing `perCategory.score` values
 * instead of by freshly-aggregated input rows.
 */
function reweightSnapshot(
  snapshot: OriginalSnapshot,
  categoryWeights: PerAssetCategoryWeights,
): {
  score: number | null;
  contributing: Partial<Record<CategoryName, CategoryContribution>>;
  missingCategories: CategoryName[];
} {
  const present: Array<{
    category: CategoryName;
    score: number;
    rawWeight: number;
  }> = [];
  const missing: CategoryName[] = [];

  for (const category of CATEGORY_ORDER) {
    const rawWeight = categoryWeights[category];
    if (
      typeof rawWeight !== "number" ||
      !Number.isFinite(rawWeight) ||
      rawWeight <= 0
    ) {
      // Not applicable for this asset type — skip silently.
      continue;
    }
    const cat = snapshot.perCategory[category];
    if (
      !cat ||
      cat.score === null ||
      cat.score === undefined ||
      !Number.isFinite(cat.score)
    ) {
      missing.push(category);
      continue;
    }
    present.push({ category, score: cat.score, rawWeight });
  }

  if (present.length === 0) {
    // No applicable categories had data — orchestrator routes this to
    // `daysMissingInputs` via the `score === null` guard. The live
    // dashboard returns 50 here (composite-v2.ts) for UX reasons; the
    // backtest must NOT, because a fabricated 50 would inflate
    // daysWithReplay and produce spurious deltas.
    return {
      score: null,
      contributing: {},
      missingCategories: missing,
    };
  }

  const rawSum = present.reduce((acc, { rawWeight }) => acc + rawWeight, 0);
  if (!Number.isFinite(rawSum) || rawSum <= 0) {
    return {
      score: null,
      contributing: {},
      missingCategories: missing,
    };
  }

  const contributing: Partial<Record<CategoryName, CategoryContribution>> = {};
  let composite = 0;

  for (const { category, score, rawWeight } of present) {
    const normalizedWeight = rawWeight / rawSum;
    const contribution = score * normalizedWeight;
    composite += contribution;
    contributing[category] = {
      score,
      weight: normalizedWeight,
      contribution,
    };
  }

  return {
    score: clamp(composite, 0, 100),
    contributing,
    missingCategories: missing,
  };
}

/**
 * Run the backtest replay over a pre-loaded list of original
 * snapshots. The orchestrator emits one `BacktestSnapshot` per
 * calendar day in the request range — including days with NO
 * historical snapshot (those land as gap rows so the chart x-axis
 * is dense and the user can see when the engine had no opinion).
 *
 * Caller supplies:
 * @param request          The full BacktestRequest (asset_type, range, etc.).
 * @param weights          Resolved EngineWeights (caller looked up the registry).
 * @param originalsByDate  Map from ISO YYYY-MM-DD → OriginalSnapshot.
 *                         Pre-loaded by `backtest-inputs.ts`.
 * @param dateList         The calendar dates in range, ordered ascending.
 *                         Caller decides skip-weekends policy.
 */
export function runBacktest(
  request: BacktestRequest,
  weights: EngineWeights,
  originalsByDate: ReadonlyMap<string, OriginalSnapshot>,
  dateList: ReadonlyArray<string>,
): BacktestResult {
  const categoryWeights = weights.categoryWeights[request.assetType];
  const snapshots: BacktestSnapshot[] = [];

  let daysWithReplay = 0;
  let daysMissingInputs = 0;
  let absDeltaSum = 0;
  let comparableDays = 0;
  let maxAbsDelta = 0;
  let daysAboveFivePp = 0;

  for (const date of dateList) {
    const original = originalsByDate.get(date);

    if (!original) {
      daysMissingInputs++;
      snapshots.push({
        date,
        replayScore: null,
        replayBand: null,
        replayContributing: {},
        originalScore: null,
        originalModelVersion: null,
        delta: null,
        gaps: [
          `composite_snapshots row missing for ${request.assetType} on ${date}`,
        ],
      });
      continue;
    }

    const reweighted = reweightSnapshot(original, categoryWeights);
    const gaps = reweighted.missingCategories.map(
      (c) => `${c} category null on ${date}`,
    );

    if (reweighted.score === null) {
      daysMissingInputs++;
      snapshots.push({
        date,
        replayScore: null,
        replayBand: null,
        replayContributing: {},
        originalScore: original.score0to100,
        originalModelVersion: original.modelVersion,
        delta: null,
        gaps,
      });
      continue;
    }

    daysWithReplay++;

    let delta: number | null = null;
    if (
      original.score0to100 !== null &&
      Number.isFinite(original.score0to100)
    ) {
      delta = reweighted.score - original.score0to100;
      const absDelta = Math.abs(delta);
      absDeltaSum += absDelta;
      comparableDays++;
      if (absDelta > maxAbsDelta) maxAbsDelta = absDelta;
      if (absDelta > 5) daysAboveFivePp++;
    }

    snapshots.push({
      date,
      replayScore: reweighted.score,
      replayBand: scoreToBand(reweighted.score),
      replayContributing: reweighted.contributing,
      originalScore: original.score0to100,
      originalModelVersion: original.modelVersion,
      delta,
      gaps,
    });
  }

  const summary: BacktestSummary = {
    totalDays: dateList.length,
    daysWithReplay,
    daysMissingInputs,
    avgAbsDelta: comparableDays === 0 ? null : absDeltaSum / comparableDays,
    maxAbsDelta: comparableDays === 0 ? null : maxAbsDelta,
    daysAboveFivePp,
  };

  return { request, snapshots, summary };
}

/**
 * Helper: build the inclusive date list for a range. Caller decides
 * weekend handling — the backtest engine itself is calendar-agnostic.
 *
 * For the Phase 3.4 UI default we'll skip weekends for equity asset
 * types (they have no market data) but include weekends for crypto
 * (24/7). That decision lives in `backtest-inputs.ts` or the API
 * route, not here.
 */
export function buildInclusiveDateRange(
  fromIso: string,
  toIso: string,
): string[] {
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return [];
  }
  if (to.getTime() < from.getTime()) return [];

  const out: string[] = [];
  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/**
 * Helper: filter a date list to weekdays only (Mon-Fri). Suitable
 * default for equity asset types. Crypto callers skip this filter.
 */
export function filterToWeekdays(dates: ReadonlyArray<string>): string[] {
  return dates.filter((iso) => {
    const d = new Date(`${iso}T00:00:00Z`);
    const dow = d.getUTCDay(); // 0 = Sun, 6 = Sat
    return dow !== 0 && dow !== 6;
  });
}
