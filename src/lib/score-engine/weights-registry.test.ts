import { describe, expect, it } from "vitest";

import {
  CATEGORY_WEIGHTS,
  INDICATOR_CONFIG,
  MODEL_VERSION,
  PHASE2_FRED_REGIONAL_OVERLAY,
  SIGNAL_RULES_VERSION,
} from "./weights";
import {
  CURRENT_WEIGHTS_VERSION,
  WEIGHTS_REGISTRY,
  WEIGHTS_REGISTRY_KEYS,
  getWeights,
} from "./weights-registry";

/**
 * Phase 3.4 Step 1 acceptance criterion #1 — drift = 0.
 *
 * The "v2.0.0-baseline" registry entry must deep-equal the live
 * production constants in `weights.ts`. If anyone tweaks a weight in
 * `weights.ts` without bumping `MODEL_VERSION` AND adding a new
 * `WEIGHTS_REGISTRY` entry, this snapshot test fails CI loudly —
 * preventing silent score history corruption.
 */

describe("WEIGHTS_REGISTRY drift invariant", () => {
  const baseline = WEIGHTS_REGISTRY[CURRENT_WEIGHTS_VERSION]!;

  it("baseline modelVersion matches MODEL_VERSION", () => {
    expect(baseline.modelVersion).toBe(MODEL_VERSION);
  });

  it("baseline signalRulesVersion matches SIGNAL_RULES_VERSION", () => {
    expect(baseline.signalRulesVersion).toBe(SIGNAL_RULES_VERSION);
  });

  it("baseline categoryWeights deep-equals weights.ts CATEGORY_WEIGHTS", () => {
    expect(baseline.categoryWeights).toEqual(CATEGORY_WEIGHTS);
  });

  it("baseline indicatorConfig deep-equals weights.ts INDICATOR_CONFIG", () => {
    expect(baseline.indicatorConfig).toEqual(INDICATOR_CONFIG);
  });

  it("baseline regionalOverlayConfig deep-equals PHASE2_FRED_REGIONAL_OVERLAY", () => {
    expect(baseline.regionalOverlayConfig).toEqual(PHASE2_FRED_REGIONAL_OVERLAY);
  });

  it("CURRENT_WEIGHTS_VERSION is registered", () => {
    expect(WEIGHTS_REGISTRY[CURRENT_WEIGHTS_VERSION]).toBeDefined();
  });
});

describe("WEIGHTS_REGISTRY shape", () => {
  it("contains exactly the v2.0.0-baseline entry at Phase 3.4 base", () => {
    // When v2.1.0 ships (Phase 3.0 §6 drift check) the registry will
    // grow — bump this assertion in lockstep with the new entry.
    expect(WEIGHTS_REGISTRY_KEYS).toEqual(["v2.0.0-baseline"]);
  });

  it("every entry exposes the EngineWeights shape (modelVersion, signalRulesVersion, categoryWeights, indicatorConfig, regionalOverlayConfig)", () => {
    for (const [key, entry] of Object.entries(WEIGHTS_REGISTRY)) {
      expect(entry.modelVersion, `${key}.modelVersion`).toBeTypeOf("string");
      expect(
        entry.signalRulesVersion,
        `${key}.signalRulesVersion`,
      ).toBeTypeOf("string");
      expect(
        entry.categoryWeights,
        `${key}.categoryWeights`,
      ).toBeTypeOf("object");
      expect(
        entry.indicatorConfig,
        `${key}.indicatorConfig`,
      ).toBeTypeOf("object");
      expect(
        entry.regionalOverlayConfig,
        `${key}.regionalOverlayConfig`,
      ).toBeTypeOf("object");
    }
  });

  it("every entry covers all 5 asset types in categoryWeights", () => {
    const expectedAssetTypes = [
      "us_equity",
      "kr_equity",
      "crypto",
      "global_etf",
      "common",
    ];
    for (const [key, entry] of Object.entries(WEIGHTS_REGISTRY)) {
      const actual = Object.keys(entry.categoryWeights).sort();
      expect(actual, `${key}.categoryWeights asset coverage`).toEqual(
        expectedAssetTypes.slice().sort(),
      );
    }
  });

  it("every entry's categoryWeights for each asset type sums to 100", () => {
    for (const [key, entry] of Object.entries(WEIGHTS_REGISTRY)) {
      for (const [assetType, weights] of Object.entries(entry.categoryWeights)) {
        const total = Object.values(weights).reduce(
          (acc, n) => acc + (typeof n === "number" ? n : 0),
          0,
        );
        expect(total, `${key}.categoryWeights[${assetType}] sums to 100`).toBe(
          100,
        );
      }
    }
  });
});

describe("getWeights()", () => {
  it("returns the entry for a known version", () => {
    const w = getWeights(CURRENT_WEIGHTS_VERSION);
    expect(w.modelVersion).toBe(MODEL_VERSION);
  });

  it("throws for an unknown version with a helpful message listing known keys", () => {
    expect(() => getWeights("v999.0.0-fictional")).toThrow(
      /Unknown weights version.*Known: v2\.0\.0-baseline/,
    );
  });
});
