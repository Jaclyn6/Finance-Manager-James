import { Card, CardContent } from "@/components/ui/card";
import type { VerdictHistoryEntry } from "@/lib/data/advisor";
import { cn } from "@/lib/utils";
import {
  VERDICT_DOT_CLASS,
  VERDICT_LABEL_KO,
} from "@/lib/utils/verdict-labels";

/**
 * Verdict timeline strip — "판정이 언제 바뀌었나" at a glance for
 * `/asset/[slug]` (verdict history part 3/3).
 *
 * One colored square per persisted day (label → VERDICT_DOT_CLASS,
 * same semantics as the verdict pill), plus a text note for the most
 * recent label flip. History only started accumulating on 2026-07-08
 * (migration 0015), so the strip declares how many days it holds
 * instead of faking depth — loud absence over fabricated history.
 *
 * Server component, pure CSS. Each square carries a `title` tooltip
 * with the day's label + net score for hover forensics.
 */
export function VerdictTimeline({
  entries,
}: {
  entries: VerdictHistoryEntry[];
}) {
  if (entries.length === 0) return null;

  const lastFlip = findLastFlip(entries);
  const latest = entries[entries.length - 1];

  return (
    <Card size="sm" className="p-5 md:p-6">
      <CardContent className="space-y-3 p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            판정 타임라인
          </p>
          <p className="text-[11px] text-muted-foreground">
            {entries.length}일 기록 (2026-07-08 수집 시작)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {entries.map((entry) => (
            <span
              key={entry.verdictDate}
              title={`${entry.verdictDate} — ${VERDICT_LABEL_KO[entry.label]}${
                entry.netScore !== null
                  ? ` (근거 균형 ${entry.netScore >= 0 ? "+" : ""}${entry.netScore.toFixed(2)})`
                  : ""
              }`}
              className={cn(
                "size-3 rounded-[3px]",
                VERDICT_DOT_CLASS[entry.label],
                entry.verdictDate === latest.verdictDate &&
                  "ring-2 ring-ring ring-offset-1 ring-offset-card",
              )}
            />
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          {lastFlip
            ? `최근 변화: ${lastFlip.date} — ${VERDICT_LABEL_KO[lastFlip.from]} → ${VERDICT_LABEL_KO[lastFlip.to]}`
            : `기록된 기간 내 판정 변화 없음 — 계속 ${VERDICT_LABEL_KO[latest.label]}`}
        </p>
      </CardContent>
    </Card>
  );
}

function findLastFlip(
  entries: VerdictHistoryEntry[],
): { date: string; from: VerdictHistoryEntry["label"]; to: VerdictHistoryEntry["label"] } | null {
  for (let i = entries.length - 1; i >= 1; i--) {
    if (entries[i].label !== entries[i - 1].label) {
      return {
        date: entries[i].verdictDate,
        from: entries[i - 1].label,
        to: entries[i].label,
      };
    }
  }
  return null;
}
