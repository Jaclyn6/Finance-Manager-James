/**
 * Phase 3.4 Step 5 — Suspense fallback for the Backtest page.
 *
 * Tracks the actual layout (header + controls box + chart placeholder
 * + summary grid) so the skeleton-to-content swap doesn't flash
 * layout-shift. Pure CSS pulse via tailwind `animate-pulse`.
 */
export function BacktestSkeleton() {
  return (
    <>
      <div className="space-y-2">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-96 animate-pulse rounded bg-muted/60" />
      </div>
      <div className="rounded-2xl border bg-card p-6 md:p-8">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="h-20 animate-pulse rounded bg-muted" />
          <div className="h-20 animate-pulse rounded bg-muted" />
          <div className="h-20 animate-pulse rounded bg-muted" />
          <div className="h-20 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="h-80 animate-pulse rounded-2xl bg-muted/40" />
    </>
  );
}
