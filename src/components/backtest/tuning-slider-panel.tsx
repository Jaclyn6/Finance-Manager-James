"use client";

import { useEffect, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import type { AssetType, PerAssetCategoryWeights } from "@/lib/score-engine/types";
import { cn } from "@/lib/utils";

interface Props {
  assetType: AssetType;
  baselineWeights: PerAssetCategoryWeights;
  onApply: (custom: Record<AssetType, Record<string, number>>) => void;
  onReset: () => void;
  active: boolean;
}

const CATEGORY_LABELS_KO: Record<string, string> = {
  macro: "매크로",
  technical: "기술적",
  onchain: "온체인",
  sentiment: "심리/뉴스",
  valuation: "밸류에이션",
  regional_overlay: "환율/지역",
};

/**
 * Phase 3.4 Step 7 — tuning slider panel.
 *
 * Lets the user drag category-weight sliders for the currently
 * selected asset type and POST a backtest with `customWeights`
 * inline. The backend stamps weights_version with a hash suffix.
 *
 * UX choices:
 * - Show only the categories that exist for the current asset type
 *   (e.g. crypto has onchain but no valuation; KR has regional_overlay).
 * - Each slider 0-100 in 1-pt increments. Sum != 100 is allowed —
 *   the engine renormalizes per blueprint §2.2 tenet 1.
 * - "초기화" reverts to baseline + clears the override.
 * - "적용 후 재실행" callback hands the panel's local state to the
 *   parent, which fires a fresh POST.
 * - "이름 붙여 저장" (SaveWeightsButton) POSTs the draft to
 *   `/api/backtest/save-weights` — does not auto-apply.
 */
export function TuningSliderPanel({
  assetType,
  baselineWeights,
  onApply,
  onReset,
  active,
}: Props) {
  // Local slider state, seeded from baseline.
  const [draft, setDraft] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      Object.entries(baselineWeights).filter(
        ([, v]) => typeof v === "number",
      ) as Array<[string, number]>,
    ),
  );

  // When the user changes asset type at the controls panel, reseed
  // the sliders to the new baseline.
  useEffect(() => {
    setDraft(
      Object.fromEntries(
        Object.entries(baselineWeights).filter(
          ([, v]) => typeof v === "number",
        ) as Array<[string, number]>,
      ),
    );
  }, [baselineWeights, assetType]);

  function handleApply() {
    const custom = {
      [assetType]: draft,
    } as Record<AssetType, Record<string, number>>;
    onApply(custom);
  }

  function handleReset() {
    setDraft(
      Object.fromEntries(
        Object.entries(baselineWeights).filter(
          ([, v]) => typeof v === "number",
        ) as Array<[string, number]>,
      ),
    );
    onReset();
  }

  const totalDraft = Object.values(draft).reduce((a, b) => a + b, 0);
  const totalBaseline = Object.values(baselineWeights).reduce(
    (a: number, b) => a + (typeof b === "number" ? b : 0),
    0,
  );

  return (
    <Card className="p-4 md:p-6">
      <CardContent className="space-y-3 p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">
            가중치 튜닝
            <span className="ml-2 text-[11px] font-normal text-muted-foreground">
              ({CATEGORY_LABELS_KO[assetType] ?? assetType})
            </span>
          </h2>
          <span className="text-[11px] text-muted-foreground">
            합계 {totalDraft} (기본 {totalBaseline}). 합이 100이 아니어도 엔진이 자동 정규화합니다.
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(draft).map(([cat, val]) => (
            <div key={cat} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor={`weight-${cat}`} className="text-muted-foreground">
                  {CATEGORY_LABELS_KO[cat] ?? cat}
                </label>
                <span className="tabular-nums font-medium">
                  {val}
                  <span className="ml-1 text-muted-foreground">
                    (기본 {baselineWeights[cat as keyof typeof baselineWeights] ?? "—"})
                  </span>
                </span>
              </div>
              <input
                id={`weight-${cat}`}
                type="range"
                min={0}
                max={100}
                step={1}
                value={val}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    [cat]: Number(e.target.value),
                  }))
                }
                className="h-2 w-full cursor-pointer rounded-lg bg-muted accent-brand"
                aria-label={`${CATEGORY_LABELS_KO[cat] ?? cat} 가중치`}
              />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={handleApply}
            className={cn(
              "h-9 rounded-md bg-brand px-3 text-xs font-semibold text-white transition-colors",
              "hover:bg-brand/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            )}
          >
            적용 (다음 백테스트에 반영)
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="h-9 rounded-md border px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted/40"
          >
            초기화
          </button>
          <SaveWeightsButton draft={draft} assetType={assetType} />
          {active ? (
            <span className="self-center text-[11px] text-amber-700 dark:text-amber-300">
              ✓ 적용됨 — 백테스트 실행 시 사용
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Phase 3.4 Step 7b — "이름 붙여 저장" mini-form.
 *
 * Inline expanding text input + 저장 button. POSTs to
 * `/api/backtest/save-weights` and toasts on success. Does NOT
 * automatically apply the saved weights — user still needs to click
 * "적용" if they want to backtest with them.
 */
function SaveWeightsButton({
  draft,
  assetType,
}: {
  draft: Record<string, number>;
  assetType: AssetType;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      const payload = {
        // Wrap the slider draft as a single-asset categoryWeights map so the
        // server-side API stamps weights_version with the same hash shape
        // it would for inline customWeights.
        categoryWeights: { [assetType]: draft },
        // Mirror the EngineWeights interface minimally — modelVersion +
        // signalRulesVersion are stamped at save time so cross-version
        // comparison is reproducible later.
        modelVersion: "v2.0.0",
        signalRulesVersion: "v1.0.0",
      };
      const res = await fetch("/api/backtest/save-weights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), payload }),
      });
      if (!res.ok) {
        const t = await res.text();
        setFeedback(`저장 실패: ${t}`);
      } else {
        setFeedback("저장 완료 ✓");
        setOpen(false);
        setName("");
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-9 rounded-md border px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted/40"
      >
        이름 붙여 저장
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="예: 내 v3 가설"
        maxLength={60}
        className="h-9 rounded-md border bg-background px-2 text-xs"
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={busy || !name.trim()}
        className={cn(
          "h-9 rounded-md bg-foreground px-3 text-xs font-semibold text-background transition-colors",
          "hover:opacity-90 disabled:opacity-50",
        )}
      >
        {busy ? "저장 중…" : "저장"}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setName("");
        }}
        className="h-9 rounded-md border px-3 text-xs"
      >
        취소
      </button>
      {feedback ? (
        <span className="text-[11px] text-muted-foreground">{feedback}</span>
      ) : null}
    </div>
  );
}
