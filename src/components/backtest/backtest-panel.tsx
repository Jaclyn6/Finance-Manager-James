"use client";

import { useState, useTransition } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { CATEGORY_WEIGHTS } from "@/lib/score-engine/weights";
import type { AssetType } from "@/lib/score-engine/types";
import { cn } from "@/lib/utils";

import { BacktestChart } from "./backtest-chart";
import { BacktestDeviationTable } from "./backtest-deviation-table";
import { BacktestSummary } from "./backtest-summary";
import { TuningSliderPanel } from "./tuning-slider-panel";

/**
 * Phase 3.4 Step 5 — interactive client panel that owns the
 * backtest form + result rendering. Posts to /api/backtest/run on
 * submit, re-renders with the BacktestResult.
 *
 * Sub-components:
 * - BacktestChart (Recharts dual-line: replay vs original)
 * - BacktestSummary (4 cards: avg/max delta, days >5pp, gap days)
 * - BacktestDeviationTable (per-day rows, simple list at base scope)
 * - TuningSliderPanel (Step 7 — editable category weights + save)
 */

export interface InitialState {
  assetType: AssetType;
  dateRange: { from: string; to: string };
  weightsVersion: string;
}

interface Props {
  initial: InitialState;
  modelVersion: string;
  availableWeightsVersions: readonly string[];
}

interface BacktestSnapshotRow {
  date: string;
  replayScore: number | null;
  replayBand: string | null;
  originalScore: number | null;
  originalModelVersion: string | null;
  delta: number | null;
  gaps: ReadonlyArray<string>;
}

interface BacktestSummaryShape {
  totalDays: number;
  daysWithReplay: number;
  daysMissingInputs: number;
  avgAbsDelta: number | null;
  maxAbsDelta: number | null;
  daysAboveFivePp: number;
}

interface BacktestResultShape {
  request: {
    weightsVersion: string;
    modelVersion: string;
    assetType: AssetType;
    dateRange: { from: string; to: string };
  };
  snapshots: BacktestSnapshotRow[];
  summary: BacktestSummaryShape;
}

const ASSET_TYPE_OPTIONS: ReadonlyArray<{
  value: AssetType;
  labelKo: string;
}> = [
  { value: "us_equity", labelKo: "미국 주식" },
  { value: "kr_equity", labelKo: "한국 주식" },
  { value: "crypto", labelKo: "암호화폐" },
  { value: "global_etf", labelKo: "글로벌 ETF" },
];

export function BacktestPanel({
  initial,
  modelVersion,
  availableWeightsVersions,
}: Props) {
  const [assetType, setAssetType] = useState<AssetType>(initial.assetType);
  const [from, setFrom] = useState(initial.dateRange.from);
  const [to, setTo] = useState(initial.dateRange.to);
  const [weightsVersion, setWeightsVersion] = useState(initial.weightsVersion);
  // Custom weights — populated by TuningSliderPanel; null = use registry version.
  const [customCategoryWeights, setCustomCategoryWeights] = useState<
    Record<AssetType, Record<string, number>> | null
  >(null);

  const [result, setResult] = useState<BacktestResultShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRun() {
    setError(null);
    startTransition(async () => {
      const body: Record<string, unknown> = {
        assetType,
        modelVersion,
        weightsVersion,
        dateRange: { from, to },
      };
      // Step 7 — when tuning slider has produced custom weights, send
      // them inline. The route stamps weights_version =
      // `custom-{hash}` derived from the payload.
      if (customCategoryWeights) {
        body.customWeights = customCategoryWeights;
      }
      try {
        const res = await fetch("/api/backtest/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text();
          let parsed = text;
          try {
            const j = JSON.parse(text) as { error?: string };
            if (j.error) parsed = j.error;
          } catch {
            // not JSON, use raw text
          }
          setError(`HTTP ${res.status}: ${parsed}`);
          return;
        }
        const data = (await res.json()) as BacktestResultShape;
        setResult(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      {/* ---- Controls ---- */}
      <Card className="p-6 md:p-8">
        <CardContent className="flex flex-col gap-4 p-0">
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="자산군">
              <select
                value={assetType}
                onChange={(e) => setAssetType(e.target.value as AssetType)}
                className="h-11 w-full rounded-md border bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="자산군 선택"
              >
                {ASSET_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.labelKo}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="시작일">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-11 w-full rounded-md border bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="시작일"
              />
            </Field>
            <Field label="종료일">
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-11 w-full rounded-md border bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="종료일"
              />
            </Field>
            <Field label="가중치 버전">
              <select
                value={weightsVersion}
                onChange={(e) => {
                  setWeightsVersion(e.target.value);
                  setCustomCategoryWeights(null); // any registry pick clears tuning override
                }}
                className="h-11 w-full rounded-md border bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="가중치 버전 선택"
                disabled={customCategoryWeights !== null}
              >
                {availableWeightsVersions.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleRun}
              disabled={isPending}
              className={cn(
                "inline-flex h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-white transition-colors",
                "hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              )}
            >
              {isPending ? "백테스트 실행 중…" : "백테스트 실행"}
            </button>
            {customCategoryWeights ? (
              <span className="text-[11px] text-amber-700 dark:text-amber-300">
                ⚙ 사용자 정의 가중치 적용 중 (튜닝 슬라이더 기준)
              </span>
            ) : null}
          </div>

          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ---- Tuning slider (Step 7) ---- */}
      <TuningSliderPanel
        assetType={assetType}
        baselineWeights={CATEGORY_WEIGHTS[assetType]}
        onApply={(custom) => {
          setCustomCategoryWeights(custom);
        }}
        onReset={() => setCustomCategoryWeights(null)}
        active={customCategoryWeights !== null}
      />

      {/* ---- Result ---- */}
      {result ? (
        <>
          <BacktestSummary summary={result.summary} />
          <BacktestChart snapshots={result.snapshots} />
          <BacktestDeviationTable snapshots={result.snapshots} />
        </>
      ) : (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {isPending
            ? "결과를 계산 중입니다…"
            : "위 옵션을 선택하고 \"백테스트 실행\"을 누르면 결과가 표시됩니다."}
        </Card>
      )}
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}
