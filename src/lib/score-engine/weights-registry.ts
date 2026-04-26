/**
 * Versioned weights registry for the Phase 3.4 backtest engine.
 *
 * Phase 1 + 2 + 3.0 stored the engine's weights as scattered top-level
 * `export const`s in `weights.ts` — `CATEGORY_WEIGHTS`,
 * `INDICATOR_CONFIG`, `PHASE2_FRED_REGIONAL_OVERLAY`. Phase 3.4 needs
 * to be able to RUN the engine math against arbitrary historical or
 * user-supplied weight sets, so we wrap each "edition" of the weights
 * into a single `EngineWeights` object keyed by version string.
 *
 * Reference: `docs/phase3_4_backtest_blueprint.md` §2.2
 *
 * Drift invariant (Step 1 acceptance criterion #1):
 * `WEIGHTS_REGISTRY["v2.0.0-baseline"]` MUST deep-equal a snapshot of
 * the v2.0.0 production constants exactly. The snapshot test in
 * `weights-registry.test.ts` enforces this — bumping any value in
 * `weights.ts` without bumping the registry version (and adding a new
 * entry here) will fail CI.
 *
 * Why a registry:
 * 1. Backtest replay needs to call into `computeCompositeV2` /
 *    `computeSignals` with non-current weights. The engine functions
 *    accept a weights argument; the registry is the index of available
 *    options.
 * 2. Phase 3.4 Step 7 tuning slider lets the user POST `customWeights`
 *    inline — that bypass uses the same `EngineWeights` shape and is
 *    keyed in `backtest_runs.weights_version` as
 *    `"v2.0.0-baseline+custom-{hash}"`.
 * 3. Future MODEL_VERSION bumps (e.g. v2.1.0 after the §6 acceptance
 *    drift check) add a new `WEIGHTS_REGISTRY["v2.1.0-baseline"]` row;
 *    backtests can then run "today's data through v2.0.0" and "today's
 *    data through v2.1.0" symmetrically for comparison.
 *
 * `as const` recursively because every consumer treats these as
 * immutable. Mutating a registry entry at runtime is a contract
 * violation (would corrupt other in-flight backtests).
 */

import type {
  AssetType,
  IndicatorConfig,
  PerAssetCategoryWeights,
} from "./types";

/**
 * Per-FRED-series config used by the regional_overlay category
 * for KR equity (see `weights.ts::PHASE2_FRED_REGIONAL_OVERLAY`).
 * Re-declared here so the registry can carry a frozen snapshot.
 */
export interface RegionalOverlayConfig {
  descriptionKo: string;
  sourceName: "FRED";
  sourceUrl: string;
  frequency: "daily";
  windowYears: number;
  inverted: boolean;
  weight: number;
}

/**
 * The complete set of weights + thresholds that the engine math
 * consumes. One snapshot per registry entry.
 *
 * NOTE: signal threshold tuning lives in `signals.ts` directly via the
 * SIGNAL_RULES_VERSION constant. Phase 3.4 base does NOT pipe signal
 * thresholds through the registry — that's a Phase 3.4.1 OOS item.
 * The `signal_rules_version` field here records WHICH signals.ts edition
 * the registry entry is paired with for full reproducibility.
 */
export interface EngineWeights {
  /** The string used in `composite_snapshots.model_version`. */
  modelVersion: string;
  /** Paired signals.ts SIGNAL_RULES_VERSION. */
  signalRulesVersion: string;
  /** Per-asset category weights (composite-v2 input). */
  categoryWeights: Record<AssetType, PerAssetCategoryWeights>;
  /** Per-FRED-series config (macro composite input). */
  indicatorConfig: Record<string, IndicatorConfig>;
  /** Per-FRED-series config for regional_overlay (KR equity input). */
  regionalOverlayConfig: Record<string, RegionalOverlayConfig>;
}

// ---------------------------------------------------------------------------
// v2.0.0-baseline — current production snapshot.
//
// MUST match `weights.ts` exports byte-for-byte. The snapshot test
// asserts deep equality against the live constants.
// ---------------------------------------------------------------------------

const V2_0_0_BASELINE: EngineWeights = {
  modelVersion: "v2.0.0",
  signalRulesVersion: "v1.0.0",
  categoryWeights: {
    us_equity: { macro: 45, technical: 35, sentiment: 10, valuation: 10 },
    kr_equity: {
      macro: 45,
      technical: 25,
      regional_overlay: 20,
      sentiment: 10,
    },
    crypto: { macro: 25, technical: 25, onchain: 35, sentiment: 15 },
    global_etf: { macro: 45, technical: 35, sentiment: 10, valuation: 10 },
    common: { macro: 45, technical: 35, sentiment: 10, valuation: 10 },
  },
  indicatorConfig: {
    FEDFUNDS: {
      descriptionKo: "연방기금 실효금리 — 미국 정책금리 수준",
      sourceName: "FRED",
      sourceUrl: "https://fred.stlouisfed.org/series/FEDFUNDS",
      frequency: "monthly",
      windowYears: 5,
      inverted: false,
      weights: {
        us_equity: 0.2,
        kr_equity: 0.2,
        crypto: 0.2,
        global_etf: 0.2,
        common: 0.2,
      },
    },
    CPIAUCSL: {
      descriptionKo: "소비자물가지수 — 인플레이션 압력",
      sourceName: "FRED",
      sourceUrl: "https://fred.stlouisfed.org/series/CPIAUCSL",
      frequency: "monthly",
      windowYears: 5,
      inverted: false,
      weights: {
        us_equity: 0.15,
        kr_equity: 0.15,
        crypto: 0.15,
        global_etf: 0.15,
        common: 0.15,
      },
    },
    DGS10: {
      descriptionKo: "10년물 국채 금리 — 장기 할인율",
      sourceName: "FRED",
      sourceUrl: "https://fred.stlouisfed.org/series/DGS10",
      frequency: "daily",
      windowYears: 5,
      inverted: false,
      weights: {
        us_equity: 0.15,
        kr_equity: 0.15,
        crypto: 0.15,
        global_etf: 0.15,
        common: 0.15,
      },
    },
    T10Y2Y: {
      descriptionKo: "10Y-2Y 스프레드 — 장단기 금리 역전 / 침체 선행",
      sourceName: "FRED",
      sourceUrl: "https://fred.stlouisfed.org/series/T10Y2Y",
      frequency: "daily",
      windowYears: 5,
      inverted: true,
      weights: {
        us_equity: 0.15,
        kr_equity: 0.15,
        crypto: 0.15,
        global_etf: 0.15,
        common: 0.15,
      },
    },
    VIXCLS: {
      descriptionKo: "VIX — S&P 500 변동성(공포) 지수",
      sourceName: "FRED",
      sourceUrl: "https://fred.stlouisfed.org/series/VIXCLS",
      frequency: "daily",
      windowYears: 5,
      inverted: false,
      weights: {
        us_equity: 0.15,
        kr_equity: 0.15,
        crypto: 0.15,
        global_etf: 0.15,
        common: 0.15,
      },
    },
    BAMLH0A0HYM2: {
      descriptionKo: "미국 하이일드 회사채 OAS — 신용 스트레스",
      sourceName: "FRED",
      sourceUrl: "https://fred.stlouisfed.org/series/BAMLH0A0HYM2",
      frequency: "daily",
      windowYears: 5,
      inverted: false,
      weights: {
        us_equity: 0.1,
        kr_equity: 0.1,
        crypto: 0.1,
        global_etf: 0.1,
        common: 0.1,
      },
    },
    SAHMCURRENT: {
      descriptionKo: "Sahm Rule 실시간 지표 — 경기침체 탐지",
      sourceName: "FRED",
      sourceUrl: "https://fred.stlouisfed.org/series/SAHMCURRENT",
      frequency: "monthly",
      windowYears: 5,
      inverted: false,
      weights: {
        us_equity: 0.1,
        kr_equity: 0.1,
        crypto: 0.1,
        global_etf: 0.1,
        common: 0.1,
      },
    },
  },
  regionalOverlayConfig: {
    DTWEXBGS: {
      descriptionKo: "Broad 달러 지수 — 외국인 원화 자산 매도 압력",
      sourceName: "FRED",
      sourceUrl: "https://fred.stlouisfed.org/series/DTWEXBGS",
      frequency: "daily",
      windowYears: 5,
      inverted: false,
      weight: 0.5,
    },
    DEXKOUS: {
      descriptionKo: "USD/KRW 환율 — 외국인 자금 이탈 + 외화부채 부담",
      sourceName: "FRED",
      sourceUrl: "https://fred.stlouisfed.org/series/DEXKOUS",
      frequency: "daily",
      windowYears: 5,
      inverted: false,
      weight: 0.5,
    },
  },
};

/**
 * Public registry. Every entry is an immutable snapshot of the engine's
 * weights at a given version. Future edits to the engine math (e.g.
 * v2.1.0 after the Phase 3.0 §6 acceptance drift check) add a NEW
 * version key — they do NOT modify an existing entry.
 *
 * Custom-weights from the tuning slider (Phase 3.4 Step 7) do NOT
 * register here; they are passed inline to `runBacktest()` and
 * recorded in `backtest_runs.weights_version` with a hash suffix.
 */
export const WEIGHTS_REGISTRY: Readonly<Record<string, EngineWeights>> = {
  "v2.0.0-baseline": V2_0_0_BASELINE,
};

/**
 * The version key for the weights that production crons use TODAY.
 * Backtest UI defaults the "weights version" selector to this. When the
 * Phase 3.0 §6 drift check triggers a v2.1.0 cutover, this constant
 * bumps in lockstep with `MODEL_VERSION` in `weights.ts`.
 */
export const CURRENT_WEIGHTS_VERSION = "v2.0.0-baseline";

/**
 * Lookup helper. Throws on unknown version (the API route validates
 * before calling so a thrown error is a 500-class server bug, not a
 * user-facing 4xx).
 */
export function getWeights(version: string): EngineWeights {
  const entry = WEIGHTS_REGISTRY[version];
  if (!entry) {
    throw new Error(
      `Unknown weights version: "${version}". Known: ${Object.keys(
        WEIGHTS_REGISTRY,
      ).join(", ")}`,
    );
  }
  return entry;
}

/**
 * The canonical list of registered version keys, ordered by
 * recency (newest first). Useful for UI dropdowns.
 */
export const WEIGHTS_REGISTRY_KEYS: readonly string[] = Object.keys(
  WEIGHTS_REGISTRY,
);
