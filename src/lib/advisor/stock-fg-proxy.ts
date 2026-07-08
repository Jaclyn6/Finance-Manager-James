import { percentileRank, type IndicatorSeriesPoint } from "./series";

/**
 * In-house stock Fear & Greed proxy — `STOCK_FG_PROXY`.
 *
 * CNN's F&G endpoint stopped serving values (418 bot-block locally,
 * partial-without-current from CI runners; see docs/backlog.md
 * "Stock F&G outage", 2026-07-08). Scraping harder is off the table,
 * so this module computes an honest substitute from ingredients the
 * pipeline already collects legitimately — 4 of CNN's 7 components:
 *
 *   momentum     SPY close vs its 125-day MA        (higher = greed)
 *   volatility   VIX vs its 50-day MA, inverted     (higher VIX = fear)
 *   junkDemand   HY spread percentile, inverted     (wide spread = fear)
 *   safeHaven    20d SPY return − 20d TLT return    (bonds win = fear)
 *
 * Each component maps to 0-100 on CNN's convention (0 = extreme fear,
 * 100 = extreme greed); the proxy is the mean of whatever components
 * are computable and `missing` names the rest (weights renormalize by
 * omission — same null philosophy as composite-v2). Band mappings are
 * provisional literature-anchored round numbers, like every threshold
 * in pillars.ts.
 *
 * This is NOT CNN's index and must never be labeled as such in the
 * UI — consumers tag it 프록시/자체 산출. The advisor prefers a fresh
 * CNN_FG value when one exists and falls back to this proxy, so the
 * system self-heals if CNN unblocks.
 */

export const STOCK_FG_PROXY_KEY = "STOCK_FG_PROXY";

/** Bars needed per component (trading days). */
export const MOMENTUM_MA_BARS = 125;
export const VIX_MA_BARS = 50;
export const RETURN_WINDOW_BARS = 20;
/** Sample floor for the HY-spread percentile inside its window. */
export const JUNK_PERCENTILE_MIN_SAMPLES = 60;

export type StockFgComponentKey =
  | "momentum"
  | "volatility"
  | "junkDemand"
  | "safeHaven";

export interface StockFgComponent {
  key: StockFgComponentKey;
  /** 0-100, CNN convention (0 = extreme fear). Null = not computable. */
  score: number | null;
  /** Korean one-liner for the transparency drill-down. */
  detailKo: string;
}

export interface StockFgProxyResult {
  /** 0-100 mean of available components, or null when none compute. */
  value: number | null;
  components: StockFgComponent[];
  /** Keys of the components that could not be computed. */
  missing: StockFgComponentKey[];
}

export interface StockFgProxyInputs {
  /** SPY daily closes, chronological. Needs ≥ MOMENTUM_MA_BARS. */
  spyCloses: ReadonlyArray<IndicatorSeriesPoint>;
  /** TLT daily closes, chronological. Needs ≥ RETURN_WINDOW_BARS+1. */
  tltCloses: ReadonlyArray<IndicatorSeriesPoint>;
  /** VIXCLS daily series, chronological. Needs ≥ VIX_MA_BARS. */
  vixSeries: ReadonlyArray<IndicatorSeriesPoint>;
  /** BAMLH0A0HYM2 daily series, chronological (≈1y window is ideal). */
  hySeries: ReadonlyArray<IndicatorSeriesPoint>;
}

function clamp0100(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, value));
}

function tailMean(
  series: ReadonlyArray<IndicatorSeriesPoint>,
  n: number,
): number | null {
  if (series.length < n) return null;
  let sum = 0;
  for (let i = series.length - n; i < series.length; i++) {
    sum += series[i].value;
  }
  return sum / n;
}

function lastValue(
  series: ReadonlyArray<IndicatorSeriesPoint>,
): number | null {
  return series.length > 0 ? series[series.length - 1].value : null;
}

/** Simple n-bar-ago → last return, or null when too thin. */
function windowReturn(
  series: ReadonlyArray<IndicatorSeriesPoint>,
  bars: number,
): number | null {
  if (series.length < bars + 1) return null;
  const start = series[series.length - 1 - bars].value;
  const end = series[series.length - 1].value;
  if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(end)) {
    return null;
  }
  return end / start - 1;
}

/**
 * Momentum: SPY vs 125d MA. ±8% band maps to 0-100 (CNN uses S&P 500
 * vs its 125-day MA for the same component).
 */
function momentumComponent(
  spy: ReadonlyArray<IndicatorSeriesPoint>,
): StockFgComponent {
  const close = lastValue(spy);
  const ma = tailMean(spy, MOMENTUM_MA_BARS);
  if (close === null || ma === null || ma <= 0) {
    return {
      key: "momentum",
      score: null,
      detailKo: `SPY 125일선 데이터 부족(${spy.length}/${MOMENTUM_MA_BARS}일)`,
    };
  }
  const ratio = close / ma - 1;
  const score = clamp0100(50 + (ratio / 0.08) * 50);
  return {
    key: "momentum",
    score,
    detailKo: `SPY 125일선 대비 ${(ratio * 100).toFixed(1)}%`,
  };
}

/**
 * Volatility (inverted): VIX vs its 50d MA. VIX 30% above its MA maps
 * to 0 (extreme fear); 30% below maps to 100.
 */
function volatilityComponent(
  vix: ReadonlyArray<IndicatorSeriesPoint>,
): StockFgComponent {
  const current = lastValue(vix);
  const ma = tailMean(vix, VIX_MA_BARS);
  if (current === null || ma === null || ma <= 0) {
    return {
      key: "volatility",
      score: null,
      detailKo: `VIX 50일선 데이터 부족(${vix.length}/${VIX_MA_BARS}일)`,
    };
  }
  const ratio = current / ma - 1;
  const score = clamp0100(50 - (ratio / 0.3) * 50);
  return {
    key: "volatility",
    score,
    detailKo: `VIX ${current.toFixed(1)} — 50일 평균 대비 ${(ratio * 100).toFixed(0)}%`,
  };
}

/**
 * Junk-bond demand (inverted): where today's HY spread sits within the
 * supplied window. Spread at the window's 90th percentile → score 10.
 */
function junkDemandComponent(
  hy: ReadonlyArray<IndicatorSeriesPoint>,
): StockFgComponent {
  const current = lastValue(hy);
  const rank =
    current === null
      ? null
      : percentileRank(hy, current, JUNK_PERCENTILE_MIN_SAMPLES);
  if (current === null || rank === null) {
    return {
      key: "junkDemand",
      score: null,
      detailKo: `하이일드 스프레드 데이터 부족(${hy.length}/${JUNK_PERCENTILE_MIN_SAMPLES}일)`,
    };
  }
  const score = clamp0100((1 - rank) * 100);
  return {
    key: "junkDemand",
    score,
    detailKo: `하이일드 스프레드 ${current.toFixed(2)}%p — 기간 내 상위 ${((1 - rank) * 100).toFixed(0)}%`,
  };
}

/**
 * Safe-haven demand: 20d SPY return minus 20d TLT return. Stocks
 * outperforming bonds by ≥8%p over the window maps to 100 (greed).
 */
function safeHavenComponent(
  spy: ReadonlyArray<IndicatorSeriesPoint>,
  tlt: ReadonlyArray<IndicatorSeriesPoint>,
): StockFgComponent {
  const spyReturn = windowReturn(spy, RETURN_WINDOW_BARS);
  const tltReturn = windowReturn(tlt, RETURN_WINDOW_BARS);
  if (spyReturn === null || tltReturn === null) {
    return {
      key: "safeHaven",
      score: null,
      detailKo: `SPY/TLT ${RETURN_WINDOW_BARS}일 수익률 데이터 부족`,
    };
  }
  const diff = spyReturn - tltReturn;
  const score = clamp0100(50 + (diff / 0.08) * 50);
  return {
    key: "safeHaven",
    score,
    detailKo: `20일 SPY-TLT 수익률 차 ${(diff * 100).toFixed(1)}%p`,
  };
}

/**
 * Computes the proxy. Never throws; a component that cannot be
 * computed reports `score: null` + membership in `missing`, and the
 * headline value renormalizes over the rest. All four missing →
 * `value: null` (loud absence, consumers render "—").
 */
export function computeStockFgProxy(
  inputs: StockFgProxyInputs,
): StockFgProxyResult {
  const components: StockFgComponent[] = [
    momentumComponent(inputs.spyCloses),
    volatilityComponent(inputs.vixSeries),
    junkDemandComponent(inputs.hySeries),
    safeHavenComponent(inputs.spyCloses, inputs.tltCloses),
  ];

  const available = components.filter(
    (c): c is StockFgComponent & { score: number } => c.score !== null,
  );
  const missing = components
    .filter((c) => c.score === null)
    .map((c) => c.key);

  const value =
    available.length === 0
      ? null
      : Math.round(
          (available.reduce((sum, c) => sum + c.score, 0) /
            available.length) *
            10,
        ) / 10;

  return { value, components, missing };
}
