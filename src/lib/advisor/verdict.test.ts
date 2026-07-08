import { describe, expect, it } from "vitest";

import { computeAdvisorVerdict, PILLAR_WEIGHTS } from "./verdict";
import type { AdvisorInputs, DailyClose } from "./types";

/** Builds a daily series ending at the given drawdown from a 100→peak run. */
function seriesWithDrawdown(drawdownPct: number): DailyClose[] {
  const points: DailyClose[] = [];
  for (let i = 0; i < 40; i++) {
    const month = String(Math.floor(i / 28) + 1).padStart(2, "0");
    const day = String((i % 28) + 1).padStart(2, "0");
    points.push({ date: `2026-${month}-${day}`, close: 100 });
  }
  points.push({ date: "2026-03-01", close: 200 });
  points.push({ date: "2026-03-02", close: 200 * (1 - drawdownPct) });
  return points;
}

function inputs(partial: Partial<AdvisorInputs>): AdvisorInputs {
  return {
    assetClass: "equity",
    series: seriesWithDrawdown(0.15),
    trend: { close: null, ma50: null, ma200: null },
    sentiment: { fearGreed: null },
    volatility: { vix: null, vixWow: null },
    macro: {
      macroScore: null,
      sahm: null,
      t10y2y: null,
      hySpread: null,
      hySpreadWow: null,
    },
    onchain: { mvrvZ: null, sopr: null },
    ...partial,
  };
}

const DISCOUNT_CONTEXT: Partial<AdvisorInputs> = {
  trend: { close: 170, ma50: 168, ma200: 160 }, // above MA200, golden cross
  sentiment: { fearGreed: 12 }, // extreme fear
  volatility: { vix: 34, vixWow: null }, // panic spike
  macro: {
    macroScore: 68,
    sahm: 0.05,
    t10y2y: 0.5,
    hySpread: 2.8,
    hySpreadWow: null,
  },
};

const REVERSAL_CONTEXT: Partial<AdvisorInputs> = {
  trend: { close: 150, ma50: 165, ma200: 180 }, // below MA200, death cross
  sentiment: { fearGreed: 55 }, // no capitulation
  volatility: { vix: 16, vixWow: null }, // calm slow bleed
  macro: {
    macroScore: 28,
    sahm: 0.65,
    t10y2y: -0.7,
    hySpread: 6.8,
    hySpreadWow: null,
  },
};

describe("computeAdvisorVerdict — label bands", () => {
  it("too-thin series → insufficient_data, confidence 0", () => {
    const verdict = computeAdvisorVerdict(
      inputs({ series: [{ date: "2026-01-01", close: 100 }] }),
    );
    expect(verdict.label).toBe("insufficient_data");
    expect(verdict.confidence).toBe(0);
    expect(verdict.drawdown).toBeNull();
    expect(verdict.headlineKo).toMatch(/데이터가 부족/);
  });

  it("drawdown < 5% → no_drawdown regardless of pillar votes", () => {
    const verdict = computeAdvisorVerdict(
      inputs({ series: seriesWithDrawdown(0.02), ...REVERSAL_CONTEXT }),
    );
    expect(verdict.label).toBe("no_drawdown");
  });

  it("drawdown 5-10% with benign pillars → healthy_pullback", () => {
    const verdict = computeAdvisorVerdict(
      inputs({ series: seriesWithDrawdown(0.07), ...DISCOUNT_CONTEXT }),
    );
    expect(verdict.label).toBe("healthy_pullback");
  });

  it("drawdown 5-10% with strong reversal evidence → early reversal_risk", () => {
    const verdict = computeAdvisorVerdict(
      inputs({ series: seriesWithDrawdown(0.07), ...REVERSAL_CONTEXT }),
    );
    expect(verdict.label).toBe("reversal_risk");
    expect(verdict.headlineKo).toMatch(/낙폭은 얕지만/);
  });

  it("deep drawdown + discount evidence → discount_zone", () => {
    const verdict = computeAdvisorVerdict(
      inputs({ series: seriesWithDrawdown(0.18), ...DISCOUNT_CONTEXT }),
    );
    expect(verdict.label).toBe("discount_zone");
    expect(verdict.netScore).toBeGreaterThan(0.2);
  });

  it("deep drawdown + reversal evidence → reversal_risk", () => {
    const verdict = computeAdvisorVerdict(
      inputs({ series: seriesWithDrawdown(0.18), ...REVERSAL_CONTEXT }),
    );
    expect(verdict.label).toBe("reversal_risk");
    expect(verdict.netScore).toBeLessThan(-0.2);
  });

  it("deep drawdown + all pillars missing → mixed_signals, netScore null", () => {
    const verdict = computeAdvisorVerdict(inputs({}));
    expect(verdict.label).toBe("mixed_signals");
    expect(verdict.netScore).toBeNull();
    expect(verdict.confidence).toBe(0);
  });
});

describe("computeAdvisorVerdict — pillar wiring", () => {
  it("equity verdict has 4 pillars (no onchain)", () => {
    const verdict = computeAdvisorVerdict(inputs(DISCOUNT_CONTEXT));
    expect(verdict.pillars.map((p) => p.pillar).sort()).toEqual([
      "macro",
      "sentiment",
      "trend",
      "volatility",
    ]);
  });

  it("crypto verdict swaps volatility out for onchain (mirrors PILLAR_WEIGHTS)", () => {
    const verdict = computeAdvisorVerdict(
      inputs({
        assetClass: "crypto",
        ...DISCOUNT_CONTEXT,
        onchain: { mvrvZ: -0.2, sopr: 0.97 },
      }),
    );
    expect(verdict.pillars.map((p) => p.pillar).sort()).toEqual([
      "macro",
      "onchain",
      "sentiment",
      "trend",
    ]);
  });

  it("volatility pillar receives the computed drawdownPct (slow-bleed path)", () => {
    // calm VIX + 15% drawdown must produce the slow-bleed reversal reason
    const verdict = computeAdvisorVerdict(
      inputs({ volatility: { vix: 14, vixWow: null } }),
    );
    const vol = verdict.pillars.find((p) => p.pillar === "volatility")!;
    expect(vol.reasonKo).toMatch(/공포 없는/);
  });

  it("missing pillars drop out and weight renormalizes over the rest", () => {
    // Only macro present, strongly positive → netScore should equal the
    // macro score alone (weight renormalized to 1).
    const verdict = computeAdvisorVerdict(
      inputs({
        macro: {
          macroScore: 90,
          sahm: null,
          t10y2y: null,
          hySpread: null,
          hySpreadWow: null,
        },
      }),
    );
    const macro = verdict.pillars.find((p) => p.pillar === "macro")!;
    expect(verdict.netScore).toBeCloseTo(macro.score, 10);
  });

  it("evidenceKo is ordered by weighted contribution and excludes empty pillars", () => {
    const verdict = computeAdvisorVerdict(inputs(REVERSAL_CONTEXT));
    expect(verdict.evidenceKo.length).toBe(4);
    // trend saturates at -1 × weight 0.30 = 0.30 contribution — beats
    // macro (≈0.78 × 0.35 ≈ 0.27) in this fixture, so trend leads.
    const trend = verdict.pillars.find((p) => p.pillar === "trend")!;
    expect(verdict.evidenceKo[0]).toBe(trend.reasonKo);
  });

  it("confidence reflects coverage: single pillar < full coverage", () => {
    const single = computeAdvisorVerdict(
      inputs({
        macro: {
          macroScore: 90,
          sahm: 0.05,
          t10y2y: 0.5,
          hySpread: 3,
          hySpreadWow: null,
        },
      }),
    );
    const full = computeAdvisorVerdict(inputs(DISCOUNT_CONTEXT));
    expect(single.confidence).toBeLessThan(full.confidence);
  });
});

describe("PILLAR_WEIGHTS invariants", () => {
  it("weights sum to 1 for every asset class", () => {
    for (const weights of Object.values(PILLAR_WEIGHTS)) {
      const sum = weights.reduce((s, w) => s + w.weight, 0);
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  it("netScore is always within [-1, 1] under extreme inputs", () => {
    const verdict = computeAdvisorVerdict(
      inputs({
        trend: { close: 1e9, ma50: 1e9, ma200: 1 },
        sentiment: { fearGreed: 0 },
        volatility: { vix: 1e6, vixWow: -1e6 },
        macro: {
          macroScore: 100,
          sahm: 0,
          t10y2y: 10,
          hySpread: 0,
          hySpreadWow: -1e6,
        },
      }),
    );
    expect(verdict.netScore).toBeGreaterThanOrEqual(-1);
    expect(verdict.netScore).toBeLessThanOrEqual(1);
    expect(verdict.confidence).toBeGreaterThanOrEqual(0);
    expect(verdict.confidence).toBeLessThanOrEqual(1);
  });
});
