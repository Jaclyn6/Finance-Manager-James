import { Card, CardContent } from "@/components/ui/card";

interface Summary {
  totalDays: number;
  daysWithReplay: number;
  daysMissingInputs: number;
  avgAbsDelta: number | null;
  maxAbsDelta: number | null;
  daysAboveFivePp: number;
}

interface Props {
  summary: Summary;
}

/**
 * Phase 3.4 Step 5 — 4-card summary grid.
 *
 * Surfaces the most useful aggregates from a BacktestResult.summary:
 *   1. 평균 절대 차이 (avg |Δ|) — overall replay-vs-original drift
 *   2. 최대 차이 (max |Δ|) — worst-case day
 *   3. 5pp 초과 일수 — Phase 3.0 §4.4 MODEL_VERSION cutover trigger
 *   4. 입력 결손 일수 — gap-row count
 *
 * High avgAbsDelta → today's engine would have read the past
 * differently than it actually did, hint to bump MODEL_VERSION.
 * Low avgAbsDelta → engine math is stable across the picked window.
 */
export function BacktestSummary({ summary }: Props) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <SummaryCard
        label="평균 절대 차이"
        value={
          summary.avgAbsDelta !== null
            ? `${summary.avgAbsDelta.toFixed(2)} 점`
            : "—"
        }
        hint={`${summary.daysWithReplay} 일 비교`}
      />
      <SummaryCard
        label="최대 차이"
        value={
          summary.maxAbsDelta !== null
            ? `${summary.maxAbsDelta.toFixed(2)} 점`
            : "—"
        }
        hint="가장 크게 어긋난 날"
      />
      <SummaryCard
        label="5점 초과 일수"
        value={`${summary.daysAboveFivePp} 일`}
        hint="모델 버전 변경 검토 임계"
        emphasis={summary.daysAboveFivePp > 0}
      />
      <SummaryCard
        label="입력 결손 일수"
        value={`${summary.daysMissingInputs} 일`}
        hint={`전체 ${summary.totalDays} 일 중`}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint: string;
  emphasis?: boolean;
}) {
  return (
    <Card className="p-4">
      <CardContent className="space-y-1 p-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div
          className={
            emphasis
              ? "text-2xl font-bold text-amber-700 dark:text-amber-300"
              : "text-2xl font-bold text-foreground"
          }
        >
          {value}
        </div>
        <div className="text-[11px] text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}
