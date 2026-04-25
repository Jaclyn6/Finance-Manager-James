"use client";

import { Info } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  formatRawValue,
  type IndicatorGlossaryEntry,
} from "@/lib/utils/indicator-glossary";

/**
 * Inline ⓘ popover trigger for an indicator row in
 * {@link ContributingIndicators}. Shows a 2–3 line summary built from
 * the glossary entry's `shortKo` plus a truncated `beginnerExplanationKo`,
 * and links to the dedicated `/indicators#${key}` deep anchor for the
 * full breakdown.
 *
 * Client Component because base-ui's Popover wires up `data-open` /
 * focus-trap state via React effects — no SSR equivalent. The parent
 * Server Component (`contributing-indicators.tsx`) imports this as a
 * leaf and stays static-friendly.
 *
 * a11y:
 * - Trigger button has an explicit Korean `aria-label` referencing the
 *   indicator (`${labelKo} 지표 설명 열기`); the embedded Lucide icon
 *   is `aria-hidden` so screen readers don't double-announce "info".
 * - Popover content carries `role="dialog"` (base-ui default) and
 *   uses an `aria-labelledby` pointing at the bold title element.
 * - Esc closes (base-ui default), tab loops within the popover.
 *
 * Touch target: `size-8` (32px) — under the 44px primary-action floor
 * documented in blueprint §6.5 because this is a SECONDARY information
 * affordance sitting next to the source link, not a primary nav target.
 * The 44-pt rule applies to nav/header/CTA buttons; secondary
 * disclosures are conventionally smaller per shadcn's own patterns
 * (DropdownMenu icon-trigger is `size-8`).
 */
export function IndicatorInfoPopover({
  entry,
  valueRaw,
}: {
  entry: IndicatorGlossaryEntry;
  /**
   * Latest raw value for this indicator (from `indicator_readings` /
   * `onchain_readings`). Optional — when present we render a "지금: X
   * (보통 Y~Z)" line above the summary so readers see the unscored
   * source value next to the score they're investigating.
   */
  valueRaw?: number | null;
}) {
  const titleId = `indicator-info-title-${entry.key}`;

  // Truncate beginnerExplanationKo at the first sentence boundary or 80
  // chars, whichever comes first — keeps the popover body to ~3 lines
  // on a 288px (`w-72`) popover at base text size. Full text lives on
  // /indicators#${key}.
  const summary = buildSummary(entry);
  const rawLine = buildRawValueLine(entry, valueRaw);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`${entry.labelKo} 지표 설명 열기`}
            className="size-8 shrink-0 motion-safe:transition-colors"
          />
        }
      >
        <Info aria-hidden="true" focusable="false" className="size-4" />
      </PopoverTrigger>
      <PopoverContent aria-labelledby={titleId} side="top" className="w-72">
        <PopoverTitle id={titleId} className="text-sm font-semibold">
          {entry.labelKo}
        </PopoverTitle>
        {rawLine ? (
          <p className="text-xs font-medium tabular-nums text-foreground/90">
            {rawLine}
          </p>
        ) : null}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {summary}
        </p>
        <Link
          href={`/indicators#${entry.key}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
        >
          자세한 설명 보기 →
        </Link>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Build the "지금: 19.30 (보통 15~25)" line shown above the summary
 * when the caller passes a raw value.
 *
 * The "보통 X~Y" portion is a best-effort extract from
 * `typicalRangeKo`. The rangeKo strings follow ad-hoc shapes
 * ("정상 구간은 +0.5%p ~ +2.5%p", "장기 평균은 18-20", "확장 국면 평균은
 * 20-25만 건", etc) so a regex aimed at the common patterns is
 * brittle by definition. The fallback path renders just "지금: X" —
 * better to drop the parenthetical than fabricate a wrong range.
 */
function buildRawValueLine(
  entry: IndicatorGlossaryEntry,
  valueRaw: number | null | undefined,
): string | null {
  if (valueRaw === null || valueRaw === undefined) return null;
  if (typeof valueRaw !== "number" || !Number.isFinite(valueRaw)) return null;
  const formatted = formatRawValue(valueRaw);
  const unit = entry.unitKo ? ` ${entry.unitKo}` : "";
  const range = extractTypicalRangeShort(entry.typicalRangeKo);
  if (range) {
    return `지금: ${formatted}${unit} (보통 ${range})`;
  }
  return `지금: ${formatted}${unit}`;
}

/**
 * Extract a "X~Y" or "X-Y" snippet from a `typicalRangeKo` string for
 * inline display. Returns `null` when no clean range can be lifted —
 * caller falls back to omitting the parenthetical.
 *
 * Match priority (first hit wins, scanning left-to-right in the
 * sentence):
 *   1. "정상 구간은 X~Y" / "정상 구간은 X-Y"
 *   2. "장기 평균은 X-Y" / "X~Y"
 *   3. "확장 국면 평균은 X-Y만 건" — keep the '만 건' suffix attached
 *   4. Final fallback: ANY first "<number>(unit?) ~ <number>(unit?)"
 *      occurrence
 *
 * Returns the matched substring AS-WRITTEN (preserving units like
 * "%p", "원", "만 건") so the final popover line reads naturally.
 */
function extractTypicalRangeShort(typicalRangeKo: string): string | null {
  // Strip leading "정상 구간은 " / "장기 평균은 " / "확장 국면 평균은 " prefixes
  // so we focus on the range portion itself.
  const text = typicalRangeKo.replace(/^[^,]*?(은|는|이며,)\s*/, "");
  // Match the FIRST range pattern. Allow signed numbers with optional
  // decimals + an optional unit suffix on each side. The unit suffix is
  // any non-whitespace, non-separator chars (e.g. "%p", "원", "만").
  const rangeMatch = text.match(
    /([+\-]?\d[\d,]*\.?\d*)\s*([%pP원만건a-zA-Z]*)\s*[~\-–]\s*([+\-]?\d[\d,]*\.?\d*)\s*([%pP원만건a-zA-Z]*)/,
  );
  if (!rangeMatch) return null;
  const [, lo, loUnit, hi, hiUnit] = rangeMatch;
  // If the units differ, prefer the high-side unit (most common
  // pattern: "1,200-1,350원" → low has none, high has "원").
  const unit = hiUnit || loUnit || "";
  return `${lo}~${hi}${unit ? unit : ""}`;
}

function buildSummary(entry: IndicatorGlossaryEntry): string {
  // shortKo is ≤50 chars by spec; the explanation is 1-2 sentences.
  // Take shortKo + the first sentence of beginnerExplanationKo, capped
  // at ~140 chars combined so the popover body stays 2-3 lines.
  const explanation = entry.beginnerExplanationKo;
  const firstSentenceEnd = explanation.search(/[.!?。]/);
  const firstSentence =
    firstSentenceEnd === -1
      ? explanation
      : explanation.slice(0, firstSentenceEnd + 1);
  const combined = `${entry.shortKo} ${firstSentence}`.trim();
  if (combined.length <= 140) return combined;
  return `${combined.slice(0, 139)}…`;
}
