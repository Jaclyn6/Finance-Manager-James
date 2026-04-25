import { describe, expect, it } from "vitest";

import {
  INDICATOR_CATEGORY_LABEL_KO,
  INDICATOR_CATEGORY_ORDER,
  INDICATOR_GLOSSARY,
  INDICATORS_BY_CATEGORY,
  type IndicatorCategory,
} from "./indicator-glossary";

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
