import { ExternalLink } from "lucide-react";

import { CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  INDICATOR_CATEGORY_LABEL_KO,
  INDICATOR_CATEGORY_ORDER,
  INDICATORS_BY_CATEGORY,
  type IndicatorGlossaryEntry,
} from "@/lib/utils/indicator-glossary";

/**
 * Body of `/indicators`. Pure presentation layer over the static
 * {@link INDICATORS_BY_CATEGORY} map — no DB, no async work, but kept
 * as a Server Component so the shell can stay aligned with the rest
 * of `(protected)/` routes.
 *
 * Layout per category:
 *   - sticky-top h2 section heading with localized label
 *   - card-shaped block per indicator, anchor `id={key}` for deep
 *     linking from the row popover (`/indicators#FEDFUNDS` etc.)
 *   - source link (`ExternalLink`-styled, mirrors
 *     `contributing-indicators.tsx`)
 *   - beginner explanation paragraph
 *   - 2-column grid (1 col on mobile) with 상승할 때 / 하락할 때 cases
 *   - 일반적 임계값 + optional 주의 callout
 *
 * Mobile (375px): two-column grid collapses to single-column via
 * `grid-cols-1 md:grid-cols-2` so 상승/하락 blocks stack vertically.
 *
 * Anchor scrolling: the browser handles `/indicators#${key}` jumps
 * natively because each Card's outer `<article>` carries `id={key}`.
 * No JS scroll handler needed.
 */
export function IndicatorsContent() {
  return (
    <div className="space-y-10">
      {INDICATOR_CATEGORY_ORDER.map((category) => {
        const entries = INDICATORS_BY_CATEGORY[category];
        if (entries.length === 0) return null;
        return (
          <section key={category} className="space-y-4">
            <h2 className="sticky top-0 z-10 -mx-4 bg-background/95 px-4 py-2 text-lg font-semibold tracking-tight backdrop-blur supports-[backdrop-filter]:bg-background/75 md:-mx-6 md:px-6 md:text-xl">
              {INDICATOR_CATEGORY_LABEL_KO[category]}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({entries.length})
              </span>
            </h2>
            <div className="space-y-4">
              {entries.map((entry) => (
                <IndicatorEntryCard key={entry.key} entry={entry} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function IndicatorEntryCard({ entry }: { entry: IndicatorGlossaryEntry }) {
  return (
    // `scroll-mt-20` ensures `/indicators#${key}` jumps land below the
    // sticky category heading instead of clipping behind it. Reuses
    // the same Tailwind chrome the `Card` primitive ships with — but
    // as an `<article>` for semantic correctness on a list-of-articles
    // page (each entry is independently meaningful).
    <article
      id={entry.key}
      className={cn(
        "group/card flex scroll-mt-20 flex-col gap-4 overflow-hidden rounded-xl bg-card py-4 text-sm text-card-foreground ring-1 ring-foreground/10",
      )}
    >
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="font-heading text-base font-semibold tracking-tight md:text-lg">
              {entry.labelKo}
            </h3>
            <span className="font-mono text-xs text-muted-foreground">
              {entry.key}
            </span>
          </div>
          <a
            href={entry.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {entry.sourceName}
            <ExternalLink
              aria-hidden="true"
              focusable="false"
              className="size-3"
            />
            <span className="sr-only">(새 창에서 열기)</span>
          </a>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-relaxed text-foreground/90">
            {entry.beginnerExplanationKo}
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <CaseBlock
              tone="bullish"
              heading="상승할 때"
              body={entry.bullishCaseKo}
            />
            <CaseBlock
              tone="bearish"
              heading="하락할 때"
              body={entry.bearishCaseKo}
            />
          </div>

          <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              🔍 일반적 임계값
            </p>
            <p className="leading-relaxed text-foreground/90">
              {entry.typicalRangeKo}
            </p>
          </div>

          {entry.caveatKo ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                ⚠️ 주의
              </p>
              <p className="leading-relaxed text-foreground/90">
                {entry.caveatKo}
              </p>
            </div>
          ) : null}
        </CardContent>
    </article>
  );
}

function CaseBlock({
  tone,
  heading,
  body,
}: {
  tone: "bullish" | "bearish";
  heading: string;
  body: string;
}) {
  // Up/down emoji chosen from the spec literally; tone-keyed border
  // tints stay on-brand with the rest of the dashboard (subtle, not
  // alarmist — same restraint the DisclaimerBanner uses).
  const emoji = tone === "bullish" ? "📈" : "📉";
  const borderClass =
    tone === "bullish"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : "border-rose-500/30 bg-rose-500/5";
  return (
    <div className={`rounded-md border ${borderClass} p-3 text-sm`}>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {emoji} {heading}
      </p>
      <p className="leading-relaxed text-foreground/90">{body}</p>
    </div>
  );
}
