import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import type { AdvisorAssetView } from "@/lib/data/advisor";
import { cn } from "@/lib/utils";
import { ASSET_LABELS } from "@/lib/utils/asset-labels";
import { ASSET_SLUGS } from "@/lib/utils/asset-slug";
import { buildNavHref } from "@/lib/utils/nav-href";
import {
  VERDICT_BADGE_CLASS,
  VERDICT_LABEL_KO,
} from "@/lib/utils/verdict-labels";

/**
 * Per-asset advisor verdict card — the dashboard's answer to "지금이
 * 할인 구간인가?" for one asset class.
 *
 * Visual hierarchy (PRD pivot 2026-07-08): the verdict pill + headline
 * carry the judgment, the drawdown stats quantify it, and the top-2
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
        "h-full p-5 md:p-6 motion-safe:transition-colors",
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
              "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold",
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

        {verdict.evidenceKo.length > 0 && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {verdict.evidenceKo.slice(0, 2).map((evidence) => (
              <li key={evidence} className="flex gap-1.5">
                <span aria-hidden className="text-muted-foreground/60">
                  ―
                </span>
                <span>{evidence}</span>
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
 * Horizontal evidence balance: reversal (left, red) ↔ discount
 * (right, emerald). Marker position maps netScore [-1, 1] → [0%, 100%].
 * Pure CSS — no client JS.
 */
function EvidenceBalanceBar({ netScore }: { netScore: number }) {
  const pct = ((netScore + 1) / 2) * 100;
  return (
    <div aria-hidden className="space-y-1">
      <div className="relative h-1.5 w-full rounded-full bg-gradient-to-r from-red-500/40 via-muted to-emerald-500/40">
        <div
          className="absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded-full bg-foreground"
          style={{ left: `calc(${pct.toFixed(1)}% - 2px)` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>추세전환 근거</span>
        <span>할인 근거</span>
      </div>
    </div>
  );
}
