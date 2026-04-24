import { describe, expect, it } from "vitest";

import { ALL_SIGNALS } from "@/lib/score-engine/signals";

import {
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
