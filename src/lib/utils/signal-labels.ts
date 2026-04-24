import { type SignalName } from "@/lib/score-engine/signals";

/**
 * UI-side labels and formula strings for each {@link SignalName}.
 *
 * Kept out of `signals.ts` (the pure-math module) on purpose — the
 * engine module must stay import-free of Korean copy so it can be
 * exercised from scripts without picking up UI concerns. The signal
 * engine's internal `threshold` string is English and diagnostic; this
 * file adds the user-facing Korean phrasing.
 */

export const SIGNAL_LABELS_KO: Record<SignalName, string> = {
  EXTREME_FEAR: "극단 공포",
  DISLOCATION: "가격 이격",
  ECONOMY_INTACT: "경제 정상",
  SPREAD_REVERSAL: "스프레드 반전",
  LIQUIDITY_EASING: "유동성 완화",
  MOMENTUM_TURN: "모멘텀 반전",
  CRYPTO_UNDERVALUED: "저평가 구간",
  CAPITULATION: "항복 매도",
};

/**
 * Longer phrasing — used in the signal tile's aria-label and as the
 * tooltip's first line so the short chip label is disambiguated for
 * users who might otherwise wonder "가격 이격 from what?".
 */
export const SIGNAL_FULL_NAMES_KO: Record<SignalName, string> = {
  EXTREME_FEAR: "시장 극단 공포",
  DISLOCATION: "대형 지수 이격",
  ECONOMY_INTACT: "경제 지표 정상",
  SPREAD_REVERSAL: "하이일드 스프레드 반전",
  LIQUIDITY_EASING: "재무부 유동성 완화",
  MOMENTUM_TURN: "SPY 모멘텀 반전",
  CRYPTO_UNDERVALUED: "크립토 저평가 구간",
  CAPITULATION: "크립토 항복 매도",
};

/**
 * Korean formula text shown in the per-tile tooltip. Numeric formatting
 * matches PRD §10.4 exactly so a user comparing this UI with the PRD
 * sees identical strings (reduces review burden).
 */
export const SIGNAL_THRESHOLD_KO: Record<SignalName, string> = {
  EXTREME_FEAR: "VIX ≥ 35 또는 CNN F&G < 25",
  DISLOCATION: "SPY 또는 QQQ 이격도 ≤ -25%",
  ECONOMY_INTACT: "실업 청구 < 30만 그리고 Sahm < 0.5",
  SPREAD_REVERSAL: "HY 스프레드 ≥ 4 그리고 최근 7일 최댓값 하회",
  LIQUIDITY_EASING: "TGA 잔액이 20일 이동평균 아래",
  MOMENTUM_TURN: "SPY MACD 골든크로스 7일 이내",
  CRYPTO_UNDERVALUED: "MVRV Z-Score ≤ 0",
  CAPITULATION: "SOPR < 1",
};

/**
 * Alignment ladder resolver (blueprint §9 Step 8.5 line 671, with the
 * project-level decision to treat `count === 2` as the amber "partial
 * alignment" tier rather than grouping it under the grey waiting tier).
 *
 * Chosen boundary policy (documented here because the blueprint text is
 * explicit on ≥3 / ≥5 / ≤1 and silent on count=2):
 *   - `alignment_count <= 1` → grey "대기 구간"
 *   - `alignment_count in [2, 4]` → amber "평균 매수 타이밍 조건 일부 충족"
 *   - `alignment_count >= 5` → green "역사적 최적 매수 구간"
 *
 * Rationale: count=2 is already twice the grey threshold and represents
 * genuine (if incomplete) signal alignment. Rolling it into the grey
 * tier would silently under-represent partial alignment, which
 * contradicts plan §0.5 tenet 1 ("loud failure"). Folding it into amber
 * preserves the ladder's monotonic "more signals = more conviction"
 * reading.
 */
export type AlignmentTier = "waiting" | "partial" | "optimal";

export interface AlignmentBadge {
  tier: AlignmentTier;
  label: string;
  /** Tailwind classes for the badge's colored chip (non-color-alone — label also changes). */
  className: string;
}

export function resolveAlignmentBadge(
  alignmentCount: number | null,
): AlignmentBadge {
  // Null / NaN / negative defensively rounds down to the "waiting"
  // tier — we never fabricate an alignment tier from missing data.
  const safe =
    typeof alignmentCount === "number" && Number.isFinite(alignmentCount)
      ? Math.max(0, Math.floor(alignmentCount))
      : 0;

  if (safe >= 5) {
    return {
      tier: "optimal",
      label: "역사적 최적 매수 구간",
      className:
        "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300",
    };
  }
  if (safe >= 2) {
    return {
      tier: "partial",
      label: "평균 매수 타이밍 조건 일부 충족",
      className:
        "bg-amber-500/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300",
    };
  }
  return {
    tier: "waiting",
    label: "대기 구간",
    className: "bg-muted text-muted-foreground",
  };
}
