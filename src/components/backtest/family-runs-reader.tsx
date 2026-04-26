"use client";

import { useEffect, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface FamilyRunRow {
  id: string;
  user_id: string | null;
  user_email: string | null; // resolved family-side via auth metadata
  asset_type: string;
  date_from: string;
  date_to: string;
  weights_version: string;
  avg_abs_delta: number | null;
  days_above_5pp: number;
  created_at: string;
}

interface Props {
  initialRows: ReadonlyArray<FamilyRunRow>;
  currentUserId: string | null;
}

/**
 * Phase 3.4 Step 8 — family-shared backtest runs reader.
 *
 * Lists OTHER family members' recent backtests so jw.byun /
 * edc0422 / odete4 can see what the others are exploring. Excludes
 * the current user's own runs (those are surfaced elsewhere — for
 * Phase 3.4 base, just on the controls panel as inferred from the
 * URL once a click navigates with ?asset/?from/?to).
 *
 * Click a row → navigates to /backtest with searchParams pre-filled
 * so the panel re-runs (memoization will hit cache → instant).
 *
 * RLS allows authenticated read on backtest_runs; family-wide
 * sharing is the §7 #2 OOS-brought-in-scope feature.
 */
export function FamilyRunsReader({ initialRows, currentUserId }: Props) {
  const [rows] = useState(initialRows);
  const others = rows.filter((r) => r.user_id !== currentUserId);

  if (others.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        다른 가족이 만든 백테스트가 아직 없습니다.
      </Card>
    );
  }

  return (
    <Card className="p-4 md:p-6">
      <CardContent className="space-y-3 p-0">
        <h2 className="text-sm font-semibold text-foreground">
          다른 가족이 만든 백테스트
          <span className="ml-2 text-[11px] font-normal text-muted-foreground">
            (최근 {others.length}건)
          </span>
        </h2>
        <ul className="divide-y">
          {others.map((row) => (
            <li key={row.id} className="py-2.5">
              <a
                href={`/backtest?asset=${row.asset_type}&from=${row.date_from}&to=${row.date_to}&weights=${row.weights_version}`}
                className={cn(
                  "block rounded-md p-1 text-sm transition-colors",
                  "hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <span className="font-medium">{row.user_email ?? "?"}</span>
                    <span className="ml-2 text-muted-foreground">
                      {assetLabel(row.asset_type)} ·{" "}
                      {row.date_from} → {row.date_to}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {formatRelative(row.created_at)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                  <span>가중치: {row.weights_version}</span>
                  {row.avg_abs_delta !== null ? (
                    <span>
                      평균 차이 {row.avg_abs_delta.toFixed(2)} 점
                    </span>
                  ) : null}
                  {row.days_above_5pp > 0 ? (
                    <span className="text-amber-700 dark:text-amber-300">
                      5점 초과 {row.days_above_5pp}일
                    </span>
                  ) : null}
                </div>
              </a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const ASSET_LABELS: Record<string, string> = {
  us_equity: "미국 주식",
  kr_equity: "한국 주식",
  crypto: "암호화폐",
  global_etf: "글로벌 ETF",
  common: "공통",
};

function assetLabel(t: string): string {
  return ASSET_LABELS[t] ?? t;
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diffMs = Date.now() - t;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}일 전`;
  return new Date(t).toISOString().slice(0, 10);
}
