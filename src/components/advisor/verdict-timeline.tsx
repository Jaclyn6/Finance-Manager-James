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
 * The strip is CALENDAR-shaped: one cell per day from the window's
 * first persisted row to its last. Days with a verdict render the
 * label color (VERDICT_DOT_CLASS, same semantics as the pill); days
 * WITHOUT one (cron outage) render an outlined gap cell — a missing
 * day must look missing, not silently compress into a contiguous-
 * looking strip (loud absence over fabricated history; caption dates
 * derive from the data, never hardcoded).
 *
 * Server component, pure CSS. Each cell carries a `title` tooltip
 * with the day's label + net score (or 기록 없음) for hover forensics.
 */
export function VerdictTimeline({
  entries,
}: {
  entries: VerdictHistoryEntry[];
}) {
  if (entries.length === 0) return null;

  const lastFlip = findLastFlip(entries);
  const latest = entries[entries.length - 1];
  const first = entries[0];
  const days = calendarDays(first.verdictDate, latest.verdictDate);
  const byDate = new Map(entries.map((e) => [e.verdictDate, e]));

  return (
    <Card size="sm" className="p-5 md:p-6">
      <CardContent className="space-y-3 p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            판정 타임라인
          </p>
          <p className="text-[11px] text-muted-foreground">
            {first.verdictDate} ~ {latest.verdictDate} · 기록 {entries.length}일
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {days.map((date) => {
            const entry = byDate.get(date);
            if (!entry) {
              return (
                <span
                  key={date}
                  title={`${date} — 기록 없음`}
                  className="size-3 rounded-[3px] border border-dashed border-muted-foreground/40"
                />
              );
            }
            return (
              <span
                key={date}
                title={`${date} — ${VERDICT_LABEL_KO[entry.label]}${
                  entry.netScore !== null
                    ? ` (근거 균형 ${entry.netScore >= 0 ? "+" : ""}${entry.netScore.toFixed(2)})`
                    : ""
                }`}
                className={cn(
                  "size-3 rounded-[3px]",
                  VERDICT_DOT_CLASS[entry.label],
                  date === latest.verdictDate &&
                    "ring-2 ring-ring ring-offset-1 ring-offset-card",
                )}
              />
            );
          })}
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

/** Inclusive YYYY-MM-DD day list; hard-capped defensively at 95 cells. */
function calendarDays(first: string, last: string): string[] {
  const out: string[] = [];
  const startMs = Date.parse(`${first}T00:00:00Z`);
  const endMs = Date.parse(`${last}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return [first, last].filter((d, i, a) => a.indexOf(d) === i);
  }
  for (
    let ms = startMs;
    ms <= endMs && out.length < 95;
    ms += 24 * 60 * 60 * 1000
  ) {
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
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
