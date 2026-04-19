import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildNavHref } from "@/lib/utils/nav-href";

/**
 * Empty-state notice rendered when the user picks a date that has no
 * `composite_snapshots` rows (blueprint §10 acceptance: "데이터가 없는
 * 날짜를 선택하면 값을 추정하지 않고 안내 + 최근 이전 수집일 제안").
 *
 * Deliberately renders NO score, no placeholder number, no "loading"
 * ambiguity — the product promise is that the dashboard never fabricates
 * a reading. Instead we explain what happened and, if a closer earlier
 * snapshot exists, offer a one-tap jump there.
 *
 * Server Component — caller passes in the already-resolved
 * `closestEarlierDate` (or `null`) from `getClosestEarlierSnapshotDate`.
 * Keeping the DB call at the caller makes this component a pure
 * renderer and avoids cascading `'use cache'` requirements here.
 */
export interface NoSnapshotNoticeProps {
  selectedDate: string;
  closestEarlierDate: string | null;
  /** Path the "jump" Link should point at. Defaults to `/dashboard`. */
  basePath?: string;
}

export function NoSnapshotNotice({
  selectedDate,
  closestEarlierDate,
  basePath = "/dashboard",
}: NoSnapshotNoticeProps) {
  return (
    <div className="rounded-2xl border bg-card p-6 text-center md:p-12">
      {/*
        Semantic `<h2>` (not a styled `<p>`) so screen-reader users
        navigating by heading can land on the state-specific label and
        immediately understand the empty-state context. WCAG 2.4.6 /
        1.3.1 — same pattern we applied to RecentChanges at Step 10
        post-review.
      */}
      <h2 className="text-sm font-semibold text-foreground">
        {selectedDate} 데이터가 없습니다
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        이 날짜에는 수집된 스냅샷이 없어 점수를 표시할 수 없습니다. 값을
        추정해 만들어내지 않고 공백으로 표시합니다.
      </p>

      {closestEarlierDate ? (
        // shadcn base-ui Button has no `asChild` prop; apply
        // `buttonVariants` directly to the `<Link>` for the same look
        // while keeping the anchor semantics (so `Cmd/Ctrl+click` opens
        // in a new tab and screen readers announce it as a link, not
        // a button). `prefetch={false}` so scrubbing dates doesn't
        // prefetch N-1 pages per click.
        <Link
          href={buildNavHref(basePath, closestEarlierDate)}
          prefetch={false}
          // `h-11` (44px) to honor blueprint §6.2 ≥44×44 touch target
          // — this link is the primary recovery action from an empty
          // state, so it must be comfortably tappable on mobile. We
          // keep `buttonVariants({ size: "sm" })` for its padding / gap
          // / font-size tokens and override only the height; the result
          // reads as a slightly roomier sm-button, not a full default
          // button, which fits inside the notice card's visual weight.
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "mt-4 h-11",
          )}
        >
          가장 가까운 이전 수집일 ({closestEarlierDate})로 이동
        </Link>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          이 날짜 이전에도 수집된 스냅샷이 없습니다.
        </p>
      )}
    </div>
  );
}
