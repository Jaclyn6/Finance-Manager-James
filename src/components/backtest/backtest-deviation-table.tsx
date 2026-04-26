"use client";

import { useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Snapshot {
  date: string;
  replayScore: number | null;
  replayBand: string | null;
  originalScore: number | null;
  originalModelVersion: string | null;
  delta: number | null;
  gaps: ReadonlyArray<string>;
}

interface Props {
  snapshots: ReadonlyArray<Snapshot>;
}

const PAGE_SIZE = 30;

/**
 * Phase 3.4 Step 5 — per-day deviation table.
 *
 * Columns: 날짜 | 그때 점수 | 지금 점수 | 차이 | gaps. Gap rows
 * (no replay) get a grey + ⚠ icon row so they're distinct from
 * deltas of 0.
 *
 * Pagination is simple "이전 / 다음" buttons at 30 rows per page.
 */
export function BacktestDeviationTable({ snapshots }: Props) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(snapshots.length / PAGE_SIZE));
  const visible = snapshots.slice(
    page * PAGE_SIZE,
    page * PAGE_SIZE + PAGE_SIZE,
  );

  return (
    <Card className="p-4 md:p-6">
      <CardContent className="space-y-3 p-0">
        <h2 className="text-sm font-semibold text-foreground">일별 편차</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">날짜</th>
                <th className="py-2 pr-3 font-medium text-right">그때</th>
                <th className="py-2 pr-3 font-medium text-right">지금</th>
                <th className="py-2 pr-3 font-medium text-right">차이</th>
                <th className="py-2 font-medium">참고</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => {
                const isGap = s.replayScore === null;
                return (
                  <tr
                    key={s.date}
                    className={cn(
                      "border-b last:border-0",
                      isGap && "text-muted-foreground",
                    )}
                  >
                    <td className="py-1.5 pr-3 tabular-nums">{s.date}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {s.originalScore !== null
                        ? s.originalScore.toFixed(2)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {s.replayScore !== null
                        ? s.replayScore.toFixed(2)
                        : "—"}
                    </td>
                    <td
                      className={cn(
                        "py-1.5 pr-3 text-right tabular-nums",
                        s.delta !== null && Math.abs(s.delta) > 5
                          ? "font-medium text-amber-700 dark:text-amber-300"
                          : "",
                      )}
                    >
                      {s.delta !== null
                        ? `${s.delta >= 0 ? "+" : ""}${s.delta.toFixed(2)}`
                        : "—"}
                    </td>
                    <td className="py-1.5 text-[11px] text-muted-foreground">
                      {isGap ? `⚠ ${s.gaps.join("; ")}` : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {totalPages > 1 ? (
          <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded border px-2 py-1 disabled:opacity-40"
            >
              이전
            </button>
            <span>
              {page + 1} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="rounded border px-2 py-1 disabled:opacity-40"
            >
              다음
            </button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
