import { describe, expect, it } from "vitest";

import {
  formatRawValue,
  INDICATOR_CATEGORY_LABEL_KO,
  INDICATOR_CATEGORY_ORDER,
  INDICATOR_GLOSSARY,
  INDICATORS_BY_CATEGORY,
  type IndicatorCategory,
} from "./indicator-glossary";

/**
 * Statistics jargon banned from the score-transparency fields per the
 * scoring-transparency authoring contract (어머니/여자친구 페르소나 톤).
 * Keep this list in sync with the rule in `indicator-glossary.ts`'s
 * header doc — when a new term sneaks in via copy-paste, the failing
 * test points straight at the offending entry + field.
 */
const FORBIDDEN_STATISTICS_TERMS = [
  "z-score",
  "Z-score",
  "z 점수",
  "표준편차",
  "정규분포",
  "normalize",
  "Normalize",
  "정규화",
  // The literal Greek sigma character — used in academic stats writeups.
  // Note: `BB_20_2`'s labelKo legitimately contains "2σ" as part of the
  // canonical Bollinger Band notation, so this check applies only to
  // scoreDirectionKo / scoringMethodKo, not the historical fields.
  "σ",
  "sigma",
  "Sigma",
];

const EXPECTED_KEYS: readonly string[] = [
  // Macro composite (7)
  "FEDFUNDS",
  "CPIAUCSL",
  "DGS10",
  "T10Y2Y",
  "VIXCLS",
  "BAMLH0A0HYM2",
  "SAHMCURRENT",
  // Signal-only (2)
  "ICSA",
  "WDTGAL",
  // Regional overlay (2)
  "DTWEXBGS",
  "DEXKOUS",
  // Technical (6)
  "RSI_14",
  "MACD_12_26_9",
  "MA_50",
  "MA_200",
  "BB_20_2",
  "DISPARITY",
  // On-chain (5)
  "MVRV_Z",
  "SOPR",
  "BTC_ETF_NETFLOW",
  "CRYPTO_FG",
  "CNN_FG",
  // News (1)
  "NEWS_SENTIMENT",
];

describe("INDICATOR_GLOSSARY", () => {
  it("contains exactly 23 entries", () => {
    expect(Object.keys(INDICATOR_GLOSSARY)).toHaveLength(23);
  });

  it("contains every expected indicator key (no missing, no duplicates)", () => {
    const actualKeys = Object.keys(INDICATOR_GLOSSARY).sort();
    const expectedKeys = [...EXPECTED_KEYS].sort();
    expect(actualKeys).toEqual(expectedKeys);
    // Implicit duplicate check — Object.keys returns unique keys, but
    // confirm the input source list is also unique to catch typos in
    // the test fixture itself.
    expect(new Set(EXPECTED_KEYS).size).toBe(EXPECTED_KEYS.length);
  });

  it("every entry has the required non-empty Korean fields", () => {
    for (const [key, entry] of Object.entries(INDICATOR_GLOSSARY)) {
      expect(entry.key, `${key}.key`).toBe(key);
      expect(entry.labelKo, `${key}.labelKo`).toBeTruthy();
      expect(entry.shortKo, `${key}.shortKo`).toBeTruthy();
      expect(
        entry.beginnerExplanationKo,
        `${key}.beginnerExplanationKo`,
      ).toBeTruthy();
      expect(entry.bullishCaseKo, `${key}.bullishCaseKo`).toBeTruthy();
      expect(entry.bearishCaseKo, `${key}.bearishCaseKo`).toBeTruthy();
      expect(entry.typicalRangeKo, `${key}.typicalRangeKo`).toBeTruthy();
      expect(entry.sourceName, `${key}.sourceName`).toBeTruthy();
      expect(entry.sourceUrl, `${key}.sourceUrl`).toMatch(/^https?:\/\//);
    }
  });

  it("every entry has the required score-transparency fields", () => {
    for (const [key, entry] of Object.entries(INDICATOR_GLOSSARY)) {
      expect(
        entry.scoreDirectionKo,
        `${key}.scoreDirectionKo`,
      ).toBeTruthy();
      expect(
        entry.scoreDirectionKo.length,
        `${key}.scoreDirectionKo length`,
      ).toBeGreaterThanOrEqual(20);
      expect(
        entry.scoringMethodKo,
        `${key}.scoringMethodKo`,
      ).toBeTruthy();
      expect(
        entry.scoringMethodKo.length,
        `${key}.scoringMethodKo length`,
      ).toBeGreaterThanOrEqual(20);
      // unitKo is allowed to be the empty string for unit-less indicators
      // (MA_50, MA_200, BB_20_2, DISPARITY, MVRV_Z, SOPR, NEWS_SENTIMENT)
      // but the field itself must be present (typed string).
      expect(typeof entry.unitKo, `${key}.unitKo type`).toBe("string");
    }
  });

  it("score-transparency fields avoid statistics jargon (어머니/여자친구 톤)", () => {
    for (const [key, entry] of Object.entries(INDICATOR_GLOSSARY)) {
      for (const term of FORBIDDEN_STATISTICS_TERMS) {
        expect(
          entry.scoreDirectionKo.includes(term),
          `${key}.scoreDirectionKo contains forbidden term "${term}"`,
        ).toBe(false);
        expect(
          entry.scoringMethodKo.includes(term),
          `${key}.scoringMethodKo contains forbidden term "${term}"`,
        ).toBe(false);
      }
    }
  });

  it("shortKo stays under the 50-character popover budget", () => {
    for (const [key, entry] of Object.entries(INDICATOR_GLOSSARY)) {
      expect(
        entry.shortKo.length,
        `${key}.shortKo length=${entry.shortKo.length}`,
      ).toBeLessThanOrEqual(50);
    }
  });
});

describe("INDICATORS_BY_CATEGORY", () => {
  it("covers all six categories", () => {
    const categories: IndicatorCategory[] = [
      "macro",
      "macro_signal",
      "regional_overlay",
      "technical",
      "onchain",
      "sentiment",
    ];
    for (const category of categories) {
      expect(
        INDICATORS_BY_CATEGORY[category].length,
        `${category} group size`,
      ).toBeGreaterThan(0);
    }
  });

  it("partition is exhaustive — every glossary entry appears in exactly one category bucket", () => {
    const flatKeys = Object.values(INDICATORS_BY_CATEGORY)
      .flat()
      .map((entry) => entry.key)
      .sort();
    const sourceKeys = Object.keys(INDICATOR_GLOSSARY).sort();
    expect(flatKeys).toEqual(sourceKeys);
  });

  it("INDICATOR_CATEGORY_ORDER and INDICATOR_CATEGORY_LABEL_KO cover the same six categories", () => {
    expect([...INDICATOR_CATEGORY_ORDER].sort()).toEqual(
      Object.keys(INDICATOR_CATEGORY_LABEL_KO).sort(),
    );
  });
});

describe("formatRawValue", () => {
  it("renders null/undefined/non-finite as em-dash", () => {
    expect(formatRawValue(null)).toBe("—");
    expect(formatRawValue(undefined)).toBe("—");
    expect(formatRawValue(Number.NaN)).toBe("—");
    expect(formatRawValue(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatRawValue(Number.NEGATIVE_INFINITY)).toBe("—");
  });

  it("renders integers ≥ 1000 with thousands separators", () => {
    expect(formatRawValue(300000)).toBe("300,000");
    expect(formatRawValue(1234)).toBe("1,234");
    expect(formatRawValue(-300000)).toBe("-300,000");
  });

  it("renders integers < 1000 without separators", () => {
    expect(formatRawValue(0)).toBe("0");
    expect(formatRawValue(42)).toBe("42");
    expect(formatRawValue(999)).toBe("999");
  });

  it("renders decimals at 2 fractional digits", () => {
    expect(formatRawValue(19.3)).toBe("19.30");
    expect(formatRawValue(4.5)).toBe("4.50");
    expect(formatRawValue(0.123)).toBe("0.12");
    expect(formatRawValue(-0.05)).toBe("-0.05");
  });

  it("renders large decimals with thousands separators on the integer part", () => {
    expect(formatRawValue(12345.67)).toBe("12,345.67");
  });
});
