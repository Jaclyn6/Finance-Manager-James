import type { IndicatorConfig } from "./types";

/**
 * Semantic version of the score model.
 *
 * Every row written by the cron — `indicator_readings`,
 * `composite_snapshots`, `score_changelog` — stores this value in
 * its `model_version` column so that bumping this constant creates a
 * parallel history of scores rather than overwriting the old ones
 * (PRD §16.2, blueprint §4.2). When weights or formulas change,
 * bump the version.
 *
 * Versioning policy:
 * - MAJOR: new indicators added or removed; band thresholds changed
 * - MINOR: weight redistribution within the same indicator set
 * - PATCH: bug fixes that shouldn't change normal-case outputs
 */
export const MODEL_VERSION = "v1.0.0";

/**
 * Phase 1 macro-only indicator set. All seven FRED series from
 * PRD §8.1 with per-asset-class weight hints.
 *
 * Design notes:
 * - Phase 1 composites are 100% macro. The same weight vector applies
 *   to every asset class because none of the Phase 2 layers
 *   (technical, on-chain, sentiment) exist yet. Phase 2 will introduce
 *   asymmetry — e.g. crypto's composite will lean harder on on-chain.
 * - Weights are relative, not percentages. {@link computeComposite}
 *   normalizes the active (non-undefined) weights to sum to 1 per
 *   asset class, so missing values don't distort the composite.
 * - `inverted` follows the blueprint §4.1 convention: `false` =
 *   "lower is better for risk assets". Only T10Y2Y is `true` because
 *   a positive yield curve slope is the healthier state.
 */
export const INDICATOR_CONFIG: Record<string, IndicatorConfig> = {
  FEDFUNDS: {
    descriptionKo: "연방기금 실효금리 — 미국 정책금리 수준",
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/FEDFUNDS",
    frequency: "monthly",
    windowYears: 5,
    inverted: false, // higher rate = tighter = worse
    weights: { us_equity: 0.2, kr_equity: 0.2, crypto: 0.2, global_etf: 0.2, common: 0.2 },
  },

  CPIAUCSL: {
    descriptionKo: "소비자물가지수 — 인플레이션 압력",
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/CPIAUCSL",
    frequency: "monthly",
    windowYears: 5,
    inverted: false, // higher = more inflation = worse for risk
    weights: { us_equity: 0.15, kr_equity: 0.15, crypto: 0.15, global_etf: 0.15, common: 0.15 },
  },

  DGS10: {
    descriptionKo: "10년물 국채 금리 — 장기 할인율",
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/DGS10",
    frequency: "daily",
    windowYears: 5,
    inverted: false, // higher rate = higher discount = worse valuations
    weights: { us_equity: 0.15, kr_equity: 0.15, crypto: 0.15, global_etf: 0.15, common: 0.15 },
  },

  T10Y2Y: {
    descriptionKo: "10Y-2Y 스프레드 — 장단기 금리 역전 / 침체 선행",
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/T10Y2Y",
    frequency: "daily",
    windowYears: 5,
    inverted: true, // positive spread = normal curve = good
    weights: { us_equity: 0.15, kr_equity: 0.15, crypto: 0.15, global_etf: 0.15, common: 0.15 },
  },

  VIXCLS: {
    descriptionKo: "VIX — S&P 500 변동성(공포) 지수",
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/VIXCLS",
    frequency: "daily",
    windowYears: 5,
    inverted: false, // higher VIX = more fear = worse for risk
    weights: { us_equity: 0.15, kr_equity: 0.15, crypto: 0.15, global_etf: 0.15, common: 0.15 },
  },

  BAMLH0A0HYM2: {
    descriptionKo: "미국 하이일드 회사채 OAS — 신용 스트레스",
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/BAMLH0A0HYM2",
    frequency: "daily",
    windowYears: 5,
    inverted: false, // wider spread = credit stress = worse
    weights: { us_equity: 0.1, kr_equity: 0.1, crypto: 0.1, global_etf: 0.1, common: 0.1 },
  },

  SAHMCURRENT: {
    descriptionKo: "Sahm Rule 실시간 지표 — 경기침체 탐지",
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/SAHMCURRENT",
    frequency: "monthly",
    windowYears: 5,
    inverted: false, // higher = closer to recession = worse
    weights: { us_equity: 0.1, kr_equity: 0.1, crypto: 0.1, global_etf: 0.1, common: 0.1 },
  },
};

/**
 * Keys in {@link INDICATOR_CONFIG}, ordered canonically. Useful when
 * the cron iterates over indicators in a stable sequence (so ingest
 * run logs are diff-friendly).
 */
export const INDICATOR_KEYS = Object.keys(INDICATOR_CONFIG);
