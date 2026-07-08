import { computeDrawdownState } from "./drawdown";
import {
  evaluateMacroPillar,
  evaluateOnchainPillar,
  evaluateSentimentPillar,
  evaluateTrendPillar,
  evaluateVolatilityPillar,
} from "./pillars";
import type {
  AdvisorInputs,
  AdvisorVerdict,
  AdvisorVerdictLabel,
  DrawdownState,
  PillarEvaluation,
  PillarId,
} from "./types";

/**
 * Verdict combiner — turns drawdown state + pillar votes into the
 * final 조정 vs 추세전환 judgment with evidence.
 *
 * Decision structure:
 *
 * 1. Drawdown depth sets the QUESTION, not the answer:
 *      < 5%  → nothing to judge ("no_drawdown")
 *      5-10% → shallow pullback ("healthy_pullback", unless pillars
 *              scream reversal)
 *      ≥ 10% → the real question — pillars decide discount vs reversal
 * 2. Pillars vote with signed scores; weights differ by asset class
 *    (macro anchors equities; onchain replaces volatility weight for
 *    crypto). Pillars with strength 0 (missing inputs) drop out and
 *    their weight renormalizes across the rest — same null-propagation
 *    philosophy as composite-v2.
 * 3. Confidence = coverage × (0.4 + 0.6 × decisiveness): coverage is
 *    the present-pillar weight sum, decisiveness scales |netScore|,
 *    and the 0.4 floor keeps a fully-informed-but-neutral verdict
 *    from reading as "no information". A verdict from 2 of 4 pillars,
 *    or a net score near 0, reports low confidence rather than hiding
 *    the uncertainty.
 *
 * Verdict bands on netScore (±0.2) are provisional round numbers,
 * consistent with the rule-table philosophy in regime/rules.ts.
 */

export const PILLAR_WEIGHTS: Record<
  AdvisorInputs["assetClass"],
  ReadonlyArray<{ pillar: PillarId; weight: number }>
> = {
  equity: [
    { pillar: "macro", weight: 0.35 },
    { pillar: "trend", weight: 0.3 },
    { pillar: "volatility", weight: 0.2 },
    { pillar: "sentiment", weight: 0.15 },
  ],
  crypto: [
    { pillar: "macro", weight: 0.2 },
    { pillar: "trend", weight: 0.25 },
    { pillar: "onchain", weight: 0.3 },
    { pillar: "sentiment", weight: 0.25 },
  ],
};

/** Drawdown below this is noise — nothing to judge. */
export const NO_DRAWDOWN_CEILING = 0.05;
/** Drawdown below this is a shallow pullback; at/above, the real question. */
export const PULLBACK_CEILING = 0.1;
/** |netScore| at/above this decides discount vs reversal. */
export const DECISION_BAND = 0.2;
/** Early-warning threshold: reversal call allowed even in the 5-10% band. */
export const EARLY_REVERSAL_FLOOR = -0.35;

export function computeAdvisorVerdict(inputs: AdvisorInputs): AdvisorVerdict {
  const drawdown = computeDrawdownState(inputs.series);

  // Pillar set mirrors PILLAR_WEIGHTS exactly: crypto swaps the
  // volatility pillar OUT for onchain (VIX is a US-equity fear gauge;
  // the weights table gives it zero weight for crypto, and a rendered
  // pillar that cannot move the verdict would be misleading evidence
  // — Trigger 2 review finding, 2026-07-08).
  const pillars: PillarEvaluation[] = [
    evaluateTrendPillar(inputs.trend),
    evaluateSentimentPillar(inputs.sentiment),
  ];
  if (inputs.assetClass === "equity") {
    pillars.push(
      evaluateVolatilityPillar({
        ...inputs.volatility,
        drawdownPct: drawdown?.drawdownPct ?? null,
      }),
    );
  }
  pillars.push(evaluateMacroPillar(inputs.macro));
  if (inputs.assetClass === "crypto") {
    pillars.push(evaluateOnchainPillar(inputs.onchain));
  }

  const weights = PILLAR_WEIGHTS[inputs.assetClass];
  let weightedSum = 0;
  let presentWeight = 0;
  const contributions = new Map<PillarId, number>();
  for (const { pillar, weight } of weights) {
    const evaluation = pillars.find((p) => p.pillar === pillar);
    if (!evaluation || evaluation.strength === 0) continue;
    weightedSum += evaluation.score * weight;
    presentWeight += weight;
    contributions.set(pillar, Math.abs(evaluation.score * weight));
  }

  const netScore = presentWeight > 0 ? weightedSum / presentWeight : null;
  const coverage = presentWeight; // weights sum to 1 per class

  const label = decideLabel(drawdown, netScore);
  const decisiveness =
    netScore === null ? 0 : Math.min(1, Math.abs(netScore) / 0.5);
  const confidence =
    label === "insufficient_data"
      ? 0
      : Math.round(coverage * (0.4 + 0.6 * decisiveness) * 100) / 100;

  const evidenceKo = pillars
    .filter((p) => p.strength > 0)
    .sort(
      (a, b) =>
        (contributions.get(b.pillar) ?? 0) - (contributions.get(a.pillar) ?? 0),
    )
    .map((p) => p.reasonKo);

  return {
    label,
    drawdown,
    netScore,
    confidence,
    pillars,
    headlineKo: buildHeadlineKo(label, drawdown, netScore),
    evidenceKo,
  };
}

function decideLabel(
  drawdown: DrawdownState | null,
  netScore: number | null,
): AdvisorVerdictLabel {
  if (drawdown === null) return "insufficient_data";
  const dd = drawdown.drawdownPct;

  if (dd < NO_DRAWDOWN_CEILING) return "no_drawdown";

  if (dd < PULLBACK_CEILING) {
    if (netScore !== null && netScore <= EARLY_REVERSAL_FLOOR)
      return "reversal_risk";
    return "healthy_pullback";
  }

  if (netScore === null) return "mixed_signals";
  if (netScore >= DECISION_BAND) return "discount_zone";
  if (netScore <= -DECISION_BAND) return "reversal_risk";
  return "mixed_signals";
}

function buildHeadlineKo(
  label: AdvisorVerdictLabel,
  drawdown: DrawdownState | null,
  netScore: number | null,
): string {
  if (label === "insufficient_data" || drawdown === null) {
    return "가격 데이터가 부족해 판단할 수 없습니다";
  }

  const ddPct = (drawdown.drawdownPct * 100).toFixed(1);
  const peak = `고점(${drawdown.peakDate}) 대비 -${ddPct}%`;

  switch (label) {
    case "no_drawdown":
      return `${peak} — 고점 부근, 할인 없음`;
    case "healthy_pullback":
      return `${peak} — 얕은 조정 구간, 관망 가능`;
    case "discount_zone":
      return `${peak} — 조정(할인) 구간으로 판단, 근거 우세`;
    case "mixed_signals":
      return `${peak} — 신호 혼재, 판단 유보`;
    case "reversal_risk":
      return netScore !== null && drawdown.drawdownPct < PULLBACK_CEILING
        ? `${peak} — 낙폭은 얕지만 추세전환 경고 신호 우세`
        : `${peak} — 추세전환 위험, 방어 우선`;
  }
}
