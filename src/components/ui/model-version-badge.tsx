import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getModelVersionRow } from "@/lib/data/model-version";
import { MODEL_VERSION } from "@/lib/score-engine/weights";

/**
 * Compact pill announcing the active score model version, with a
 * hover/focus tooltip that documents the cutover date and the Phase
 * 1 → Phase 2 change.
 *
 * Renders in the dashboard hero zone (blueprint §4.4 Step 3). Kept
 * intentionally small so it doesn't compete visually with the
 * `CompositeStateCard` that sits immediately below it.
 *
 * ─ Server Component by design ───────────────────────────────────
 *
 * Declared `async` so the data read happens on the server inside the
 * `'use cache'` scope of `getModelVersionRow`. The Tooltip primitives
 * from base-ui are client-side, but they render fine as children of a
 * Server Component — Next.js splits the tree at the `"use client"`
 * boundary inside `ui/tooltip.tsx` automatically. No `"use client"`
 * directive is needed here because the file itself doesn't call any
 * client-only hooks; it just composes client components with
 * server-computed strings as props.
 *
 * ─ Graceful fallback ────────────────────────────────────────────
 *
 * If migration 0009 hasn't run in the caller's environment — e.g. a
 * fresh local dev DB — `getModelVersionRow` returns `null`. In that
 * case we render the version pill without the cutover-date tail,
 * matching the "silent success / loud failure" tenet (plan §0.5
 * tenet 1): the UI doesn't crash, it just shows less information.
 *
 * ─ Accessibility ────────────────────────────────────────────────
 *
 * - `role="status"` on the outer button so screen readers treat the
 *   pill as a live region communicating system state. The `aria-label`
 *   contains the full "v2.0.0, 2026-04-23 전환" sentence so the pill
 *   is meaningful even without hover/focus (tooltip is a sighted-user
 *   affordance).
 * - 44×44 touch target: the blueprint §6.4 + iOS accessibility rule.
 *   Achieved via `min-h-11 min-w-11` on the trigger wrapping the
 *   smaller visual pill — the hit area is invisible but meets the
 *   WCAG 2.5.5 AAA target size for touch on mobile.
 * - Tooltip shows on both hover AND keyboard focus (base-ui default),
 *   so keyboard-only users get the cutover-date context too.
 */
export async function ModelVersionBadge() {
  const row = await getModelVersionRow(MODEL_VERSION);

  const versionLabel = `모델 ${MODEL_VERSION}`;
  const cutoverDate = row?.cutover_date ?? null;
  const notes = row?.notes ?? null;

  // Compose the aria-label so the status pill is self-describing for
  // assistive tech users who never see the tooltip. If the DB row
  // isn't seeded, fall back to just the version string.
  const ariaLabel = cutoverDate
    ? `활성 점수 모델 ${MODEL_VERSION}, ${cutoverDate} 전환`
    : `활성 점수 모델 ${MODEL_VERSION}`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          // `type="button"` prevents default-submit behavior if the
          // badge ever ends up inside a form. `min-h-11 min-w-11`
          // gives the touch target its iOS-accessible 44×44 footprint
          // while the visible pill stays compact — the extra space
          // is transparent padding around the Badge.
          type="button"
          role="status"
          aria-label={ariaLabel}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Badge variant="outline" className="gap-1 text-[11px]">
            <span aria-hidden="true" className="font-semibold">
              {versionLabel}
            </span>
            {cutoverDate ? (
              <span
                aria-hidden="true"
                className="text-muted-foreground"
              >
                · {cutoverDate}
              </span>
            ) : null}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          <div className="space-y-1">
            <div className="font-medium">
              {versionLabel}
              {cutoverDate ? ` · ${cutoverDate} 전환` : ""}
            </div>
            {notes ? (
              <div className="text-[11px] leading-snug opacity-80">
                {notes}
              </div>
            ) : (
              <div className="text-[11px] leading-snug opacity-80">
                Phase 2 — 4-category model (macro / technical / onchain /
                sentiment)
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
