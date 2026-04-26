import { describe, expect, it } from "vitest";

import {
  buildInclusiveDateRange,
  filterToWeekdays,
  runBacktest,
  type BacktestRequest,
  type OriginalSnapshot,
} from "./backtest";
import { WEIGHTS_REGISTRY } from "./weights-registry";

/**
 * Phase 3.4 Step 2 fixture tests.
 *
 * Strategy:
 *   - Use `WEIGHTS_REGISTRY["v2.0.0-baseline"]` as the replay weights
 *     and synthesize OriginalSnapshots whose per-category scores were
 *     produced by the SAME weights → replay must match within 0.01pp
 *     (Step 1 acceptance criterion #2).
 *   - Synthesize edge cases for null categories, missing dates, gaps,
 *     and >5pp deviation (forced via mismatched weight version).
 */

const BASELINE = WEIGHTS_REGISTRY["v2.0.0-baseline"]!;

/**
 * Build an OriginalSnapshot whose composite score is the EXACT
 * weighted-sum of the per-category scores under the v2.0.0-baseline
 * categoryWeights. Lets the test assert the replay reproduces it.
 */
function buildSnapshot(opts: {
  date: string;
  assetType: "us_equity" | "kr_equity" | "crypto" | "global_etf";
  categoryScores: Partial<
    Record<
      | "macro"
      | "technical"
      | "onchain"
      | "sentiment"
      | "valuation"
      | "regional_overlay",
      number | null
    >
  >;
}): OriginalSnapshot {
  const weights = BASELINE.categoryWeights[opts.assetType];

  // Replicate the composite-v2 weighted-sum.
  const present = Object.entries(opts.categoryScores).filter(
    ([cat, score]) =>
      typeof weights[cat as keyof typeof weights] === "number" &&
      (weights[cat as keyof typeof weights] ?? 0) > 0 &&
      typeof score === "number",
  ) as Array<[keyof typeof weights, number]>;

  const rawSum = present.reduce(
    (acc, [cat]) => acc + (weights[cat] as number),
    0,
  );

  const perCategory: OriginalSnapshot["perCategory"] = {};
  let composite = 0;
  for (const [cat, score] of present) {
    const norm = (weights[cat] as number) / rawSum;
    const contribution = score * norm;
    composite += contribution;
    perCategory[cat] = { score, weight: norm, contribution };
  }

  return {
    date: opts.date,
    assetType: opts.assetType,
    modelVersion: "v2.0.0",
    score0to100: present.length === 0 ? 50 : composite,
    band: null,
    perCategory,
  };
}

const REQUEST: BacktestRequest = {
  weightsVersion: "v2.0.0-baseline",
  modelVersion: "v2.0.0",
  assetType: "us_equity",
  dateRange: { from: "2026-04-20", to: "2026-04-24" },
};

describe("runBacktest — drift = 0 case", () => {
  it("replay reproduces original scores within 0.01pp when weights are unchanged", () => {
    // 5-day fixture, all 4 categories present with reasonable scores.
    const dates = ["2026-04-20", "2026-04-21", "2026-04-22", "2026-04-23", "2026-04-24"];
    const originalsByDate = new Map<string, OriginalSnapshot>();
    for (const d of dates) {
      originalsByDate.set(
        d,
        buildSnapshot({
          date: d,
          assetType: "us_equity",
          categoryScores: {
            macro: 47.3,
            technical: 53.2,
            sentiment: 41.8,
            valuation: 50,
          },
        }),
      );
    }

    const result = runBacktest(REQUEST, BASELINE, originalsByDate, dates);

    expect(result.snapshots).toHaveLength(5);
    for (const snap of result.snapshots) {
      expect(snap.replayScore).not.toBeNull();
      expect(snap.originalScore).not.toBeNull();
      expect(snap.delta).not.toBeNull();
      expect(Math.abs(snap.delta!)).toBeLessThan(0.01);
    }
    expect(result.summary.totalDays).toBe(5);
    expect(result.summary.daysWithReplay).toBe(5);
    expect(result.summary.daysMissingInputs).toBe(0);
    expect(result.summary.avgAbsDelta).not.toBeNull();
    expect(result.summary.avgAbsDelta!).toBeLessThan(0.01);
    expect(result.summary.maxAbsDelta).not.toBeNull();
    expect(result.summary.maxAbsDelta!).toBeLessThan(0.01);
    expect(result.summary.daysAboveFivePp).toBe(0);
  });
});

describe("runBacktest — null-category propagation", () => {
  it("treats a null category as missing and renormalizes remaining weights", () => {
    const date = "2026-04-22";
    const original = buildSnapshot({
      date,
      assetType: "us_equity",
      categoryScores: {
        macro: 60,
        technical: 40,
        sentiment: null, // null
        valuation: 50,
      },
    });
    const result = runBacktest(
      REQUEST,
      BASELINE,
      new Map([[date, original]]),
      [date],
    );

    expect(result.snapshots).toHaveLength(1);
    const snap = result.snapshots[0]!;
    expect(snap.replayScore).not.toBeNull();
    expect(snap.gaps.some((g) => g.includes("sentiment"))).toBe(true);
    // 3-category renormalization: macro=45, technical=35, valuation=10 → sum 90
    // composite = (60*45 + 40*35 + 50*10) / 90 = (2700 + 1400 + 500) / 90 = 4600/90 ≈ 51.11
    expect(snap.replayScore).toBeCloseTo(51.11, 1);
  });

  it("returns null replay score (and routes to daysMissingInputs) when ALL applicable categories are null", () => {
    const date = "2026-04-22";
    const original: OriginalSnapshot = {
      date,
      assetType: "us_equity",
      modelVersion: "v2.0.0",
      score0to100: 50,
      band: null,
      perCategory: {
        macro: { score: null as unknown as number, weight: 0, contribution: 0 },
        technical: {
          score: null as unknown as number,
          weight: 0,
          contribution: 0,
        },
      },
    };
    const result = runBacktest(
      REQUEST,
      BASELINE,
      new Map([[date, original]]),
      [date],
    );
    // The live dashboard substitutes 50 here for UX; backtest must NOT —
    // a fabricated score would inflate daysWithReplay and produce a
    // spurious 50-vs-original delta entry.
    expect(result.snapshots[0]!.replayScore).toBeNull();
    expect(result.snapshots[0]!.delta).toBeNull();
    expect(result.snapshots[0]!.gaps.length).toBeGreaterThan(0);
    expect(result.summary.daysMissingInputs).toBe(1);
    expect(result.summary.daysWithReplay).toBe(0);
  });
});

describe("runBacktest — gap rows for missing dates", () => {
  it("emits a gap snapshot when no original row exists for a date", () => {
    const dates = ["2026-04-20", "2026-04-21", "2026-04-22"];
    // Only the middle date is populated.
    const originalsByDate = new Map<string, OriginalSnapshot>();
    originalsByDate.set(
      "2026-04-21",
      buildSnapshot({
        date: "2026-04-21",
        assetType: "us_equity",
        categoryScores: { macro: 55, technical: 50, sentiment: 45, valuation: 50 },
      }),
    );
    const result = runBacktest(REQUEST, BASELINE, originalsByDate, dates);
    expect(result.snapshots).toHaveLength(3);
    expect(result.snapshots[0]!.replayScore).toBeNull();
    expect(result.snapshots[0]!.gaps.length).toBeGreaterThan(0);
    expect(result.snapshots[1]!.replayScore).not.toBeNull();
    expect(result.snapshots[2]!.replayScore).toBeNull();
    expect(result.summary.daysWithReplay).toBe(1);
    expect(result.summary.daysMissingInputs).toBe(2);
  });
});

describe("runBacktest — KR equity regional_overlay", () => {
  it("includes regional_overlay (kr_equity-specific) and excludes valuation/onchain (NA)", () => {
    const date = "2026-04-23";
    const original = buildSnapshot({
      date,
      assetType: "kr_equity",
      categoryScores: {
        macro: 50,
        technical: 60,
        regional_overlay: 40,
        sentiment: 55,
      },
    });
    const result = runBacktest(
      { ...REQUEST, assetType: "kr_equity" },
      BASELINE,
      new Map([[date, original]]),
      [date],
    );
    const snap = result.snapshots[0]!;
    expect(snap.replayScore).not.toBeNull();
    // KR weights: macro 45, technical 25, regional_overlay 20, sentiment 10 → sum 100.
    // composite = (50*45 + 60*25 + 40*20 + 55*10) / 100 = (2250+1500+800+550)/100 = 51.0
    expect(snap.replayScore).toBeCloseTo(51, 1);
    expect(snap.replayContributing.regional_overlay).toBeDefined();
    expect(snap.replayContributing.valuation).toBeUndefined();
    expect(snap.replayContributing.onchain).toBeUndefined();
  });
});

describe("buildInclusiveDateRange", () => {
  it("returns 5 ISO dates from 2026-04-20 through 2026-04-24", () => {
    expect(buildInclusiveDateRange("2026-04-20", "2026-04-24")).toEqual([
      "2026-04-20",
      "2026-04-21",
      "2026-04-22",
      "2026-04-23",
      "2026-04-24",
    ]);
  });

  it("returns single-day range when from == to", () => {
    expect(buildInclusiveDateRange("2026-04-20", "2026-04-20")).toEqual([
      "2026-04-20",
    ]);
  });

  it("returns empty when to < from", () => {
    expect(buildInclusiveDateRange("2026-04-22", "2026-04-20")).toEqual([]);
  });

  it("returns empty for malformed inputs", () => {
    expect(buildInclusiveDateRange("not-a-date", "2026-04-20")).toEqual([]);
    expect(buildInclusiveDateRange("2026-04-20", "not-a-date")).toEqual([]);
  });
});

describe("filterToWeekdays", () => {
  it("drops Saturday + Sunday", () => {
    // 2026-04-25 is a Saturday, 2026-04-26 is a Sunday.
    const all = buildInclusiveDateRange("2026-04-22", "2026-04-28");
    const weekdays = filterToWeekdays(all);
    expect(weekdays).toEqual([
      "2026-04-22", // Wed
      "2026-04-23", // Thu
      "2026-04-24", // Fri
      "2026-04-27", // Mon
      "2026-04-28", // Tue
    ]);
  });

  it("preserves a midweek-only range untouched", () => {
    const wednesdays = ["2026-04-22"];
    expect(filterToWeekdays(wednesdays)).toEqual(["2026-04-22"]);
  });
});
