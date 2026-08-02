import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import type { AdvisorAssetView } from "@/lib/data/advisor";
import { cn } from "@/lib/utils";
import { ASSET_LABELS } from "@/lib/utils/asset-labels";
import { ASSET_SLUGS } from "@/lib/utils/asset-slug";
import { buildNavHref } from "@/lib/utils/nav-href";
import {
  STANCE_DOT_CLASS,
  STANCE_SR_PREFIX_KO,
  VERDICT_ACCENT_BORDER_CLASS,
  VERDICT_BADGE_CLASS,
  VERDICT_LABEL_KO,
} from "@/lib/utils/verdict-labels";

/**
 * Per-asset advisor verdict card — the dashboard's answer to "지금이
 * 할인 구간인가?" for one asset class.
 *
 * Visual hierarchy (PRD pivot 2026-07-08; intuition pass 2026-08-03):
 * the border-left accent color is the fastest scan signal (judgment
 * by color across 4 cards), the verdict pill + headline carry the
 * judgment in words, the drawdown stats quantify it, and the top-2
 * evidence lines preview the WHY — the full pillar breakdown lives on
 * `/asset/[slug]`. Server component (no chart here) so the dashboard
 * stays server-rendered; the whole card links to the detail page.
 */
export interface VerdictCardProps {
  view: AdvisorAssetView;
  /** Sanitized `?date=` to preserve on the drill-down link. */
  currentDate?: string | null;
}

export function VerdictCard({ view, currentDate = null }: VerdictCardProps) {
  const { assetType, ticker, verdict } = view;
  const label = ASSET_LABELS[assetType];
  const slug = assetType === "common" ? null : (ASSET_SLUGS[assetType] ?? null);
  const dd = verdict.drawdown;

  const cardInner = (
    <Card
      size="sm"
      className={cn(
        // border-l-4 accent = the 4-card scan signal: judgment by
        // color before a single word is read (UX 실사 2026-08-03).
        "h-full border-l-4 p-5 md:p-6 motion-safe:transition-colors",
        VERDICT_ACCENT_BORDER_CLASS[verdict.label],
        slug &&
          "hover:bg-muted/40 group-focus-visible/verdict-link:ring-2 group-focus-visible/verdict-link:ring-ring",
      )}
    >
      <CardContent className="flex h-full flex-col gap-3 p-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">
            {label}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {ticker}
            </span>
          </p>
          <span
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-sm font-bold",
              VERDICT_BADGE_CLASS[verdict.label],
            )}
          >
            {VERDICT_LABEL_KO[verdict.label]}
          </span>
        </div>

        <p className="text-sm leading-snug text-foreground">
          {verdict.headlineKo}
        </p>

        {dd !== null && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              현재 낙폭{" "}
              <strong className="font-semibold text-foreground">
                −{(dd.drawdownPct * 100).toFixed(1)}%
              </strong>
            </span>
            <span aria-hidden>·</span>
            <span>52주 MDD −{(dd.maxDrawdownPct * 100).toFixed(1)}%</span>
            <span aria-hidden>·</span>
            <span>고점 {dd.peakDate}</span>
          </div>
        )}

        {verdict.netScore !== null && (
          <EvidenceBalanceBar netScore={verdict.netScore} />
        )}

        {verdict.evidence.length > 0 && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {verdict.evidence.slice(0, 2).map((item) => (
              <li key={item.reasonKo} className="flex items-start gap-1.5">
                <span
                  aria-hidden
                  className={cn(
                    "mt-1 size-1.5 shrink-0 rounded-full",
                    STANCE_DOT_CLASS[item.stance],
                  )}
                />
                <span className="sr-only">
                  {STANCE_SR_PREFIX_KO[item.stance]}:{" "}
                </span>
                <span>{item.reasonKo}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-auto text-[11px] text-muted-foreground">
          근거 신뢰도 {Math.round(verdict.confidence * 100)}%
        </p>
      </CardContent>
    </Card>
  );

  if (!slug) return cardInner;

  return (
    <Link
      href={buildNavHref(`/asset/${slug}`, currentDate)}
      className="group/verdict-link block h-full rounded-xl outline-none"
      aria-label={`${label} 근거 상세 보기`}
    >
      {cardInner}
    </Link>
  );
}

/**
 * Threshold above which a side's label is emphasized — mirrors the
 * verdict combiner's ±0.2 discount/reversal bands (verdict.ts), so
 * the label row never declares a winner on a mixed_signals-grade
 * netScore the verdict itself calls 혼재.
 */
const BALANCE_EMPHASIS_FLOOR = 0.2;

/**
 * Horizontal evidence balance: reversal (left) ↔ discount (right).
 *
 * Same visual idiom as the asset page's PillarScoreBar (neutral
 * track, center-flush directional fill at /70, center tick at /30) —
 * dashboard and drill-down must speak one bar language. The fill's
 * outer edge IS the netScore position; the center tick renders LAST
 * so it stays visible over the fill on both signs. The previous
 * always-fully-colored gradient made a near-neutral card look
 * alarming — a bar must not say more than the verdict does (UX 실사
 * 2026-08-03 + Trigger 2 review). Pure CSS; decorative (the headline
 * carries the meaning for screen readers).
 */
function EvidenceBalanceBar({ netScore }: { netScore: number }) {
  const halfPct = Math.min(Math.abs(netScore), 1) * 50;
  return (
    <div aria-hidden className="space-y-1">
      <div className="relative h-1.5 w-full rounded-full bg-muted">
        {halfPct > 0 && (
          <div
            className={cn(
              "absolute top-0 h-full",
              netScore > 0
                ? "left-1/2 rounded-r-full bg-emerald-500/70"
                : "right-1/2 rounded-l-full bg-red-500/70",
            )}
            style={{ width: `${halfPct.toFixed(1)}%` }}
          />
        )}
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-muted-foreground/30" />
      </div>
      <div className="flex justify-between text-[10px]">
        <span
          className={cn(
            netScore <= -BALANCE_EMPHASIS_FLOOR
              ? "font-semibold text-red-600 dark:text-red-400"
              : "text-muted-foreground",
          )}
        >
          추세전환 근거
        </span>
        <span
          className={cn(
            netScore >= BALANCE_EMPHASIS_FLOOR
              ? "font-semibold text-emerald-600 dark:text-emerald-400"
              : "text-muted-foreground",
          )}
        >
          할인 근거
        </span>
      </div>
    </div>
  );
}
