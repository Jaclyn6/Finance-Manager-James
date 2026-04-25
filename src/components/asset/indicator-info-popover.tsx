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
import type { IndicatorGlossaryEntry } from "@/lib/utils/indicator-glossary";

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
}: {
  entry: IndicatorGlossaryEntry;
}) {
  const titleId = `indicator-info-title-${entry.key}`;

  // Truncate beginnerExplanationKo at the first sentence boundary or 80
  // chars, whichever comes first — keeps the popover body to ~3 lines
  // on a 288px (`w-72`) popover at base text size. Full text lives on
  // /indicators#${key}.
  const summary = buildSummary(entry);

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
