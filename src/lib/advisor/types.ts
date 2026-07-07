/**
 * Advisor engine types — the "할인 판독기" (discount detector).
 *
 * Product question (PRD pivot 2026-07-08): when an asset's price is
 * falling, is this a trend reversal (추세전환) or a simple correction —
 * i.e. a "discount period" (할인 기간) for buying? The advisor answers
 * with a verdict AND the evidence behind it, never a bare number.
 *
 * Architecture: this module is pure — no I/O, no Supabase, no fetch.
 * `src/lib/data/advisor.ts` assembles inputs from the DB and calls
 * {@link computeAdvisorVerdict}. Kept OUTSIDE `src/lib/score-engine/`
 * on purpose: the composite score engine's §7.4 invariant ("price bars
 * never feed scores") continues to hold for that engine; the advisor
 * is a separate product surface whose whole point is price-drawdown
 * analysis.
 *
 * Null semantics follow the project-wide loud-failure tenet: missing
 * inputs are surfaced in `missingInputs` / lower `confidence`, never
 * silently defaulted.
 */

/** One daily close — the only price shape the engine needs. */
export interface DailyClose {
  /** ISO `YYYY-MM-DD`. */
  date: string;
  close: number;
}

/**
 * Where the current price sits relative to the window's peak, plus the
 * window's max drawdown (MDD) for historical context.
 *
 * All drawdown fractions are POSITIVE magnitudes in [0, 1):
 * `drawdownPct = 0.123` means the price is 12.3% below the peak.
 */
export interface DrawdownState {
  currentDate: string;
  currentClose: number;
  peakDate: string;
  peakClose: number;
  /** Current decline from the window peak, positive fraction. 0 = at peak. */
  drawdownPct: number;
  /** Calendar days between peakDate and currentDate. */
  daysSincePeak: number;
  /** Deepest peak-to-trough decline anywhere in the window (MDD). */
  maxDrawdownPct: number;
  /** Date of the trough that produced maxDrawdownPct. */
  maxDrawdownTroughDate: string;
  /** Number of samples the state was computed from. */
  sampleCount: number;
}

export type PillarId =
  | "trend"
  | "sentiment"
  | "volatility"
  | "macro"
  | "onchain";

/** Which side of the 조정 vs 추세전환 question the pillar's evidence supports. */
export type PillarStance = "discount" | "neutral" | "reversal";

export interface PillarEvaluation {
  pillar: PillarId;
  stance: PillarStance;
  /**
   * Signed evidence score in [-1, 1]. Positive = supports "this decline
   * is a correction/discount"; negative = supports "trend reversal".
   */
  score: number;
  /**
   * 0-1 how much information the pillar actually had. 0 = all inputs
   * missing (the pillar cannot vote); 1 = fully informed.
   */
  strength: number;
  /** Korean-language reason shown in the evidence list. */
  reasonKo: string;
  /** Names of null inputs, for the loud-failure audit trail. */
  missingInputs: string[];
}

export type AdvisorVerdictLabel =
  | "insufficient_data"
  | "no_drawdown"
  | "healthy_pullback"
  | "discount_zone"
  | "mixed_signals"
  | "reversal_risk";

export interface AdvisorVerdict {
  label: AdvisorVerdictLabel;
  /** Null only when the price series was too thin to compute. */
  drawdown: DrawdownState | null;
  /**
   * Weighted net pillar score in [-1, 1] (+ = discount evidence
   * dominates, − = reversal evidence dominates). Null when no pillar
   * could vote.
   */
  netScore: number | null;
  /** 0-1 — input coverage × decisiveness. */
  confidence: number;
  pillars: PillarEvaluation[];
  /** One-sentence Korean verdict headline. */
  headlineKo: string;
  /** Ordered evidence sentences (most influential first). */
  evidenceKo: string[];
}

// ---------------------------------------------------------------------------
// Pillar inputs — plain nullable values so the data layer stays dumb.
// ---------------------------------------------------------------------------

export interface TrendInputs {
  close: number | null;
  ma50: number | null;
  ma200: number | null;
}

export interface SentimentInputs {
  /** Fear & Greed 0-100 RAW scale (low = fear). CNN for equities, alternative.me for crypto. */
  fearGreed: number | null;
}

export interface VolatilityInputs {
  vix: number | null;
  /**
   * VIX change vs ~7 days ago (points). A panic spike that is already
   * cooling reads differently from one still building. Null = history
   * too thin (fewer than ~7 days of VIXCLS rows).
   */
  vixWow: number | null;
  /** Current drawdown fraction — a calm VIX during a deep decline reads differently. */
  drawdownPct: number | null;
}

export interface MacroInputs {
  /** Composite macro category score 0-100 from the existing engine. */
  macroScore: number | null;
  /** FRED SAHMCURRENT — ≥ 0.5 = recession signal. */
  sahm: number | null;
  /** FRED T10Y2Y — negative = inverted curve. */
  t10y2y: number | null;
  /** FRED BAMLH0A0HYM2 high-yield spread, %. */
  hySpread: number | null;
  /**
   * High-yield spread change vs ~7 days ago (%p). Implements the
   * "스프레드가 4~5까지 치솟았다가 주간 기준으로 꺾일 때가 역사적
   * 매수 타이밍" rule: level alone can't distinguish "stress building"
   * from "stress peaking". Null = history too thin.
   */
  hySpreadWow: number | null;
}

export interface OnchainInputs {
  mvrvZ: number | null;
  sopr: number | null;
}

/** Everything the verdict function needs for one asset. */
export interface AdvisorInputs {
  /** Asset class — selects the pillar weight profile. */
  assetClass: "equity" | "crypto";
  /** Daily closes, ideally ~1 year. Order not required; NaN rows dropped. */
  series: ReadonlyArray<DailyClose>;
  trend: TrendInputs;
  sentiment: SentimentInputs;
  volatility: Omit<VolatilityInputs, "drawdownPct">;
  macro: MacroInputs;
  /** Only consulted when assetClass === "crypto". */
  onchain: OnchainInputs;
}
