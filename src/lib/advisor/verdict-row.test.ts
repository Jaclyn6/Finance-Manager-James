import { describe, expect, it } from "vitest";

import type { AdvisorVerdict } from "./types";
import { ADVISOR_ENGINE_VERSION } from "./verdict";
import { verdictToRow } from "./verdict-row";

const VERDICT: AdvisorVerdict = {
  label: "discount_zone",
  drawdown: {
    currentDate: "2026-07-07",
    currentClose: 90,
    peakDate: "2026-03-02",
    peakClose: 105,
    drawdownPct: 0.1428,
    daysSincePeak: 127,
    maxDrawdownPct: 0.19,
    maxDrawdownTroughDate: "2026-05-11",
    sampleCount: 300,
  },
  netScore: 0.41,
  confidence: 0.72,
  pillars: [],
  headlineKo: "고점(2026-03-02) 대비 -14.3% — 조정(할인) 구간으로 판단, 근거 우세",
  evidenceKo: ["근거 A", "근거 B"],
};

describe("verdictToRow", () => {
  it("lifts scalars and stamps the engine version", () => {
    const row = verdictToRow("us_equity", "2026-07-08", VERDICT);
    expect(row).toMatchObject({
      asset_type: "us_equity",
      verdict_date: "2026-07-08",
      engine_version: ADVISOR_ENGINE_VERSION,
      label: "discount_zone",
      net_score: 0.41,
      confidence: 0.72,
      drawdown_pct: 0.1428,
      peak_date: "2026-03-02",
    });
  });

  it("keeps the full verdict in evidence (headline + sentences survive)", () => {
    const row = verdictToRow("crypto", "2026-07-08", VERDICT);
    const evidence = row.evidence as unknown as AdvisorVerdict;
    expect(evidence.headlineKo).toBe(VERDICT.headlineKo);
    expect(evidence.evidenceKo).toEqual(["근거 A", "근거 B"]);
    expect(evidence.drawdown?.maxDrawdownPct).toBe(0.19);
  });

  it("null drawdown → null scalar columns, not fabricated values", () => {
    const row = verdictToRow("common", "2026-07-08", {
      ...VERDICT,
      label: "insufficient_data",
      drawdown: null,
      netScore: null,
      confidence: 0,
    });
    expect(row.drawdown_pct).toBeNull();
    expect(row.peak_date).toBeNull();
    expect(row.net_score).toBeNull();
    expect(row.confidence).toBe(0);
  });
});
