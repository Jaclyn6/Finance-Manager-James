import type {
  AssetType,
  IndicatorConfig,
  PerAssetCategoryWeights,
} from "./types";

/**
 * Semantic version of the score model.
 *
 * Every row written by the cron — `indicator_readings`,
 * `composite_snapshots`, `score_changelog`, and the Phase 2 reading
 * tables (`technical_readings`, `onchain_readings`, `news_sentiment`)
 * — stores this value in its `model_version` column so that bumping
 * this constant creates a parallel history of scores rather than
 * overwriting the old ones (PRD §16.2, blueprint §4.2). When weights
 * or formulas change, bump the version.
 *
 * Versioning policy:
 * - MAJOR: new indicators added or removed; band thresholds changed
 * - MINOR: weight redistribution within the same indicator set
 * - PATCH: bug fixes that shouldn't change normal-case outputs
 *
 * `v2.0.0` (Phase 2 cutover, 2026-04-23): MAJOR bump. Moves from the
 * Phase 1 flat 7-macro-indicator composite to the 4-category model
 * (macro / technical / on-chain / sentiment) with per-asset-type
 * weight tables defined by PRD §10. The v1 → v2 cutover is recorded
 * in the `model_version_history` DB table (migration 0009) so the
 * dashboard badge and `/asset/[slug]` trend `ReferenceLine` can read
 * the date at runtime rather than hard-coding it (blueprint §4.4).
 */
export const MODEL_VERSION = "v2.0.0";

/**
 * Semantic version of the Signal Alignment engine rule set
 * (blueprint §2.3, §4.5; PRD §10.4).
 *
 * Independent from {@link MODEL_VERSION} — signal threshold tuning
 * and composite weight tuning run on different cadences. A weight
 * tweak (MODEL_VERSION bump) should not invalidate the signal
 * history; a signal threshold tweak (SIGNAL_RULES_VERSION bump)
 * should not force a composite-score re-version. The `signal_events`
 * table keys its composite PK on `(snapshot_date,
 * signal_rules_version)` so both versions evolve independently while
 * preserving snapshot immutability (blueprint §2.2 tenet 2).
 */
export const SIGNAL_RULES_VERSION = "v1.0.0";

/**
 * Snapshot marker for the 22-ticker registry that Phase 2 scoring
 * depends on (blueprint §2.3, §3.2).
 *
 * Bumping this version requires a blueprint revision — silent edits
 * to the ticker list are forbidden (blueprint §11 risk row 5, §12
 * trade-off 5). The date suffix is the blueprint's authoring date
 * (2026-04-23) so a grep of the string finds the exact frozen-at
 * moment without a git-blame dance.
 */
export const TICKER_LIST_VERSION = "v1.0.0-2026-04-23";

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

/**
 * Phase 2 additional FRED series used ONLY as signal-engine inputs
 * (blueprint §4.5), not as composite-score inputs.
 *
 * These are kept separate from {@link INDICATOR_CONFIG} because the
 * Phase 1 `IndicatorConfig.weights` shape is composite-focused —
 * every entry there contributes to the per-asset composite score.
 * ICSA and WDTGAL feed the Signal Alignment engine (PRD §10.4) as
 * boolean-threshold inputs; folding them into INDICATOR_CONFIG with
 * zero weights would pollute the composite normalization logic.
 *
 * The `INDICATOR_CONFIG` restructure (4-category model per §4.2)
 * lands at Phase C Step 6. If Step 6 decides these FRED series
 * should ALSO feed the macro composite, they can be migrated then;
 * for Step 2 they are signal-only.
 *
 * WTREGEN is registered as a documented fallback for WDTGAL per
 * blueprint §3.1 + §4.5 ("WDTGAL daily primary; WTREGEN weekly is
 * documented fallback if WDTGAL becomes unavailable"). The cron
 * at Step 7 fetches WDTGAL; if it ever starts returning all-null
 * observations for multiple consecutive days, the fallback can be
 * activated by changing `active: false` → `true` here and updating
 * the signal engine input mapping.
 */
export const PHASE2_FRED_SIGNAL_INPUTS: Record<
  string,
  {
    descriptionKo: string;
    sourceName: "FRED";
    sourceUrl: string;
    frequency: "weekly" | "daily";
    windowYears: number;
    active: boolean;
    notes?: string;
  }
> = {
  ICSA: {
    descriptionKo:
      "주간 실업수당 청구건수 — ECONOMY_INTACT 시그널 입력 (블루프린트 §4.5)",
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/ICSA",
    frequency: "weekly",
    windowYears: 2,
    active: true,
    notes: "ECONOMY_INTACT = ICSA < 300000 && SAHMCURRENT < 0.5",
  },
  WDTGAL: {
    descriptionKo:
      "재무부 일반계정(TGA) 일일 잔액 — LIQUIDITY_EASING 시그널 입력 primary (블루프린트 §4.5)",
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/WDTGAL",
    frequency: "daily",
    windowYears: 1,
    active: true,
    notes:
      "LIQUIDITY_EASING = TGA_today < TGA_20d_MA; 20-day SMA needs ≥ 20 daily observations.",
  },
  WTREGEN: {
    descriptionKo:
      "재무부 일반계정(TGA) 주간 잔액 — WDTGAL이 중단될 시 fallback (현재 비활성)",
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/WTREGEN",
    frequency: "weekly",
    windowYears: 1,
    active: false,
    notes:
      "Activation procedure: flip active:false→true here + update signal engine LIQUIDITY_EASING input source + bump SIGNAL_RULES_VERSION per blueprint §2.3.",
  },
};

export const PHASE2_ACTIVE_FRED_SIGNAL_KEYS: readonly string[] = Object.entries(
  PHASE2_FRED_SIGNAL_INPUTS,
)
  .filter(([, cfg]) => cfg.active)
  .map(([key]) => key);

/**
 * Phase 2 FRED series that feed the `regional_overlay` composite
 * category for KR equity (plan §0.2 #3, blueprint §4.2 row 2, PRD
 * §10.3).
 *
 * Design split from {@link PHASE2_FRED_SIGNAL_INPUTS}:
 * - SIGNAL inputs (ICSA, WDTGAL) feed the Signal Alignment engine's
 *   boolean thresholds — raw values in, boolean signals out. No
 *   `score_0_100` normalization at ingest time.
 * - REGIONAL_OVERLAY inputs (DTWEXBGS, DEXKOUS) feed the composite
 *   score pipeline for KR equity — raw values in, 0-100 score out,
 *   averaged across the two series to produce a single
 *   `regional_overlay` category score at write time (cron §7).
 *
 * Weights sum to 1.0 across the two series so the cron can compute
 * the category score as a straight weighted average without an outer
 * normalization pass. Blueprint §10.3 assigns 10 + 10 out of KR's 20-
 * point regional overlay budget — expressed here as fractions of the
 * within-category budget (0.5 + 0.5 = 1.0) so the composite-v2 engine
 * can handle the "20 of 100 pts" allocation at its own layer via
 * {@link CATEGORY_WEIGHTS}.
 *
 * `inverted: false` for both — higher dollar strength + weaker KRW =
 * WORSE for KR equity (foreign selling pressure + FX-debt burden per
 * plan §0.2 #3 bullet 3). The standard Z-score-to-0-100 mapping with
 * `inverted=false` flips "high raw value" to "low score", which
 * matches the intuition.
 */
export const PHASE2_FRED_REGIONAL_OVERLAY: Record<
  string,
  {
    descriptionKo: string;
    sourceName: "FRED";
    sourceUrl: string;
    frequency: "daily";
    windowYears: number;
    inverted: boolean;
    /** Fraction of the regional_overlay category weight. Sum = 1.0. */
    weight: number;
  }
> = {
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
};

/**
 * Keys in {@link PHASE2_FRED_REGIONAL_OVERLAY}, ordered canonically.
 * Matches the pattern set by {@link INDICATOR_KEYS} so the cron can
 * iterate in a stable sequence.
 */
export const PHASE2_FRED_REGIONAL_OVERLAY_KEYS: readonly string[] =
  Object.keys(PHASE2_FRED_REGIONAL_OVERLAY);

/**
 * Per-asset category weights per blueprint §4.2 — the authoritative
 * input to `computeCompositeV2`. PRD v3.4 initial values; backtest-
 * driven re-tuning is a Phase 3 task per PRD §10 line 240.
 *
 * Phase 2 policy per blueprint §4.2 table verbatim — NO weight folding.
 *
 * 1. **Valuation stays first-class for US equity + Global ETF (§4.4
 *    trade-off 7).** PRD §10.1 and §10.4 allocate 10 pts to a
 *    "Valuation" sub-score. Phase 2 does not implement a dedicated
 *    valuation module, but the 10-pt weight is kept here so the cron
 *    pins `valuation` to a neutral 50 at write time. Critically, the
 *    weight is NOT folded into Sentiment — that would let sentiment
 *    drag the composite by 20 pts instead of the blueprint §4.1
 *    capped 10, violating "sentiment never drives the composite
 *    alone". Phase 3 replaces the 50-pin with a real Shiller-P/E-
 *    class module.
 *
 * 2. **Regional overlay stays first-class for KR equity (plan §0.2
 *    #3).** PRD §10.3 allocates 20 pts to a regional overlay
 *    (DTWEXBGS 10 + DEXKOUS 10). Both are FRED daily series; the
 *    plan §0.2 #3 resolution says they are macro-source but the
 *    blueprint §4.2 table keeps them as a distinct category so the
 *    per-category story on the dashboard stays auditable (a dollar-
 *    strength spike is a different story than a rate shock even if
 *    both come from FRED). Macro stays 45, overlay is a separate 20,
 *    Technical 25, Sentiment 10. Cron wires `regional_overlay` at
 *    Step 7; until then it is null → amber "missing" chip.
 *
 * 3. **Crypto (BTC/ETH)** uses four categories: on-chain 35, macro 25,
 *    technical 25, sentiment 15. PRD §10.2 verbatim. No valuation /
 *    regional overlay at this asset class.
 *
 * 4. **`common`** (the dashboard hero "전체 시장" composite) mirrors
 *    US-equity weights including the 10-pt valuation anchor. Rationale:
 *    the hero card represents a broad risk-on / risk-off read dominated
 *    by US macro and US tech leadership — the same driver mix that US
 *    equity uses. This is the decision the §4.2 anti-pattern warns
 *    against silently making for Global ETF; landing it HERE in code
 *    comments IS the documentation, identical in rigor to the Global
 *    ETF carve-out in §4.2 line 235.
 *
 * Each asset type's weights need NOT sum to 100. `computeCompositeV2`
 * renormalizes across PRESENT categories so a null/missing category
 * (blueprint §2.2 tenet 1) doesn't distort the composite's dynamic
 * range. A category absent from this map is "not applicable" for the
 * asset (e.g. on-chain for US equity) — computeCompositeV2 skips it
 * without adding to `missingCategories`. Null score for an applicable
 * category, on the other hand, lands in `missingCategories` so the UI
 * can surface "N/6 categories active" transparency.
 */
export const CATEGORY_WEIGHTS: Record<AssetType, PerAssetCategoryWeights> = {
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
};
