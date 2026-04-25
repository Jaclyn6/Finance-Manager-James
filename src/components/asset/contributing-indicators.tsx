import { ExternalLink } from "lucide-react";

import { CategoryContributionBar } from "@/components/asset/category-contribution-bar";
import { IndicatorInfoPopover } from "@/components/asset/indicator-info-popover";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { INDICATOR_CONFIG } from "@/lib/score-engine/weights";
import type { CategoryName } from "@/lib/score-engine/types";
import { cn } from "@/lib/utils";
import {
  CATEGORY_DISPLAY_ORDER,
  CATEGORY_LABELS_KO,
} from "@/lib/utils/category-labels";
import {
  formatRawValue,
  INDICATOR_GLOSSARY,
} from "@/lib/utils/indicator-glossary";
import type { Json, Tables } from "@/types/database";

/**
 * Breakdown card — answers "왜 이 점수인가?" for a composite snapshot.
 *
 * Reads `composite_snapshots.contributing_indicators` (JSONB) and
 * renders the six-category nested shape (Phase 2, §4.2):
 *
 *   {
 *     macro:     { score, weight, contribution, indicators: { FEDFUNDS: {...} } },
 *     technical: { score, weight, contribution, indicators: {...} },
 *     onchain:   { score, weight, contribution },
 *     sentiment: { score, weight, contribution, indicators: {...} },
 *     valuation: { score, weight, contribution },          // no indicators submap
 *     regional_overlay: { score, weight, contribution, indicators: {...} },
 *   }
 *
 * Phase 1 (v1.0.0) persisted the flat `{ FEDFUNDS: {score, weight,
 * contribution}, ... }` shape. Historical reads must still render, so
 * `parseContributing` detects both shapes via this heuristic:
 *   - v2 nested → at least one top-level key matches a known
 *     {@link CategoryName} (macro / technical / onchain / sentiment /
 *     valuation / regional_overlay) AND that key's value is an object
 *     shaped like a category record (carries a numeric or null
 *     `score` / `weight` / `contribution` field). In that case render
 *     category-level rows with nested indicator rows below.
 *   - v1 flat (no top-level key matches a CategoryName with a
 *     category-shaped value) → render ONE pseudo-category "매크로"
 *     containing all 7 FRED indicators so v1 snapshots don't
 *     layout-regress into blank bodies.
 *
 * Server Component — no interactivity, no reliance on `new Date()`. The
 * client-side Recharts stacked bar is composed via
 * {@link CategoryContributionBar}, which takes its data as pre-computed
 * props so this file never ships the admin client.
 *
 * Sorting: the category section order is fixed by
 * {@link CATEGORY_DISPLAY_ORDER}. Within each section, indicators sort
 * by `|contribution|` desc with key-name tiebreak (matches Phase 1
 * behaviour).
 *
 * v2.2 mobile scope — grid uses `grid-cols-1 md:grid-cols-[1fr_auto]`,
 * `tabular-nums` on all metric values, and `text-xs` at 375px with
 * `text-sm` above `md` so values never wrap mid-glyph.
 */

export interface ContributingIndicatorsProps {
  contributing: Json;
  /**
   * Latest raw values for indicator keys present in the glossary
   * (FRED + on-chain). Optional — when omitted, rows render with the
   * historical "score / weight / contribution" trio only. When present,
   * rows whose `key` exists both in the glossary AND in this map
   * additionally show the raw value with a unit hint between the
   * label and the score block.
   *
   * Sourced from `getLatestIndicatorReadings()` and joined per the
   * Phase C scoring-transparency plan §5 Option B (no schema change to
   * `composite_snapshots.contributing_indicators` — read from the
   * separate reading tables in the page's data layer instead).
   *
   * Per-ticker technical_readings rows are intentionally NOT included
   * (their JSONB key is the ticker symbol, not the indicator key — see
   * `getLatestIndicatorReadings`'s header), so technical drill-down
   * rows render without a raw column. That matches the spec's "If a
   * key has no entry in INDICATOR_GLOSSARY, show only the score" rule.
   */
  latestRawValues?: Record<string, number | null>;
}

/**
 * Step 8 per-category staleness approximation (blueprint §9 line 661).
 * `composite_snapshots` stores only a single `fetch_status`, so we don't
 * have a row-level signal for which CATEGORY failed to ingest. Deferred
 * proper per-category staleness (needs cross-table queries) to Phase 3;
 * at Step 8 we approximate:
 *
 *   - category missing from the JSONB entirely, OR
 *   - category present with `score === null`
 *
 * → render a "수집 중" chip next to the category heading. Otherwise no
 * chip. Compiles away cleanly when Phase 3 wires the real staleness.
 */
type CategoryStaleness = "fresh" | "collecting";

interface CategoryRow {
  category: CategoryName;
  /** 0-100 score; null when the category is missing or unscored. */
  score: number | null;
  /** Renormalized weight (fraction 0-1) or null. */
  weight: number | null;
  /** Score × weight or null. */
  contribution: number | null;
  /** Indicator-level breakdown (when present). */
  indicators: IndicatorRow[];
  staleness: CategoryStaleness;
}

interface IndicatorRow {
  key: string;
  score: number;
  weight: number;
  contribution: number;
}

export function ContributingIndicators({
  contributing,
  latestRawValues,
}: ContributingIndicatorsProps) {
  const { mode, categories } = parseContributing(contributing);

  if (categories.length === 0) {
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

  // "N/6" transparency chip — blueprint §9 Step 8 acceptance. Counts
  // ONLY present + non-null categories, not the dict size (the dict
  // might include a null-score placeholder).
  const presentCount = categories.filter(
    (c) => c.staleness === "fresh" && c.score !== null,
  ).length;
  const totalCount = CATEGORY_DISPLAY_ORDER.length;

  // Build the stacked bar input. Zero / negative contributions are
  // still included so the legend is exhaustive — the bar chart itself
  // filters them out for rendering.
  const barRows = categories
    .filter((c) => c.contribution !== null)
    .map((c) => ({
      category: c.category,
      contribution: c.contribution as number,
    }));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-heading text-base leading-snug font-medium">
              기여 지표
            </h2>
            <p className="text-xs text-muted-foreground">
              각 카테고리와 지표의 합성 점수 기여도
            </p>
          </div>
          {mode === "v2" ? (
            <Badge variant="outline" className="text-[11px]">
              {presentCount}/{totalCount} 카테고리 반영
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {barRows.length > 0 ? <CategoryContributionBar rows={barRows} /> : null}

        <ul className="space-y-4">
          {categories.map((cat) => (
            <CategorySection
              key={cat.category}
              row={cat}
              latestRawValues={latestRawValues}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function CategorySection({
  row,
  latestRawValues,
}: {
  row: CategoryRow;
  latestRawValues?: Record<string, number | null>;
}) {
  return (
    <li className="space-y-2 rounded-lg border border-border/60 p-3 last:mb-0">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold tracking-tight">
            {CATEGORY_LABELS_KO[row.category]}
          </h3>
          {row.staleness === "collecting" ? (
            <Badge
              variant="outline"
              className="border-amber-500/40 text-[11px] text-amber-700 dark:text-amber-300"
            >
              수집 중
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums md:text-sm">
          <Metric label="점수" value={formatNumberOrDash(row.score)} />
          <Metric
            label="가중치"
            value={formatPercentOrDash(row.weight)}
          />
          <Metric
            label="기여"
            value={formatNumberOrDash(row.contribution)}
            emphasize
          />
        </div>
      </header>

      {row.indicators.length > 0 ? (
        <ul className="space-y-2 pt-2">
          {row.indicators.map((ind) => (
            <IndicatorRowView
              key={ind.key}
              indicator={ind}
              latestRawValues={latestRawValues}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function IndicatorRowView({
  indicator,
  latestRawValues,
}: {
  indicator: IndicatorRow;
  latestRawValues?: Record<string, number | null>;
}) {
  const config = INDICATOR_CONFIG[indicator.key];
  const label = config?.descriptionKo ?? indicator.key;
  // Glossary lookup is keyed by the same canonical id (FEDFUNDS, RSI_14,
  // …). When an indicator key is absent from the glossary (e.g. a future
  // FRED series added before the glossary entry lands) we silently skip
  // the ⓘ trigger — graceful degradation, no broken trigger button.
  const glossaryEntry = INDICATOR_GLOSSARY[indicator.key];
  // Raw value lookup: only show a raw value column when the indicator
  // has a glossary entry (we need `unitKo` to render the suffix) AND
  // the page-level reader returned a value for the key. Per-ticker
  // technical rows fall through both checks → score-only row.
  const rawValue =
    glossaryEntry && latestRawValues
      ? latestRawValues[indicator.key]
      : undefined;
  const showRawValue =
    glossaryEntry !== undefined &&
    rawValue !== undefined &&
    rawValue !== null &&
    Number.isFinite(rawValue);

  return (
    <li className="grid gap-2 border-b border-border/40 pb-2 last:border-0 last:pb-0 md:grid-cols-[1fr_auto] md:items-start md:gap-6">
      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <p className="text-sm font-medium text-foreground">{label}</p>
          {glossaryEntry ? (
            <IndicatorInfoPopover
              entry={glossaryEntry}
              valueRaw={rawValue ?? null}
            />
          ) : null}
        </div>
        {config ? (
          <a
            href={config.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {config.sourceName} / {indicator.key}
            <ExternalLink
              aria-hidden="true"
              focusable="false"
              className="size-3"
            />
            <span className="sr-only">(새 창에서 열기)</span>
          </a>
        ) : (
          <p className="text-xs text-muted-foreground">{indicator.key}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums md:justify-end md:text-right">
        {showRawValue && glossaryEntry ? (
          <Metric
            label="지금"
            value={`${formatRawValue(rawValue)}${
              glossaryEntry.unitKo ? ` ${glossaryEntry.unitKo}` : ""
            }`}
          />
        ) : null}
        <Metric label="점수" value={formatNumber(indicator.score)} />
        <Metric label="가중치" value={formatPercent(indicator.weight)} />
        <Metric
          label="기여"
          value={formatNumber(indicator.contribution)}
          emphasize
        />
      </div>
    </li>
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

// ---------------------------------------------------------------------------
// Parser — public for tests
// ---------------------------------------------------------------------------

export type ContributingShape = "v1" | "v2";

export interface ParsedContributing {
  mode: ContributingShape;
  categories: CategoryRow[];
}

/**
 * Detects v1 (flat indicators) vs v2 (nested categories) and returns a
 * unified {@link CategoryRow[]}. Never throws; returns empty categories
 * on a malformed blob.
 *
 * v2 detection heuristic: any top-level key matches a known
 * {@link CategoryName} AND its value is an object with a numeric OR
 * null `score` / `weight` / `contribution` field (i.e. the value has
 * the category-record shape). If that's true for any key, we treat the
 * whole blob as v2. Otherwise we fall back to v1 flat-indicator parsing
 * and wrap the indicators in a single pseudo-"macro" category so the UI
 * layout is consistent across historical snapshots.
 *
 * **Disjointness assumption** — this heuristic relies on
 * {@link CategoryName} values (`macro`, `technical`, `onchain`,
 * `sentiment`, `valuation`, `regional_overlay`) being DISJOINT from any
 * Phase 1 v1-flat indicator key (FEDFUNDS, CPIAUCSL, UNRATE, ICSA,
 * etc.). It is currently true and the asymmetric shape-check (category
 * rows carry numeric score/weight/contribution — indicator rows never
 * collide with CategoryName keys) adds a second layer of safety.
 *
 * DO NOT add an indicator whose identifier collides with a category
 * name (e.g. a literal FRED series named "MACRO") without first
 * migrating this detection logic — a collision would misclassify v1
 * payloads as v2 and render blank bodies.
 */
export function parseContributing(raw: Json): ParsedContributing {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { mode: "v2", categories: [] };
  }
  const root = raw as Record<string, unknown>;

  // Shape detection — look for at least one known category key whose
  // value is a plain object with numeric score/weight/contribution.
  const isV2 = CATEGORY_DISPLAY_ORDER.some((cat) => {
    const v = root[cat];
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    const rec = v as Record<string, unknown>;
    return (
      typeof rec.score === "number" ||
      typeof rec.weight === "number" ||
      typeof rec.contribution === "number" ||
      // tolerate nulls in the category record — still v2
      rec.score === null ||
      rec.weight === null ||
      rec.contribution === null
    );
  });

  if (isV2) {
    return { mode: "v2", categories: parseV2(root) };
  }
  return { mode: "v1", categories: parseV1Flat(root) };
}

function parseV2(root: Record<string, unknown>): CategoryRow[] {
  const rows: CategoryRow[] = [];
  for (const cat of CATEGORY_DISPLAY_ORDER) {
    const entry = root[cat];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      // Category entirely absent — skip (NOT rendered as empty row).
      continue;
    }
    const rec = entry as Record<string, unknown>;
    const score = finiteOrNull(rec.score);
    const weight = finiteOrNull(rec.weight);
    const contribution = finiteOrNull(rec.contribution);
    const indicators: IndicatorRow[] = [];
    const nestedInd = rec.indicators;
    if (nestedInd && typeof nestedInd === "object" && !Array.isArray(nestedInd)) {
      for (const [indKey, indValue] of Object.entries(
        nestedInd as Record<string, unknown>,
      )) {
        collectIndicator(indicators, indKey, indValue);
      }
      indicators.sort((a, b) => {
        const byMag = Math.abs(b.contribution) - Math.abs(a.contribution);
        if (byMag !== 0) return byMag;
        return a.key < b.key ? -1 : 1;
      });
    }

    const staleness: CategoryStaleness = score === null ? "collecting" : "fresh";

    rows.push({
      category: cat,
      score,
      weight,
      contribution,
      indicators,
      staleness,
    });
  }
  return rows;
}

/**
 * v1 backward-compat: wrap flat indicators into a single pseudo-macro
 * category so the layout template doesn't regress for pre-cutover
 * (v1.0.0) snapshots. All 7 FRED indicators from Phase 1 live under
 * this synthetic "macro" bucket; category-level score is the SUM of
 * contributions (which IS the composite for v1), weight is 1.0 (the
 * whole composite), staleness is always fresh (v1 had no concept of
 * per-category staleness).
 */
function parseV1Flat(root: Record<string, unknown>): CategoryRow[] {
  const indicators: IndicatorRow[] = [];
  for (const [key, value] of Object.entries(root)) {
    collectIndicator(indicators, key, value);
  }
  if (indicators.length === 0) {
    return [];
  }
  indicators.sort((a, b) => {
    const byMag = Math.abs(b.contribution) - Math.abs(a.contribution);
    if (byMag !== 0) return byMag;
    return a.key < b.key ? -1 : 1;
  });
  const contribution = indicators.reduce((acc, i) => acc + i.contribution, 0);
  return [
    {
      category: "macro",
      score: contribution, // v1 composite == sum of indicator contributions
      weight: 1,
      contribution,
      indicators,
      staleness: "fresh",
    },
  ];
}

function collectIndicator(
  rows: IndicatorRow[],
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

function finiteOrNull(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw;
}

function formatNumber(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function formatNumberOrDash(n: number | null): string {
  if (n === null) return "—";
  return formatNumber(n);
}

function formatPercent(n: number): string {
  return `${(Math.round(n * 1000) / 10).toFixed(1)}%`;
}

function formatPercentOrDash(n: number | null): string {
  if (n === null) return "—";
  return formatPercent(n);
}

export type CompositeContributingBlob = Tables<"composite_snapshots">["contributing_indicators"];
