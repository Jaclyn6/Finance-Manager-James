import { describe, expect, it } from "vitest";

import { ALL_SIGNALS } from "@/lib/score-engine/signals";

import {
  describeSignalSituation,
  resolveAlignmentBadge,
  SIGNAL_FULL_NAMES_KO,
  SIGNAL_LABELS_KO,
  SIGNAL_THRESHOLD_KO,
} from "./signal-labels";

/**
 * Step 8.5 helper tests. Pure functions — covers:
 * 1. Label maps are complete and in sync with the SignalName union.
 * 2. Alignment badge ladder enforces the chosen policy:
 *    - ≤ 1 → waiting (grey)
 *    - 2..4 → partial (amber)   ← project decision, documented in jsdoc
 *    - ≥ 5 → optimal (green)
 *
 * Per-asset signal membership lives on `signalsForAssetType` in
 * `src/lib/score-engine/signals.ts` and is exercised by the
 * exhaustiveness cases in that module's test file — no duplication here.
 */

describe("SIGNAL_LABELS_KO / SIGNAL_FULL_NAMES_KO / SIGNAL_THRESHOLD_KO", () => {
  it("covers every SignalName exhaustively", () => {
    for (const s of ALL_SIGNALS) {
      expect(SIGNAL_LABELS_KO[s]).toBeTypeOf("string");
      expect(SIGNAL_LABELS_KO[s].length).toBeGreaterThan(0);
      expect(SIGNAL_FULL_NAMES_KO[s]).toBeTypeOf("string");
      expect(SIGNAL_THRESHOLD_KO[s]).toBeTypeOf("string");
    }
  });
});

describe("resolveAlignmentBadge", () => {
  it("returns waiting/grey for count ≤ 1", () => {
    expect(resolveAlignmentBadge(0).tier).toBe("waiting");
    expect(resolveAlignmentBadge(1).tier).toBe("waiting");
    expect(resolveAlignmentBadge(0).label).toBe("대기 구간");
  });

  it("returns partial/amber for count in [2, 4]", () => {
    // Project decision: count=2 is the partial tier, NOT waiting.
    expect(resolveAlignmentBadge(2).tier).toBe("partial");
    expect(resolveAlignmentBadge(3).tier).toBe("partial");
    expect(resolveAlignmentBadge(4).tier).toBe("partial");
    expect(resolveAlignmentBadge(3).label).toMatch(/일부 충족/);
  });

  it("returns optimal/green for count ≥ 5", () => {
    expect(resolveAlignmentBadge(5).tier).toBe("optimal");
    expect(resolveAlignmentBadge(7).tier).toBe("optimal");
    expect(resolveAlignmentBadge(5).label).toMatch(/역사적 최적/);
  });

  it("handles null / NaN / negative by falling back to waiting", () => {
    expect(resolveAlignmentBadge(null).tier).toBe("waiting");
    expect(resolveAlignmentBadge(Number.NaN).tier).toBe("waiting");
    expect(resolveAlignmentBadge(-3).tier).toBe("waiting");
  });
});

describe("describeSignalSituation — partial-unknown copy", () => {
  it("EXTREME_FEAR names only the missing arm and shows the live VIX", () => {
    // The dashboard shows VIX on the weather strip right above the
    // tile — a blanket "VIX 또는 CNN F&G 부족" contradicted it.
    const text = describeSignalSituation("EXTREME_FEAR", {
      state: "unknown",
      inputs: { vix: 17.1, cnnFg: null },
      threshold: "VIX >= 35 || CNN_FG < 25",
    });
    expect(text).toContain("VIX 17.1");
    expect(text).toContain("발동 기준 아님");
    expect(text).toContain("CNN F&G 데이터가 없어");
    expect(text).not.toContain("VIX 또는");
  });

  it("EXTREME_FEAR both-null keeps the all-missing sentence", () => {
    const text = describeSignalSituation("EXTREME_FEAR", {
      state: "unknown",
      inputs: { vix: null, cnnFg: null },
      threshold: "VIX >= 35 || CNN_FG < 25",
    });
    expect(text).toBe("VIX와 CNN F&G 데이터가 모두 부족합니다.");
  });

  it("ECONOMY_INTACT partial-unknown stays neutral about the present arm", () => {
    // AND-semantics: the present arm may pass or refute, so the copy
    // must not claim 충족/미충족 — just 확인 + 판단 보류.
    const text = describeSignalSituation("ECONOMY_INTACT", {
      state: "unknown",
      inputs: { icsa: 197000, sahmCurrent: null },
      threshold: "ICSA < 300000 && SAHMCURRENT < 0.5",
    });
    expect(text).toContain("실업 청구 197,000건");
    expect(text).toContain("Sahm 데이터가 없어 판단 보류");
    expect(text).not.toContain("양호");
    // 확인 is the description line's word for the POSITIVE
    // confirmation — it must not leak into the neutral copy.
    expect(text).not.toContain("확인");
  });
});
