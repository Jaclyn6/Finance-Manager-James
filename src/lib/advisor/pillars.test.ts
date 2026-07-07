import { describe, expect, it } from "vitest";

import {
  evaluateMacroPillar,
  evaluateOnchainPillar,
  evaluateSentimentPillar,
  evaluateTrendPillar,
  evaluateVolatilityPillar,
} from "./pillars";

describe("evaluateTrendPillar", () => {
  it("above MA200 with golden cross → discount stance", () => {
    const result = evaluateTrendPillar({ close: 110, ma50: 105, ma200: 100 });
    expect(result.stance).toBe("discount");
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.strength).toBe(1);
    expect(result.missingInputs).toEqual([]);
  });

  it("below MA200 with death cross → reversal stance", () => {
    const result = evaluateTrendPillar({ close: 90, ma50: 95, ma200: 100 });
    expect(result.stance).toBe("reversal");
    expect(result.score).toBeLessThan(-0.5);
  });

  it("slightly above MA200, no ma50 → reduced strength, ma50 flagged", () => {
    const result = evaluateTrendPillar({ close: 101, ma50: null, ma200: 100 });
    expect(result.strength).toBeLessThan(1);
    expect(result.missingInputs).toEqual(["ma50"]);
    expect(result.score).toBeGreaterThan(0);
  });

  it("missing close or ma200 → strength 0, loud reason", () => {
    const result = evaluateTrendPillar({ close: null, ma50: 100, ma200: null });
    expect(result.strength).toBe(0);
    expect(result.score).toBe(0);
    expect(result.reasonKo).toMatch(/입력 누락/);
    expect(result.missingInputs).toContain("close");
    expect(result.missingInputs).toContain("ma200");
  });

  it("non-positive ma200 treated as missing (no divide-by-zero)", () => {
    const result = evaluateTrendPillar({ close: 100, ma50: 100, ma200: 0 });
    expect(result.strength).toBe(0);
    expect(result.score).toBe(0);
  });

  it("score is clamped to [-1, 1] on extreme ratios", () => {
    const up = evaluateTrendPillar({ close: 1e6, ma50: 1e6, ma200: 1 });
    const down = evaluateTrendPillar({ close: 1, ma50: 1, ma200: 1e6 });
    expect(up.score).toBeLessThanOrEqual(1);
    expect(down.score).toBeGreaterThanOrEqual(-1);
  });
});

describe("evaluateSentimentPillar", () => {
  it("extreme fear (F&G 5) → strong discount signal", () => {
    const result = evaluateSentimentPillar({ fearGreed: 5 });
    expect(result.stance).toBe("discount");
    expect(result.score).toBeCloseTo(0.8, 5);
    expect(result.reasonKo).toMatch(/극단적 공포/);
  });

  it("boundary F&G 25 → score 0, neutral", () => {
    const result = evaluateSentimentPillar({ fearGreed: 25 });
    expect(result.score).toBe(0);
    expect(result.stance).toBe("neutral");
  });

  it("mid-band F&G 50 → neutral, zero score", () => {
    const result = evaluateSentimentPillar({ fearGreed: 50 });
    expect(result.score).toBe(0);
    expect(result.stance).toBe("neutral");
  });

  it("extreme greed (F&G 95) → mild reversal signal", () => {
    const result = evaluateSentimentPillar({ fearGreed: 95 });
    expect(result.score).toBeLessThan(0);
    expect(result.score).toBeGreaterThanOrEqual(-0.5);
    expect(result.stance).toBe("reversal");
  });

  it("null F&G → strength 0, loud", () => {
    const result = evaluateSentimentPillar({ fearGreed: null });
    expect(result.strength).toBe(0);
    expect(result.reasonKo).toMatch(/입력 누락/);
  });
});

describe("evaluateVolatilityPillar", () => {
  it("VIX 40 panic spike → discount signal", () => {
    const result = evaluateVolatilityPillar({
      vix: 40,
      vixWow: null,
      drawdownPct: 0.2,
    });
    expect(result.stance).toBe("discount");
    expect(result.score).toBeGreaterThan(0.4);
    expect(result.reasonKo).toMatch(/패닉/);
  });

  it("VIX 40 spike already cooling (wow -5) → stronger discount than flat", () => {
    const cooling = evaluateVolatilityPillar({
      vix: 40,
      vixWow: -5,
      drawdownPct: 0.2,
    });
    const flat = evaluateVolatilityPillar({
      vix: 40,
      vixWow: 0,
      drawdownPct: 0.2,
    });
    expect(cooling.score).toBeGreaterThan(flat.score);
    expect(cooling.reasonKo).toMatch(/정점 통과/);
  });

  it("VIX 40 spike still building (wow +6) → tempered discount", () => {
    const building = evaluateVolatilityPillar({
      vix: 40,
      vixWow: 6,
      drawdownPct: 0.2,
    });
    const flat = evaluateVolatilityPillar({
      vix: 40,
      vixWow: 0,
      drawdownPct: 0.2,
    });
    expect(building.score).toBeLessThan(flat.score);
    expect(building.reasonKo).toMatch(/확산 진행/);
  });

  it("VIX 22 elevated band → mildly negative, neutral stance", () => {
    const result = evaluateVolatilityPillar({
      vix: 22,
      vixWow: null,
      drawdownPct: 0.12,
    });
    expect(result.score).toBeLessThan(0);
    expect(result.score).toBeGreaterThan(-0.2);
    expect(result.stance).toBe("neutral");
  });

  it("calm VIX 14 + deep drawdown 15% → slow-bleed reversal signal", () => {
    const result = evaluateVolatilityPillar({
      vix: 14,
      vixWow: null,
      drawdownPct: 0.15,
    });
    expect(result.stance).toBe("reversal");
    expect(result.score).toBe(-0.4);
    expect(result.reasonKo).toMatch(/공포 없는/);
  });

  it("calm VIX 14 + shallow drawdown → neutral", () => {
    const result = evaluateVolatilityPillar({
      vix: 14,
      vixWow: 1,
      drawdownPct: 0.03,
    });
    expect(result.score).toBe(0);
    expect(result.stance).toBe("neutral");
  });

  it("calm VIX + null drawdown/wow → neutral, both flagged missing", () => {
    const result = evaluateVolatilityPillar({
      vix: 14,
      vixWow: null,
      drawdownPct: null,
    });
    expect(result.score).toBe(0);
    expect(result.missingInputs).toEqual(["drawdownPct", "vixWow"]);
  });

  it("null VIX → strength 0, loud", () => {
    const result = evaluateVolatilityPillar({
      vix: null,
      vixWow: null,
      drawdownPct: 0.1,
    });
    expect(result.strength).toBe(0);
    expect(result.reasonKo).toMatch(/입력 누락/);
  });
});

describe("evaluateMacroPillar", () => {
  const healthy = {
    macroScore: 70,
    sahm: 0.03,
    t10y2y: 0.6,
    hySpread: 2.8,
    hySpreadWow: null,
  };
  const recession = {
    macroScore: 30,
    sahm: 0.7,
    t10y2y: -0.8,
    hySpread: 7.5,
    hySpreadWow: null,
  };

  it("healthy macro across the board → discount stance", () => {
    const result = evaluateMacroPillar(healthy);
    expect(result.stance).toBe("discount");
    expect(result.score).toBeGreaterThan(0.2);
    expect(result.strength).toBe(1);
  });

  it("recession signals across the board → strong reversal stance", () => {
    const result = evaluateMacroPillar(recession);
    expect(result.stance).toBe("reversal");
    expect(result.score).toBeLessThan(-0.5);
    expect(result.reasonKo).toMatch(/침체 트리거 발동/);
    expect(result.reasonKo).toMatch(/역전/);
  });

  it("Sahm rule at exactly 0.5 counts as triggered", () => {
    const result = evaluateMacroPillar({
      macroScore: null,
      sahm: 0.5,
      t10y2y: null,
      hySpread: null,
      hySpreadWow: null,
    });
    expect(result.score).toBe(-1);
  });

  it("partial inputs: averages available, coverage-scaled strength", () => {
    const result = evaluateMacroPillar({
      macroScore: 60,
      sahm: null,
      t10y2y: null,
      hySpread: null,
      hySpreadWow: null,
    });
    expect(result.strength).toBe(0.25);
    expect(result.missingInputs).toEqual(["sahm", "t10y2y", "hySpread"]);
    expect(result.score).toBeCloseTo(0.2, 5);
  });

  it("all inputs null → strength 0, loud", () => {
    const result = evaluateMacroPillar({
      macroScore: null,
      sahm: null,
      t10y2y: null,
      hySpread: null,
      hySpreadWow: null,
    });
    expect(result.strength).toBe(0);
    expect(result.reasonKo).toMatch(/입력 누락/);
  });
});

describe("evaluateMacroPillar — HY spread direction (video rule)", () => {
  const base = { macroScore: null, sahm: null, t10y2y: null };

  it("spread 4.6 turned down (wow -0.4) → 꺾임 buy-signal, discount sub-read", () => {
    const result = evaluateMacroPillar({
      ...base,
      hySpread: 4.6,
      hySpreadWow: -0.4,
    });
    expect(result.score).toBeCloseTo(0.7, 5);
    expect(result.stance).toBe("discount");
    expect(result.reasonKo).toMatch(/꺾임/);
    expect(result.reasonKo).toMatch(/매수 신호/);
  });

  it("spread 4.6 still rising (wow +0.3) → stronger reversal than flat", () => {
    const rising = evaluateMacroPillar({
      ...base,
      hySpread: 4.6,
      hySpreadWow: 0.3,
    });
    const flat = evaluateMacroPillar({
      ...base,
      hySpread: 4.6,
      hySpreadWow: 0,
    });
    expect(rising.score).toBeLessThan(flat.score);
    expect(rising.reasonKo).toMatch(/확대 중/);
    expect(flat.reasonKo).toMatch(/신용 스트레스/);
  });

  it("spread 4.6 with unknown direction → level-based stress, wow flagged missing", () => {
    const result = evaluateMacroPillar({
      ...base,
      hySpread: 4.6,
      hySpreadWow: null,
    });
    expect(result.score).toBeLessThan(-0.4);
    expect(result.missingInputs).toContain("hySpreadWow");
  });

  it("caution band 3-4: direction nudges the sub-read", () => {
    const improving = evaluateMacroPillar({
      ...base,
      hySpread: 3.5,
      hySpreadWow: -0.2,
    });
    const worsening = evaluateMacroPillar({
      ...base,
      hySpread: 3.5,
      hySpreadWow: 0.2,
    });
    expect(improving.score).toBeGreaterThan(worsening.score);
    expect(improving.reasonKo).toMatch(/주의 구간/);
  });

  it("stable band <3 → positive sub-read regardless of wow", () => {
    const result = evaluateMacroPillar({
      ...base,
      hySpread: 2.5,
      hySpreadWow: 0.05,
    });
    expect(result.score).toBeGreaterThan(0);
    expect(result.reasonKo).toMatch(/안정/);
  });
});

describe("evaluateOnchainPillar", () => {
  it("deep-value MVRV-Z (-0.5) + capitulation SOPR (0.95) → strong discount", () => {
    const result = evaluateOnchainPillar({ mvrvZ: -0.5, sopr: 0.95 });
    expect(result.stance).toBe("discount");
    expect(result.score).toBeGreaterThan(0.5);
  });

  it("cycle-top MVRV-Z (6) → reversal stance", () => {
    const result = evaluateOnchainPillar({ mvrvZ: 6, sopr: 1.02 });
    expect(result.stance).toBe("reversal");
    expect(result.score).toBeLessThan(-0.2);
  });

  it("neutral zone MVRV-Z 2 → near-zero score", () => {
    const result = evaluateOnchainPillar({ mvrvZ: 2, sopr: null });
    expect(Math.abs(result.score)).toBeLessThan(0.15);
    expect(result.missingInputs).toEqual(["sopr"]);
    expect(result.strength).toBe(0.5);
  });

  it("both null → strength 0, loud", () => {
    const result = evaluateOnchainPillar({ mvrvZ: null, sopr: null });
    expect(result.strength).toBe(0);
    expect(result.reasonKo).toMatch(/입력 누락/);
  });
});

describe("pillar score invariants", () => {
  it("every pillar clamps score to [-1, 1] on extreme inputs", () => {
    const results = [
      evaluateTrendPillar({ close: 1e9, ma50: 1e9, ma200: 0.001 }),
      evaluateSentimentPillar({ fearGreed: -1e6 }),
      evaluateSentimentPillar({ fearGreed: 1e6 }),
      evaluateVolatilityPillar({ vix: 1e6, vixWow: 1e6, drawdownPct: 1 }),
      evaluateVolatilityPillar({ vix: 1e6, vixWow: -1e6, drawdownPct: 1 }),
      evaluateMacroPillar({
        macroScore: 1e6,
        sahm: -1e6,
        t10y2y: 1e6,
        hySpread: -1e6,
        hySpreadWow: -1e6,
      }),
      evaluateMacroPillar({
        macroScore: -1e6,
        sahm: 1e6,
        t10y2y: -1e6,
        hySpread: 1e6,
        hySpreadWow: 1e6,
      }),
      evaluateOnchainPillar({ mvrvZ: -1e6, sopr: 1e6 }),
    ];
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(-1);
      expect(r.score).toBeLessThanOrEqual(1);
      expect(r.strength).toBeGreaterThanOrEqual(0);
      expect(r.strength).toBeLessThanOrEqual(1);
    }
  });
});
