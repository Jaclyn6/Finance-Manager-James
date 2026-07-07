import type {
  AdvisorVerdictLabel,
  PillarId,
  PillarStance,
} from "@/lib/advisor/types";

/**
 * Korean display labels + Tailwind palettes for advisor verdicts.
 *
 * Shared between the dashboard `VerdictCard` and the `/asset/[slug]`
 * evidence view so the same verdict never renders under two different
 * names or colors. Same file-split rationale as `asset-labels.ts`:
 * changing a string here is an intentional user-visible rename.
 *
 * Color semantics (contrarian, from the discount-hunter's seat):
 *   emerald = "this is the opportunity state" (discount zone),
 *   red     = "danger, defense first" (reversal risk),
 *   sky     = benign/shallow, amber = unclear, muted = nothing to say.
 */
export const VERDICT_LABEL_KO: Record<AdvisorVerdictLabel, string> = {
  insufficient_data: "데이터 부족",
  no_drawdown: "고점 부근",
  healthy_pullback: "얕은 조정",
  discount_zone: "할인 구간",
  mixed_signals: "신호 혼재",
  reversal_risk: "추세전환 위험",
};

export const VERDICT_BADGE_CLASS: Record<AdvisorVerdictLabel, string> = {
  insufficient_data: "bg-muted text-muted-foreground",
  no_drawdown: "bg-muted text-foreground",
  healthy_pullback:
    "bg-sky-500/10 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300",
  discount_zone:
    "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300",
  mixed_signals:
    "bg-amber-500/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300",
  reversal_risk:
    "bg-red-500/10 text-red-700 dark:bg-red-400/10 dark:text-red-300",
};

export const PILLAR_LABEL_KO: Record<PillarId, string> = {
  trend: "추세",
  sentiment: "심리",
  volatility: "변동성",
  macro: "매크로",
  onchain: "온체인",
};

export const STANCE_LABEL_KO: Record<PillarStance, string> = {
  discount: "할인 근거",
  neutral: "중립",
  reversal: "전환 경고",
};

export const STANCE_BADGE_CLASS: Record<PillarStance, string> = {
  discount:
    "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300",
  neutral: "bg-muted text-muted-foreground",
  reversal: "bg-red-500/10 text-red-700 dark:bg-red-400/10 dark:text-red-300",
};
