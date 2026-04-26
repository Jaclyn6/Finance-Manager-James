import { describe, expect, it } from "vitest";

import {
  parseCompositeRow,
  parseContributingIndicators,
} from "./backtest-inputs";

/**
 * Phase 3.4 Step 2 unit tests for the network-free parser portion.
 * The Supabase loader (`loadOriginalSnapshots`) is integration-tested
 * via the `/api/backtest/run` route's e2e fixture in Step 4.
 */

describe("parseContributingIndicators", () => {
  it("returns {} on null / non-object / array input", () => {
    expect(parseContributingIndicators(null)).toEqual({});
    expect(parseContributingIndicators(undefined)).toEqual({});
    expect(parseContributingIndicators("not an object")).toEqual({});
    expect(parseContributingIndicators([])).toEqual({});
    expect(parseContributingIndicators(42)).toEqual({});
  });

  it("extracts well-formed category entries with score/weight/contribution", () => {
    const raw = {
      macro: { score: 47.3, weight: 0.45, contribution: 21.285 },
      technical: { score: 52.1, weight: 0.35, contribution: 18.235 },
      sentiment: { score: 50, weight: 0.1, contribution: 5 },
      valuation: { score: 50, weight: 0.1, contribution: 5 },
    };
    const parsed = parseContributingIndicators(raw);
    expect(parsed.macro?.score).toBe(47.3);
    expect(parsed.macro?.weight).toBe(0.45);
    expect(parsed.macro?.contribution).toBe(21.285);
    expect(parsed.technical?.score).toBe(52.1);
    expect(parsed.sentiment?.score).toBe(50);
    expect(parsed.valuation?.score).toBe(50);
  });

  it("drops unknown category keys", () => {
    const raw = {
      macro: { score: 50, weight: 0.5, contribution: 25 },
      bogus_category: { score: 60, weight: 0.5, contribution: 30 },
    };
    const parsed = parseContributingIndicators(raw);
    expect(parsed.macro).toBeDefined();
    expect("bogus_category" in parsed).toBe(false);
  });

  it("drops entries whose value is not an object", () => {
    const raw = {
      macro: 47.3, // wrong shape — not an object
      technical: { score: 50, weight: 0.5, contribution: 25 },
      onchain: null,
    };
    const parsed = parseContributingIndicators(raw);
    expect(parsed.macro).toBeUndefined();
    expect(parsed.technical?.score).toBe(50);
    expect(parsed.onchain).toBeUndefined();
  });

  it("preserves sentinel for null score (so engine treats as missing)", () => {
    const raw = {
      macro: { score: null, weight: 0, contribution: 0 },
    };
    const parsed = parseContributingIndicators(raw);
    expect(parsed.macro).toBeDefined();
    // score sentinel is non-finite so `Number.isFinite` returns false
    expect(Number.isFinite(parsed.macro!.score)).toBe(false);
  });

  it("recognizes regional_overlay (KR equity) category", () => {
    const raw = {
      regional_overlay: { score: 42, weight: 0.2, contribution: 8.4 },
    };
    const parsed = parseContributingIndicators(raw);
    expect(parsed.regional_overlay?.score).toBe(42);
  });

  it("defaults missing weight/contribution to 0", () => {
    const raw = {
      macro: { score: 47.3 }, // weight + contribution omitted
    };
    const parsed = parseContributingIndicators(raw);
    expect(parsed.macro?.weight).toBe(0);
    expect(parsed.macro?.contribution).toBe(0);
  });
});

describe("parseCompositeRow", () => {
  it("builds a complete OriginalSnapshot from a well-formed DB row", () => {
    const row = {
      snapshot_date: "2026-04-22",
      asset_type: "us_equity" as const,
      model_version: "v2.0.0",
      score_0_100: 47.5,
      band: "유지",
      contributing_indicators: {
        macro: { score: 47.3, weight: 0.45, contribution: 21.285 },
        technical: { score: 52.1, weight: 0.35, contribution: 18.235 },
        sentiment: { score: 50, weight: 0.1, contribution: 5 },
        valuation: { score: 50, weight: 0.1, contribution: 5 },
      },
    };
    const parsed = parseCompositeRow(row);
    expect(parsed).not.toBeNull();
    expect(parsed!.date).toBe("2026-04-22");
    expect(parsed!.assetType).toBe("us_equity");
    expect(parsed!.modelVersion).toBe("v2.0.0");
    expect(parsed!.score0to100).toBe(47.5);
    expect(parsed!.band).toBe("유지");
    expect(parsed!.perCategory.macro?.score).toBe(47.3);
  });

  it("returns null when snapshot_date is not a string", () => {
    const row = {
      snapshot_date: 42 as unknown as string,
      asset_type: "us_equity" as const,
      model_version: "v2.0.0",
      score_0_100: 47.5,
      band: null,
      contributing_indicators: {},
    };
    expect(parseCompositeRow(row)).toBeNull();
  });

  it("preserves null score_0_100 + null band for fetch_status='error' historical rows", () => {
    const row = {
      snapshot_date: "2026-04-22",
      asset_type: "kr_equity" as const,
      model_version: "v2.0.0",
      score_0_100: null,
      band: null,
      contributing_indicators: null,
    };
    const parsed = parseCompositeRow(row);
    expect(parsed).not.toBeNull();
    expect(parsed!.score0to100).toBeNull();
    expect(parsed!.band).toBeNull();
    expect(parsed!.perCategory).toEqual({});
  });
});
