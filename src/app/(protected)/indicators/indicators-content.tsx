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
      <ScoreReadingGuide />
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

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-md border border-brand/30 bg-brand-subtle/40 p-3 text-sm">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-dark">
                🧭 점수 방향
              </p>
              <p className="leading-relaxed text-foreground/90">
                {entry.scoreDirectionKo}
              </p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-sm">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                🧮 점수 계산
              </p>
              <p className="leading-relaxed text-foreground/90">
                {entry.scoringMethodKo}
              </p>
            </div>
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

/**
 * Top-of-page primer that explains the 0-100 score axis BEFORE the
 * per-indicator articles. Sits above every category section so a
 * first-time visitor learns the mental model once instead of having
 * to infer it from the bullish/bearish blocks.
 *
 * Visually distinguished via a brand-tinted card chrome (matches the
 * `brand-subtle` token used elsewhere for product-tone callouts) but
 * deliberately NOT loud — the page's primary content is the indicator
 * articles, the guide is scaffolding.
 */
function ScoreReadingGuide() {
  return (
    <section
      aria-labelledby="score-reading-guide-heading"
      className="rounded-xl border border-brand/30 bg-brand-subtle/30 p-4 md:p-6"
    >
      <h2
        id="score-reading-guide-heading"
        className="font-heading text-base font-semibold tracking-tight md:text-lg"
      >
        🧭 점수 읽는 법
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-foreground/90">
        모든 지표 점수는 <strong className="font-semibold">0~100 사이</strong>로
        표시됩니다.
      </p>
      <ul className="mt-2 space-y-1 text-sm leading-relaxed text-foreground/90">
        <li>
          <span className="inline-block w-10 font-mono tabular-nums text-rose-700 dark:text-rose-300">
            0
          </span>
          위험 회피 권장 (현금·안전자산 비중 ↑)
        </li>
        <li>
          <span className="inline-block w-10 font-mono tabular-nums text-muted-foreground">
            50
          </span>
          중립
        </li>
        <li>
          <span className="inline-block w-10 font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
            100
          </span>
          위험자산 매수 적기 (주식·암호화폐 비중 ↑)
        </li>
      </ul>
      <p className="mt-3 text-sm leading-relaxed text-foreground/90">
        점수는 지난 5년 동안의 흐름과 비교해 지금 값이 어디쯤인지를 0~100으로
        환산한 결과입니다.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-foreground/90">
        일부 지표는 <strong className="font-semibold">거꾸로 봅니다</strong> —
        값이 낮을수록 점수가 높아지는 식이죠. 예를 들어 VIX(공포 지수)는
        높을수록, 기준금리는 낮을수록 점수가 높아집니다. 각 지표 카드의 &ldquo;🧭
        점수 방향&rdquo; 항목을 보면 어느 쪽인지 바로 알 수 있습니다.
      </p>
    </section>
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
