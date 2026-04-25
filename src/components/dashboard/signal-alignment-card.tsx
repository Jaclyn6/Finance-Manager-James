"use client";

import { Check, CircleQuestionMark, Minus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  signalsForAssetType,
  type SignalDetail,
  type SignalName,
  type SignalState,
} from "@/lib/score-engine/signals";
import type { AssetType } from "@/lib/score-engine/types";
import {
  describeSignalSituation,
  resolveAlignmentBadge,
  SIGNAL_DESCRIPTION_KO,
  SIGNAL_FULL_NAMES_KO,
  SIGNAL_LABELS_KO,
  SIGNAL_STATE_LABEL_KO,
  SIGNAL_THRESHOLD_KO,
} from "@/lib/utils/signal-labels";
import { cn } from "@/lib/utils";
import type { Tables } from "@/types/database";

/**
 * "매수 신호 정렬" hero card — blueprint §9 Step 8.5, PRD §10.4.
 *
 * Sits ABOVE the {@link CompositeStateCard} on both the dashboard and
 * asset pages (plan §0.5 tenet 4 "actionable over aggregate" — the
 * signal count is more actionable than the composite score). Reads
 * `signal_events` via {@link getLatestSignalEvent} in the parent Server
 * Component and receives a pre-shaped, date-filtered row as a prop.
 *
 * ─ Why Client Component ─────────────────────────────────────────────
 *
 * Tooltips from `@base-ui/react` need the client boundary for hover /
 * focus state. Rather than splitting the tile into a Server wrapper
 * plus Client tooltip — which fragments the aria relationships — the
 * entire card is client-side. The parent Server Component does all the
 * Supabase reads so this file never imports the admin client.
 *
 * ─ Per-signal states ───────────────────────────────────────────────
 *
 * `active` / `inactive` / `unknown` from the engine. The tile
 * differentiates via THREE affordances simultaneously (never color
 * alone, per blueprint §10):
 *
 *   1. Background tint (green / grey / amber)
 *   2. Icon (check / minus / question-mark)
 *   3. Caption text (조건 충족 / 조건 미충족 / 데이터 부족)
 *
 * ─ Empty state ─────────────────────────────────────────────────────
 *
 * `signalEvent === null` → compact placeholder, no tile grid. Happens
 * on the first day of Phase 2 deployment before any cron has run.
 *
 * ─ a11y ─────────────────────────────────────────────────────────────
 *
 * - Outer `<section role="region" aria-labelledby="signal-alignment-heading">`.
 * - Tile grid is a `<ul role="list">` with each tile a native `<li>`
 *   (listitem role is implicit). Each tile's interactive trigger carries
 *   an `aria-label` that states the name AND state AND input values.
 * - Disclaimer text is NOT aria-hidden — SR users need the "본인 판단"
 *   caveat just as much as sighted users.
 */
export interface SignalAlignmentCardProps {
  signalEvent: Pick<
    Tables<"signal_events">,
    | "active_signals"
    | "alignment_count"
    | "per_signal_detail"
    | "snapshot_date"
    | "signal_rules_version"
  > | null;
  assetType: AssetType;
  /**
   * True when the row's `signal_rules_version` differs from the
   * engine-current {@link SIGNAL_RULES_VERSION}. Parents compute this
   * once per render from the loaded signal_events row and pass it in,
   * keeping this component decoupled from the weights module.
   * Surfaces a "규칙 전환일" badge so users viewing a historical
   * snapshot know the thresholds may differ from today's engine.
   */
  isRulesCutoverDay?: boolean;
}

export function SignalAlignmentCard({
  signalEvent,
  assetType,
  isRulesCutoverDay = false,
}: SignalAlignmentCardProps) {
  const applicableSignals = signalsForAssetType(assetType);
  const applicableCount = applicableSignals.length;

  // ---- Empty state ----
  if (signalEvent === null) {
    const badge = resolveAlignmentBadge(0);
    return (
      <Card
        className="p-6 md:p-10"
        role="region"
        aria-labelledby="signal-alignment-heading"
      >
        <CardHeader className="p-0 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2
                id="signal-alignment-heading"
                className="text-sm text-muted-foreground"
              >
                매수 신호 정렬
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {applicableCount}가지 독립 매수 조건 중 몇 개가 현재 충족되는가
              </p>
            </div>
            <span
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold",
                badge.className,
              )}
            >
              {badge.label}
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <p className="text-sm text-muted-foreground">
            신호 데이터를 수집 중입니다. 다음 크론 실행 이후 표시됩니다.
          </p>
          <Disclaimer />
        </CardContent>
      </Card>
    );
  }

  // ---- Active / computed state ----
  const perSignal = parsePerSignalDetail(signalEvent.per_signal_detail);
  const activeSet = parseActiveSignals(signalEvent.active_signals);

  // Filter to this asset type's applicable signals — the N/M count must
  // reflect ONLY those, NOT the engine's full 8-signal superset.
  const applicableActive = applicableSignals.filter((s) => activeSet.has(s));
  const applicableActiveCount = applicableActive.length;
  const badge = resolveAlignmentBadge(applicableActiveCount);

  return (
    <TooltipProvider>
      <Card
        className="p-6 md:p-10"
        role="region"
        aria-labelledby="signal-alignment-heading"
      >
        <CardContent className="flex flex-col gap-4 p-0">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2
                id="signal-alignment-heading"
                className="text-xs text-muted-foreground"
              >
                매수 신호 정렬
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {applicableCount}가지 독립 매수 조건 중 몇 개가 현재 충족되는가
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isRulesCutoverDay ? (
                <Badge
                  variant="outline"
                  className="border-amber-500/40 text-[11px] text-amber-700 dark:text-amber-300"
                >
                  규칙 전환일
                </Badge>
              ) : null}
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-sm font-semibold",
                  badge.className,
                )}
              >
                {badge.label}
              </span>
            </div>
          </header>

          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <span
              className="font-bold leading-none tracking-tight text-foreground tabular-nums"
              style={{ fontSize: "clamp(2rem, 8vw, 3rem)" }}
              aria-label={`현재 ${applicableActiveCount} / ${applicableCount} 신호 활성`}
            >
              {applicableActiveCount}
              <span className="text-muted-foreground">/</span>
              {applicableCount}
            </span>
          </div>

          <ul
            role="list"
            className="grid grid-cols-2 gap-2 md:grid-cols-3"
          >
            {applicableSignals.map((name) => {
              const detail = perSignal[name];
              const state = detail?.state ?? "unknown";
              return (
                <SignalTile
                  key={name}
                  name={name}
                  detail={detail ?? null}
                  state={state}
                />
              );
            })}
          </ul>

          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>{signalEvent.snapshot_date}</span>
            <span aria-hidden>·</span>
            <span>규칙 {signalEvent.signal_rules_version}</span>
          </div>

          <Disclaimer />
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

/**
 * Individual signal tile — 44×44 min touch target, state-tinted bg, an
 * icon for redundancy-with-color, and a Tooltip revealing inputs +
 * threshold formula on hover / focus.
 */
function SignalTile({
  name,
  detail,
  state,
}: {
  name: SignalName;
  detail: SignalDetail | null;
  state: SignalState;
}) {
  const shortLabel = SIGNAL_LABELS_KO[name];
  const fullLabel = SIGNAL_FULL_NAMES_KO[name];
  const threshold = SIGNAL_THRESHOLD_KO[name];
  const description = SIGNAL_DESCRIPTION_KO[name];
  const stateCaption = SIGNAL_STATE_LABEL_KO[state];
  const situation = describeSignalSituation(name, detail ?? null);
  // Blueprint §4.5 line 384 requires the announcement to include the
  // underlying input values so SR users get the same "why" context
  // sighted users get from the tooltip (e.g.
  // "시장 극단 공포 — 조건 충족 (VIX 37, CNN F&G 22 — 시장이 공포에 빠진 상태)").
  const ariaLabel = `${fullLabel} — ${stateCaption}. ${situation}`;

  return (
    <li>
      <Tooltip>
        <TooltipTrigger
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "flex min-h-11 min-w-11 w-full flex-col items-start gap-2 rounded-lg border p-3 text-left motion-safe:transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            STATE_PALETTE[state],
          )}
        >
          <div className="flex w-full items-center justify-between gap-1">
            <span className="text-sm font-semibold tracking-tight">
              {shortLabel}
            </span>
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  STATE_BADGE[state],
                )}
              >
                {stateCaption}
              </span>
              <StateIcon state={state} />
            </div>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {description}
          </p>
          <p className="text-[11px] leading-snug font-medium text-foreground/80">
            지금: {situation}
          </p>
        </TooltipTrigger>
        <TooltipContent side="top" align="center">
          <div className="space-y-1.5">
            <div className="text-sm font-semibold">{fullLabel}</div>
            <div className="text-[11px] opacity-80">{threshold}</div>
            <div className="text-[11px] opacity-90">
              {renderInputs(detail?.inputs)}
            </div>
            <div className="text-[11px] font-medium opacity-90">
              지금 상태: {stateCaption}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

function renderInputs(
  inputs: Record<string, number | null> | undefined,
): string {
  if (!inputs || Object.keys(inputs).length === 0) {
    return "입력값 없음";
  }
  return Object.entries(inputs)
    .map(([k, v]) => {
      if (v === null || v === undefined) return `${k}=—`;
      return `${k}=${formatInput(v)}`;
    })
    .join(", ");
}

function formatInput(v: number): string {
  if (!Number.isFinite(v)) return "—";
  // Small floats get 3 decimals; larger numbers (e.g. ICSA=300000) get
  // thousand-separated integers. Simple heuristic — tooltips are
  // informal; no need for a full formatter stack.
  const abs = Math.abs(v);
  if (abs < 10) return (Math.round(v * 1000) / 1000).toString();
  if (abs < 1000) return (Math.round(v * 10) / 10).toString();
  return Math.round(v).toLocaleString("en-US");
}

function StateIcon({ state }: { state: SignalState }) {
  if (state === "active") {
    return (
      <Check
        aria-hidden="true"
        focusable="false"
        className="size-4 text-emerald-700 dark:text-emerald-300"
      />
    );
  }
  if (state === "unknown") {
    return (
      <CircleQuestionMark
        aria-hidden="true"
        focusable="false"
        className="size-4 text-amber-700 dark:text-amber-300"
      />
    );
  }
  return (
    <Minus
      aria-hidden="true"
      focusable="false"
      className="size-4 text-muted-foreground"
    />
  );
}

function Disclaimer() {
  // PRD §13.2 — legally required caveat. Not aria-hidden.
  return (
    <p className="pt-2 text-[11px] leading-snug text-muted-foreground">
      실제 자산 배분은 본인 판단입니다. 모델은 과거 평균 패턴 기반 확률적
      판단 도구입니다.
    </p>
  );
}

const STATE_PALETTE: Record<SignalState, string> = {
  active:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
  inactive: "border-border bg-muted/40 text-foreground",
  unknown:
    "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100",
};

/** Inline state pill — paired with the icon for non-color-alone reading. */
const STATE_BADGE: Record<SignalState, string> = {
  active:
    "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
  inactive: "bg-muted text-muted-foreground",
  unknown: "bg-amber-500/15 text-amber-800 dark:text-amber-200",
};

// ---------------------------------------------------------------------------
// Parsers — defensive against the loose `Json` type from Supabase
// ---------------------------------------------------------------------------

/**
 * `per_signal_detail` on the DB row is typed `Json`. Reshape into a
 * partial `Record<SignalName, SignalDetail>`, silently dropping
 * entries whose shape is off so a corrupt payload can't crash the UI.
 * Exported for unit tests.
 */
export function parsePerSignalDetail(
  raw: unknown,
): Partial<Record<SignalName, SignalDetail>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Partial<Record<SignalName, SignalDetail>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const rec = value as Record<string, unknown>;
    const state = rec.state;
    if (state !== "active" && state !== "inactive" && state !== "unknown") continue;
    const threshold = typeof rec.threshold === "string" ? rec.threshold : "";
    const rawInputs = rec.inputs;
    const inputs: Record<string, number | null> = {};
    if (rawInputs && typeof rawInputs === "object" && !Array.isArray(rawInputs)) {
      for (const [ik, iv] of Object.entries(rawInputs as Record<string, unknown>)) {
        if (iv === null) inputs[ik] = null;
        else if (typeof iv === "number" && Number.isFinite(iv)) inputs[ik] = iv;
        // Non-number non-null values silently skipped.
      }
    }
    out[key as SignalName] = { state, inputs, threshold };
  }
  return out;
}

/**
 * `active_signals` on the DB row is typed `Json`. Coerce to `Set<SignalName>`,
 * ignoring non-string entries. Exported for unit tests.
 */
export function parseActiveSignals(raw: unknown): Set<SignalName> {
  const out = new Set<SignalName>();
  if (!Array.isArray(raw)) return out;
  for (const v of raw) {
    if (typeof v === "string") out.add(v as SignalName);
  }
  return out;
}
