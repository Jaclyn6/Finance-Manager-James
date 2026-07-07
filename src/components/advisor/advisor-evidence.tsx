import { Card, CardContent } from "@/components/ui/card";
import { DrawdownChart } from "@/components/advisor/drawdown-chart";
import type { AdvisorAssetView } from "@/lib/data/advisor";
import type { PillarEvaluation } from "@/lib/advisor/types";
import { cn } from "@/lib/utils";
import {
  PILLAR_LABEL_KO,
  STANCE_BADGE_CLASS,
  STANCE_LABEL_KO,
  VERDICT_BADGE_CLASS,
  VERDICT_LABEL_KO,
} from "@/lib/utils/verdict-labels";

/**
 * Full advisor evidence view for `/asset/[slug]` — the drill-down the
 * dashboard `VerdictCard` links to.
 *
 * Three layers, most-judgmental first:
 *   1. verdict hero — pill + headline + ALL evidence sentences (the
 *      dashboard card truncates to 2; this is the "왜?" page so we
 *      show everything, including a confidence line),
 *   2. the 52-week drawdown chart the verdict was computed from,
 *   3. per-pillar breakdown — every pillar's stance, signed score bar,
 *      reason sentence, and missing inputs. Pillars with strength 0
 *      still render (loud-failure tenet: an uninformed pillar should
 *      look uninformed, not vanish).
 */
export function AdvisorEvidence({ view }: { view: AdvisorAssetView }) {
  const { verdict, series, ticker } = view;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight md:text-xl">
          지금이 할인 구간인가?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          오늘 기준 낙폭·추세·심리·변동성·매크로 근거의 전체 내역입니다
        </p>
      </div>

      <Card size="sm" className="p-5 md:p-6">
        <CardContent className="space-y-3 p-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                VERDICT_BADGE_CLASS[verdict.label],
              )}
            >
              {VERDICT_LABEL_KO[verdict.label]}
            </span>
            <span className="text-[11px] text-muted-foreground">
              근거 신뢰도 {Math.round(verdict.confidence * 100)}%
            </span>
          </div>

          <p className="text-sm leading-snug text-foreground">
            {verdict.headlineKo}
          </p>

          {verdict.evidenceKo.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {verdict.evidenceKo.map((evidence) => (
                <li key={evidence} className="flex gap-1.5">
                  <span aria-hidden className="text-muted-foreground/60">
                    ―
                  </span>
                  <span>{evidence}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <DrawdownChart
        series={series}
        drawdown={verdict.drawdown}
        ticker={ticker}
      />

      <PillarBreakdown pillars={verdict.pillars} />
    </section>
  );
}

function PillarBreakdown({ pillars }: { pillars: PillarEvaluation[] }) {
  return (
    <Card size="sm" className="p-5 md:p-6">
      <CardContent className="space-y-4 p-0">
        <p className="text-xs font-medium text-muted-foreground">
          기둥별 판정 근거
        </p>
        <ul className="space-y-4">
          {pillars.map((p) => (
            <li key={p.pillar} className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {PILLAR_LABEL_KO[p.pillar]}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    STANCE_BADGE_CLASS[p.stance],
                  )}
                >
                  {STANCE_LABEL_KO[p.stance]}
                </span>
                {p.strength === 0 && (
                  <span className="text-[11px] italic text-muted-foreground">
                    정보 없음
                  </span>
                )}
              </div>
              <PillarScoreBar score={p.score} strength={p.strength} />
              <p className="text-xs text-muted-foreground">{p.reasonKo}</p>
              {p.missingInputs.length > 0 && (
                <p className="text-[11px] text-muted-foreground/70">
                  누락 입력: {p.missingInputs.join(", ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Signed score bar centered at 0: fills LEFT (red) for reversal
 * evidence (score < 0), RIGHT (emerald) for discount evidence
 * (score > 0). Width = |score| × half-track. Strength 0 → no fill.
 * Pure CSS, no client JS.
 */
function PillarScoreBar({
  score,
  strength,
}: {
  score: number;
  strength: number;
}) {
  const halfPct = Math.min(Math.abs(score), 1) * 50;
  const showFill = strength > 0 && halfPct > 0;
  return (
    <div
      aria-hidden
      className="relative h-1.5 w-full max-w-xs rounded-full bg-muted"
    >
      <div className="absolute left-1/2 top-0 h-full w-px bg-muted-foreground/30" />
      {showFill && (
        <div
          className={cn(
            "absolute top-0 h-full",
            score > 0
              ? "left-1/2 rounded-r-full bg-emerald-500/70"
              : "right-1/2 rounded-l-full bg-red-500/70",
          )}
          style={{ width: `${halfPct.toFixed(1)}%` }}
        />
      )}
    </div>
  );
}
