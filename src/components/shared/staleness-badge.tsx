import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

/**
 * Surfaces the "how fresh is this number?" signal next to a composite
 * snapshot (PRD §12 — `fetch_status_enum` + data-freshness UX).
 *
 * Two independent axes collapse into one four-state label:
 *
 * 1. **`fetch_status`** — what the cron recorded for this snapshot.
 *    `success` = every upstream indicator resolved. Anything else
 *    (`partial`, `stale`, `error`) means the composite was computed
 *    against incomplete or reused data and the user deserves a
 *    warning.
 * 2. **Age vs today** — even a `success` row becomes untrustworthy
 *    after several missed cron runs. 0-1 days old is "최신", 2-6 is
 *    "지연" (likely 1-2 missed runs), 7+ is "오래됨" (outage territory).
 *
 * Precedence: non-success `fetch_status` dominates age. A `partial`
 * row from today still reads "부분 수집" rather than "최신" — we prefer
 * the stronger signal.
 *
 * Color mapping uses inline tokens rather than extending `badgeVariants`
 * because "warning amber" is a dashboard-specific semantic, not a
 * site-wide shadcn variant.
 */
type FetchStatus = Database["public"]["Enums"]["fetch_status_enum"];

export interface StalenessInfo {
  label: string;
  /** Map to the Badge variant that best matches the semantic weight. */
  variant: "secondary" | "outline" | "destructive";
  /** Extra classes layered on top of the variant for fine-tuned palette. */
  className?: string;
}

/**
 * Pure classifier — unit-tested separately so the component stays a
 * thin render shell. The rule surface is:
 *
 * | status    | age (days) | label           | palette       |
 * |-----------|------------|-----------------|---------------|
 * | success   | ≤ 1        | 최신            | secondary     |
 * | success   | 2-6        | {N}일 지연      | outline amber |
 * | success   | ≥ 7        | {N}일 지연      | destructive   |
 * | partial   | any        | 부분 수집       | outline amber |
 * | stale     | any        | 이전 값 사용    | outline amber |
 * | error     | any        | 수집 실패       | destructive   |
 *
 * `ageDays` is caller-provided (not `new Date()` inside here) so the
 * function stays pure and deterministic under Vitest.
 */
export function resolveStaleness(
  fetchStatus: FetchStatus,
  ageDays: number,
): StalenessInfo {
  if (fetchStatus === "error") {
    return { label: "수집 실패", variant: "destructive" };
  }
  if (fetchStatus === "partial") {
    return {
      label: "부분 수집",
      variant: "outline",
      className: "border-amber-500/40 text-amber-700 dark:text-amber-300",
    };
  }
  if (fetchStatus === "stale") {
    return {
      label: "이전 값 사용",
      variant: "outline",
      className: "border-amber-500/40 text-amber-700 dark:text-amber-300",
    };
  }
  // fetchStatus === "success"
  const safeAge = Number.isFinite(ageDays) ? Math.max(0, Math.floor(ageDays)) : 0;
  if (safeAge <= 1) {
    return { label: "최신", variant: "secondary" };
  }
  if (safeAge < 7) {
    return {
      label: `${safeAge}일 지연`,
      variant: "outline",
      className: "border-amber-500/40 text-amber-700 dark:text-amber-300",
    };
  }
  return { label: `${safeAge}일 지연`, variant: "destructive" };
}

/**
 * Computes `ageDays` between `snapshotDate` (YYYY-MM-DD, UTC midnight
 * semantics from Postgres DATE) and `today` (same format).
 *
 * Both arguments are ISO date strings — no `Date` arithmetic surprises
 * around DST or timezone offsets. Negative ages (future-dated snapshot
 * from clock skew) clamp to 0 so they read as "최신" rather than flipping
 * the label.
 */
export function computeAgeDays(snapshotDate: string, today: string): number {
  const snap = Date.parse(`${snapshotDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(snap) || !Number.isFinite(now)) return 0;
  const diffMs = now - snap;
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

export interface StalenessBadgeProps {
  fetchStatus: FetchStatus;
  snapshotDate: string; // YYYY-MM-DD
  /** Defaults to today in UTC. Override in tests / SSR for determinism. */
  today?: string;
  className?: string;
}

/**
 * Server Component — no interactivity, no `useState`. Renders a Badge
 * with the resolved staleness label.
 */
export function StalenessBadge({
  fetchStatus,
  snapshotDate,
  today = new Date().toISOString().slice(0, 10),
  className,
}: StalenessBadgeProps) {
  const ageDays = computeAgeDays(snapshotDate, today);
  const { label, variant, className: paletteClass } = resolveStaleness(
    fetchStatus,
    ageDays,
  );
  return (
    <Badge variant={variant} className={cn(paletteClass, className)}>
      {label}
    </Badge>
  );
}
