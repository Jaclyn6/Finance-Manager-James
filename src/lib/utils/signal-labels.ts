import {
  type SignalDetail,
  type SignalName,
  type SignalState,
} from "@/lib/score-engine/signals";

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
 * One-line plain-Korean description shown on each tile underneath the
 * short label. Tells the beginner WHAT the signal looks for and WHY a
 * fired signal is bullish — without statistics jargon. Pairs with
 * {@link describeSignalSituation} which renders the live "지금 상황".
 */
export const SIGNAL_DESCRIPTION_KO: Record<SignalName, string> = {
  EXTREME_FEAR:
    "공포지수(VIX)나 CNN F&G가 극단적인 공포 구간일 때 발동 — 역사적으로 그때가 매수 시점이었습니다.",
  DISLOCATION:
    "SPY 또는 QQQ가 200일 평균보다 25% 이상 떨어졌을 때 발동 — 가격이 평균에서 크게 벌어진 매수 기회입니다.",
  ECONOMY_INTACT:
    "실업 청구가 낮고 Sahm 침체 지수가 안정 구간일 때 발동 — 경제가 침체에 빠지지 않았다는 확인입니다.",
  SPREAD_REVERSAL:
    "하이일드 스프레드가 정점을 찍고 내려오기 시작할 때 발동 — 신용 위험이 정점을 지나는 신호입니다.",
  LIQUIDITY_EASING:
    "재무부 일반계정(TGA) 잔액이 20일 평균 아래로 내려갈 때 발동 — 시장에 유동성이 풀리고 있다는 신호입니다.",
  MOMENTUM_TURN:
    "SPY MACD가 최근 7일 안에 골든크로스를 만들 때 발동 — 하락에서 상승으로 추세가 바뀌는 순간입니다.",
  CRYPTO_UNDERVALUED:
    "비트코인 MVRV Z-Score가 0 이하일 때 발동 — 시장가가 평균 매수가보다 낮은 저평가 구간입니다.",
  CAPITULATION:
    "비트코인 SOPR이 1 미만일 때 발동 — 보유자들이 손실을 감수하고 매도하는 패닉 구간입니다.",
};

/**
 * Plain-Korean caption for a signal's current state. Replaces the older
 * 켜짐/꺼짐/불명 trio which read as ambiguous toggles rather than buy
 * conditions. The wording leads with "조건" so the user reads the tile
 * as "this buy condition is/isn't met right now."
 */
export const SIGNAL_STATE_LABEL_KO: Record<SignalState, string> = {
  active: "조건 충족",
  inactive: "조건 미충족",
  unknown: "데이터 부족",
};

/**
 * Live, one-sentence "지금 상황" derived from the signal's `state` and
 * `inputs`. Uses the actual numbers the engine evaluated so a beginner
 * can see WHY the tile is in its current state without opening the
 * tooltip (e.g. "VIX 19, CNN F&G 42 — 평온 구간").
 *
 * Returns a short Korean sentence; never empty, never English. Falls
 * back to a generic phrasing when inputs are absent so the dashboard
 * still reads coherently before crons land.
 */
export function describeSignalSituation(
  name: SignalName,
  detail: SignalDetail | null,
): string {
  const state = detail?.state ?? "unknown";
  const inputs = detail?.inputs ?? {};

  switch (name) {
    case "EXTREME_FEAR": {
      const vix = numOrNull(inputs.vix);
      const cnnFg = numOrNull(inputs.cnnFg);
      if (state === "active") {
        return `VIX ${fmt(vix, "—")}, CNN F&G ${fmt(cnnFg, "—")} — 시장이 공포에 빠진 상태`;
      }
      if (state === "inactive") {
        return `VIX ${fmt(vix, "—")}, CNN F&G ${fmt(cnnFg, "—")} — 평온 구간`;
      }
      return "VIX 또는 CNN F&G 데이터가 부족합니다.";
    }
    case "DISLOCATION": {
      const spy = pctOrNull(inputs.spyDisparity);
      const qqq = pctOrNull(inputs.qqqDisparity);
      if (state === "active") {
        return `SPY ${spy}, QQQ ${qqq} — 200일 평균보다 크게 떨어진 상태`;
      }
      if (state === "inactive") {
        return `SPY ${spy}, QQQ ${qqq} — 200일 평균에서 정상 범위`;
      }
      return "SPY 또는 QQQ 200일 평균 데이터가 부족합니다.";
    }
    case "ECONOMY_INTACT": {
      const icsa = numOrNull(inputs.icsa);
      const sahm = numOrNull(inputs.sahmCurrent);
      const icsaText = icsa !== null ? `${Math.round(icsa).toLocaleString("en-US")}건` : "—";
      const sahmText = sahm !== null ? sahm.toFixed(2) : "—";
      if (state === "active") {
        return `실업 청구 ${icsaText}, Sahm ${sahmText} — 경제 펀더멘털 양호`;
      }
      if (state === "inactive") {
        return `실업 청구 ${icsaText}, Sahm ${sahmText} — 경계 구간`;
      }
      return "실업 청구 또는 Sahm 데이터가 부족합니다.";
    }
    case "SPREAD_REVERSAL": {
      const today = numOrNull(inputs.bamlToday);
      const max = numOrNull(inputs.maxLast7d);
      const todayText = today !== null ? `${today.toFixed(2)}%` : "—";
      const maxText = max !== null ? `${max.toFixed(2)}%` : "—";
      if (state === "active") {
        return `HY 스프레드 ${todayText} (7일 고점 ${maxText}) — 신용 시장 안정화 시작`;
      }
      if (state === "inactive") {
        return `HY 스프레드 ${todayText} (7일 고점 ${maxText}) — 아직 반전 조건 아님`;
      }
      return "하이일드 스프레드 데이터가 부족합니다.";
    }
    case "LIQUIDITY_EASING": {
      const today = numOrNull(inputs.tgaToday);
      const sma = numOrNull(inputs.sma20);
      const todayText =
        today !== null ? `${Math.round(today).toLocaleString("en-US")}` : "—";
      const smaText =
        sma !== null ? `${Math.round(sma).toLocaleString("en-US")}` : "—";
      if (state === "active") {
        return `TGA ${todayText} (20일 평균 ${smaText}) — 시장에 유동성 공급 중`;
      }
      if (state === "inactive") {
        return `TGA ${todayText} (20일 평균 ${smaText}) — 유동성 흡수 구간`;
      }
      return "TGA 잔액 데이터가 부족합니다.";
    }
    case "MOMENTUM_TURN": {
      if (state === "active") {
        return "SPY MACD가 최근 7일 안에 골든크로스 — 하락에서 상승으로 전환";
      }
      if (state === "inactive") {
        return "SPY MACD 골든크로스가 최근 7일 내 없음 — 모멘텀 미전환";
      }
      return "SPY MACD 데이터가 부족합니다.";
    }
    case "CRYPTO_UNDERVALUED": {
      const mvrv = numOrNull(inputs.mvrvZ);
      const mvrvText = mvrv !== null ? mvrv.toFixed(2) : "—";
      if (state === "active") {
        return `MVRV Z-Score ${mvrvText} — 비트코인 저평가 구간`;
      }
      if (state === "inactive") {
        return `MVRV Z-Score ${mvrvText} — 평균 매수가 위`;
      }
      return "MVRV Z-Score 데이터가 부족합니다.";
    }
    case "CAPITULATION": {
      const sopr = numOrNull(inputs.sopr);
      const soprText = sopr !== null ? sopr.toFixed(3) : "—";
      if (state === "active") {
        return `SOPR ${soprText} — 손실 매도 구간 (역사적 매수 기회)`;
      }
      if (state === "inactive") {
        return `SOPR ${soprText} — 일반적 시장 흐름`;
      }
      return "SOPR 데이터가 부족합니다.";
    }
    default: {
      // Exhaustiveness guard. If a new SignalName is added to the union
      // in `signals.ts` without updating this switch, the `never` cast
      // below becomes a compile error (caught by tsc) AND the runtime
      // returns a coherent Korean fallback rather than `undefined`,
      // which would render as the literal string "undefined" in the
      // tile's JSX and aria-label.
      const _exhaustive: never = name;
      void _exhaustive;
      return "데이터가 부족합니다.";
    }
  }
}

function numOrNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pctOrNull(v: number | null | undefined): string {
  const n = numOrNull(v);
  if (n === null) return "—";
  // Disparity ratios are stored as fractions (-0.25 = -25%).
  const pct = n * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function fmt(v: number | null, fallback: string): string {
  if (v === null) return fallback;
  const abs = Math.abs(v);
  if (abs < 10) return (Math.round(v * 100) / 100).toString();
  if (abs < 1000) return (Math.round(v * 10) / 10).toString();
  return Math.round(v).toLocaleString("en-US");
}

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
