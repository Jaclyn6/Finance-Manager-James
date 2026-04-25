import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

import { CACHE_TAGS } from "./tags";

/**
 * Price-history readers for the `/asset/[slug]` price-overlay chart
 * (blueprint §9 Step 9, Step 10; PRD §11.6).
 *
 * ─── §7.4 visualization-only invariant ───────────────────────────
 *
 * **This file MUST NOT be imported from any file under
 * `src/lib/score-engine/**`.** Blueprint §7.4 plus PRD §8.5 line 188
 * declare `price_readings` as a visualization-only table — price bars
 * are OHLC context for the user's eye, never a numeric input to the
 * composite score or signal alignment engines. The technical engine
 * reads derived indicators (RSI, MACD, MA50/200, Bollinger, disparity)
 * from `technical_readings`, not raw closes from here.
 *
 * A grep guard enforces this boundary at review time:
 *
 *   grep -r "from \"@/lib/data/prices\"" src/lib/score-engine/
 *   (expected: no matches)
 *
 * If a future feature wants price-based signals (e.g. "SPY −20% from
 * 200-day high → MOMENTUM_TURN"), compute that at the `technical`
 * layer from the same AV fetch that already populates both tables,
 * and surface it as a boolean on `technical_readings`. Do NOT reach
 * into `@/lib/data/prices` from the engine — the single-purpose
 * module rule is what lets us update this reader's cache policy or
 * ticker-selection heuristic without auditing score determinism.
 *
 * ─── Cache + admin-client rationale ──────────────────────────────
 *
 * Same pattern as `src/lib/data/indicators.ts`:
 *
 * 1. Family-wide data → admin client is correct (no per-user RLS).
 * 2. `'use cache'` can't call `cookies()`; admin has no cookie dep.
 * 3. Client created inside the function body so the captured-values
 *    serializability rule of `'use cache'` never applies.
 *
 * Each reader declares `cacheTag(CACHE_TAGS.prices)` + `cacheLife`.
 * Both cron endpoints that write this table — `ingest-prices` (crypto)
 * and `ingest-technical` (12 AV tickers, shared fetch — KR carve-out
 * 2026-04-25 reduced 19 → 12; see ticker-registry.ts header) — call
 * `revalidateTag('prices', { expire: 0 })` on success, so stale cached
 * rows evict as soon as fresh bars land.
 */

/**
 * Point shape for the overlay chart. Kept narrow on purpose: the
 * chart only needs `(price_date, close)` to plot a line; other OHLC
 * columns on `price_readings` (open/high/low/volume) would bloat the
 * cache value for zero visual benefit. If a future candlestick chart
 * wants them, add a second reader rather than widening this one.
 */
export interface PricePoint {
  price_date: string;
  close: number;
}

/** Sensible fallback window when callers pass malformed `days`. */
const DEFAULT_WINDOW_DAYS = 90;

/**
 * Returns the daily close series for `ticker` over the last `days`
 * calendar days ending at `endDate`, oldest-first for chart plotting.
 *
 * Ordering, cadence, and the `endDate` clamp mirror
 * `getCompositeSnapshotsForAssetRange` in `indicators.ts` so callers
 * can zip the two series by date without extra massaging.
 *
 * Empty-result semantics (blueprint brief for this step):
 * - No rows at all for `ticker` → returns `[]`. The overlay component
 *   falls back to score-only rendering (backwards compatible with
 *   Step 6 behavior).
 * - Partial window (bootstrapping, e.g. day 2 of price collection) →
 *   returns what's available. Sparse data is correct; the chart's
 *   Recharts `Line` draws whatever it's given.
 *
 * @param ticker storage ticker as written by the cron — AV symbols
 *   (e.g. `SPY`, `005930.KS`) or CoinGecko-derived symbols (`BTC`,
 *   `ETH`, `SOL`). Resolve the user-facing asset slug via
 *   `pickRepresentativeTicker(assetType)` before calling.
 * @param endDate inclusive upper bound (`YYYY-MM-DD`).
 * @param days non-negative window size; malformed input falls back
 *   to {@link DEFAULT_WINDOW_DAYS} so the chart always renders
 *   something rather than 500-ing on a caller bug.
 */
export async function getPriceHistoryForTicker(
  ticker: string,
  endDate: string,
  days: number,
): Promise<PricePoint[]> {
  "use cache";
  cacheTag(CACHE_TAGS.prices);
  cacheLife("days");

  const safeDays =
    Number.isFinite(days) && days > 0 ? Math.floor(days) : DEFAULT_WINDOW_DAYS;
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  const startDate = Number.isFinite(endMs)
    ? new Date(endMs - safeDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
    : endDate;

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("price_readings")
    .select("price_date, close")
    .eq("ticker", ticker)
    .gte("price_date", startDate)
    .lte("price_date", endDate)
    .order("price_date", { ascending: true });

  if (error) {
    throw new Error(
      `getPriceHistoryForTicker(${ticker}, ${endDate}, ${days}) failed: ${error.message} (${error.code ?? "no code"})`,
    );
  }

  return (
    (data ?? [])
      .map((row) => ({
        price_date: row.price_date,
        // Defensive coerce — Supabase NUMERIC can be returned as string in some
        // client versions / large values, even though the generated type says
        // `number`. Do not remove.
        close: Number(row.close),
      }))
      // Defense against malformed NUMERIC rows reaching Recharts (null-intent
      // path; NaN would render glitched lines / break auto Y-domain).
      .filter((p) => Number.isFinite(p.close))
  );
}

/**
 * Returns the most recent price bar for `ticker`, or `null` if the
 * ticker has no rows yet. Used by hero-card tooltips and future
 * compact surfaces that want "latest close" without plotting a chart.
 *
 * Separate reader (not a `.at(-1)` on {@link getPriceHistoryForTicker})
 * because the cache key on a window query is `(ticker, endDate, days)`
 * and a tooltip doesn't want a 90-day payload in memory just to
 * extract one number. `cacheLife('days')` matches the window reader —
 * both invalidate on the `prices` tag write-through.
 */
export async function getLatestPriceForTicker(
  ticker: string,
): Promise<PricePoint | null> {
  "use cache";
  cacheTag(CACHE_TAGS.prices);
  cacheLife("days");

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("price_readings")
    .select("price_date, close")
    .eq("ticker", ticker)
    .order("price_date", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(
      `getLatestPriceForTicker(${ticker}) failed: ${error.message} (${error.code ?? "no code"})`,
    );
  }

  const row = data?.[0];
  if (!row) return null;
  // Defensive coerce — Supabase NUMERIC can be returned as string in some
  // client versions / large values, even though the generated type says
  // `number`. Do not remove.
  const close = Number(row.close);
  // Defense against malformed NUMERIC rows reaching Recharts (null-intent
  // path; NaN would render glitched lines / break auto Y-domain) and, here,
  // prevent a NaN leaking into the hero-card aria-label.
  if (!Number.isFinite(close)) return null;
  return { price_date: row.price_date, close };
}
