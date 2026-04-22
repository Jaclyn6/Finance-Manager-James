import { ExternalLink } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { INDICATOR_CONFIG } from "@/lib/score-engine/weights";
import { cn } from "@/lib/utils";
import type { Json, Tables } from "@/types/database";

/**
 * Breakdown card — answers "왜 이 점수인가?" for a composite snapshot.
 *
 * Reads `composite_snapshots.contributing_indicators` (JSONB shape
 * `{ [key]: { score, weight, contribution } }` written by
 * `computeComposite`) and renders one row per indicator. Each row
 * shows the Korean description, the 0-100 score, the normalized
 * weight, the contribution (score × weight), and a small external
 * link to the upstream source per PRD §16.2 "데이터 출처가 화면에
 * 표시되어야 한다".
 *
 * Server Component — no interactivity, no reliance on `new Date()`.
 * The raw JSONB from Supabase is typed as `Json` which is loosely
 * unknown; we `parseContributing` defensively before render so a
 * corrupted row can't crash the asset page.
 *
 * Sorting: descending by `|contribution|` so the biggest movers sit at
 * the top. Ties break by key name for stable deterministic order.
 *
 * v2.2 mobile scope — this component uses `grid` with `grid-cols-1
 * md:grid-cols-[1fr_auto]` so the metrics column collapses underneath
 * the label on `<md`, avoiding horizontal overflow at 375px.
 */
export interface ContributingIndicatorsProps {
  contributing: Json;
}

interface ParsedContribution {
  key: string;
  score: number;
  weight: number;
  contribution: number;
}

export function ContributingIndicators({
  contributing,
}: ContributingIndicatorsProps) {
  const rows = parseContributing(contributing);

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <h2 className="font-heading text-base leading-snug font-medium">
            기여 지표
          </h2>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            이 스냅샷에는 기록된 기여 지표가 없습니다.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="font-heading text-base leading-snug font-medium">
          기여 지표
        </h2>
        <p className="text-xs text-muted-foreground">
          각 지표의 0-100 점수에 가중치를 곱한 값이 합성 점수에 기여합니다.
        </p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {rows.map((row) => {
            const config = INDICATOR_CONFIG[row.key];
            const label = config?.descriptionKo ?? row.key;
            return (
              <li
                key={row.key}
                className="grid gap-2 border-b border-border/60 pb-3 last:border-0 last:pb-0 md:grid-cols-[1fr_auto] md:items-start md:gap-6"
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">{label}</p>
                  {config ? (
                    <a
                      href={config.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {config.sourceName} / {row.key}
                      <ExternalLink
                        aria-hidden="true"
                        focusable="false"
                        className="size-3"
                      />
                      {/*
                        Screen-reader-only suffix announces the context
                        change before activation. `target="_blank"`
                        alone is a WCAG 3.2.5 / G201 oversight — SR
                        users don't expect a new tab unless told.
                        Visually hidden (`sr-only`) so sighted users
                        see the icon, not the text.
                      */}
                      <span className="sr-only">(새 창에서 열기)</span>
                    </a>
                  ) : (
                    <p className="text-xs text-muted-foreground">{row.key}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums md:justify-end md:text-right">
                  <Metric label="점수" value={formatScore(row.score)} />
                  <Metric label="가중치" value={formatPercent(row.weight)} />
                  <Metric
                    label="기여"
                    value={formatScore(row.contribution)}
                    emphasize
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex gap-1.5",
        emphasize ? "text-foreground font-semibold" : "text-muted-foreground",
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </span>
  );
}

/**
 * Defensive parse of the JSONB blob. Trusts nothing structurally —
 * rejects rows with missing or non-finite numeric fields, but keeps
 * the ones that do parse cleanly. One corrupt indicator shouldn't
 * blank the whole card.
 *
 * **Supports both Phase 1 and Phase 2 JSONB shapes.** Phase 1 (v1.0.0)
 * stores indicators at the top level: `{ FEDFUNDS: { score, weight,
 * contribution }, ... }`. Phase 2 (v2.0.0) wraps them by category:
 * `{ macro: { score, weight, contribution, indicators: { FEDFUNDS: {...}
 * } }, technical: {...}, ... }`. We detect the v2 shape by the
 * presence of a nested `indicators` map on any top-level value and
 * flatten the indicator-level entries up. At Phase 2 Step 6 only the
 * `macro` category populates its `indicators` map; other categories
 * land empty/absent until Steps 7–8 wire them.
 *
 * Category-level rendering (showing "Macro: 47" / "Technical: 62" at
 * the top level instead of / alongside the FRED rows) is Step 8's
 * scope. For Step 6 we preserve Phase 1 indicator-level UX on both
 * v1 and v2 rows so the contributing breakdown never regresses
 * during the v1→v2 transition.
 */
function parseContributing(raw: Json): ParsedContribution[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const rows: ParsedContribution[] = [];
  for (const [topKey, topValue] of Object.entries(raw)) {
    if (!topValue || typeof topValue !== "object" || Array.isArray(topValue)) {
      continue;
    }
    const v = topValue as Record<string, unknown>;
    const nestedIndicators = v.indicators;
    if (
      nestedIndicators &&
      typeof nestedIndicators === "object" &&
      !Array.isArray(nestedIndicators)
    ) {
      // v2 nested shape: drill into this category's indicators map
      // and surface each indicator as a row. The category-level
      // { score, weight, contribution } fields are intentionally
      // dropped here — Step 8 UI will consume them directly.
      for (const [indKey, indValue] of Object.entries(
        nestedIndicators as Record<string, unknown>,
      )) {
        collectRow(rows, indKey, indValue);
      }
    } else {
      // v1 flat shape: topKey is an indicator key.
      collectRow(rows, topKey, v);
    }
  }
  rows.sort((a, b) => {
    const byMagnitude = Math.abs(b.contribution) - Math.abs(a.contribution);
    if (byMagnitude !== 0) return byMagnitude;
    return a.key < b.key ? -1 : 1;
  });
  return rows;
}

function collectRow(
  rows: ParsedContribution[],
  key: string,
  value: unknown,
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  const score = v.score;
  const weight = v.weight;
  const contribution = v.contribution;
  if (
    typeof score !== "number" ||
    typeof weight !== "number" ||
    typeof contribution !== "number" ||
    !Number.isFinite(score) ||
    !Number.isFinite(weight) ||
    !Number.isFinite(contribution)
  ) {
    return;
  }
  rows.push({ key, score, weight, contribution });
}

function formatScore(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function formatPercent(n: number): string {
  // Weights are pre-normalized to [0, 1] by computeComposite so the
  // percentage is trivially 100×.
  return `${(Math.round(n * 1000) / 10).toFixed(1)}%`;
}

/**
 * Tables type annotation exported so callers can pass the column
 * value directly without re-casting.
 */
export type CompositeContributingBlob = Tables<"composite_snapshots">["contributing_indicators"];
