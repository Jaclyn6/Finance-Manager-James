/**
 * Canonical cache-tag names used by the data layer.
 *
 * These strings must match EXACTLY between:
 * - readers calling `cacheTag(...)` inside `'use cache'` scopes
 *   (src/lib/data/indicators.ts, src/lib/data/changelog.ts,
 *   src/lib/data/signals.ts),
 * - the cron route handlers calling `revalidateTag(..., { expire: 0 })`
 *   after a successful ingest. Writer call sites:
 *     - src/app/api/cron/ingest-macro/route.ts
 *     - src/app/api/cron/ingest-technical/route.ts
 *     - src/app/api/cron/ingest-onchain/route.ts
 *     - src/app/api/cron/ingest-news/route.ts
 *     - src/app/api/cron/ingest-cnn-fg/route.ts
 *     - src/app/api/cron/ingest-prices/route.ts (prices tag ONLY — the
 *       price_readings table is visualization-only per blueprint §7.4 and
 *       has no signal input, so ingest-prices never invalidates `signals`).
 *
 * A typo here silently breaks cache invalidation — the cron succeeds,
 * the DB updates, but stale cached snapshots linger until `cacheLife`
 * expires. Centralizing the strings in one file makes a typo impossible:
 * every call site imports from the same object.
 *
 * Kept separate from `snapshot.ts` so that reader modules (which import
 * tag names) don't transitively pull in the writer module's admin-client
 * + `next/cache` `revalidateTag` footprint. The dependency graph is:
 *
 *   tags.ts  ──┐
 *              ├──> indicators.ts
 *              ├──> changelog.ts
 *              ├──> signals.ts
 *              └──> snapshot.ts
 */
export const CACHE_TAGS = {
  /** All composite_snapshots reads (latest + date-parameterized). */
  macroSnapshot: "macro-snapshot",
  /** All score_changelog reads. */
  changelog: "changelog",
  /**
   * All `model_version_history` reads (blueprint §4.4).
   *
   * Cutover rows are INSERT-only and extremely rare (two rows today —
   * v1.0.0 and v2.0.0). No cron path invalidates this tag; the
   * `cacheLife('days')` boundary is the only refresh trigger. Listed
   * in the registry anyway so a future manual SQL INSERT of a v3.0.0
   * cutover row can be paired with a one-line
   * `revalidateTag(CACHE_TAGS.modelVersion, { expire: 0 })` instead
   * of waiting up to 24h for the cache to roll.
   */
  modelVersion: "model-version",
  /**
   * All `onchain_readings` reads (blueprint §7.2 Phase 2 tags).
   *
   * Invalidated by `/api/cron/ingest-onchain` after writing the daily
   * Bitbo (MVRV_Z, SOPR), CoinGlass (BTC_ETF_NETFLOW), and
   * alternative.me (CRYPTO_FG) rows. The hourly GHA workflow
   * (blueprint §3.3) re-triggers this tag each run.
   *
   * NOTE: CNN_FG writes to `onchain_readings` too (per migration 0005
   * comment) but the sentiment category aggregator consumes it — so
   * the CNN F&G cron invalidates `{@link sentiment}` instead, not
   * this tag. Keep the split so a stale Bitbo read doesn't silently
   * bounce the sentiment card and vice versa.
   */
  onchain: "onchain",
  /**
   * Sentiment-category reads (CNN F&G + news sentiment).
   *
   * Invalidated by `/api/cron/ingest-cnn-fg` (this agent's scope) and
   * `/api/cron/ingest-news` (Agent C's scope). The card on the
   * dashboard that renders the sentiment sub-score depends on BOTH
   * sources being fresh; either cron's success invalidates this tag
   * so the reader refetches.
   */
  sentiment: "sentiment",
  /**
   * All `technical_readings` reads (blueprint §7.2 Phase 2 tag).
   *
   * Invalidated by `/api/cron/ingest-technical` after it writes the
   * 12-ticker × 6-indicator batch (RSI_14, MACD_12_26_9, MA_50,
   * MA_200, BB_20_2, DISPARITY) — KR carve-out 2026-04-25 reduced
   * 19 → 12; see ticker-registry.ts header. Every future reader under
   * `src/lib/data/technical.ts` (Step 8 UI) MUST declare this tag
   * inside its `'use cache'` scope.
   */
  technical: "technical",
  /**
   * All `price_readings` reads (blueprint §7.2).
   *
   * Invalidated by BOTH cron endpoints that write bars:
   * `ingest-technical` (12 AV tickers — shared fetch with the
   * technical pipeline writes to both tables; KR carve-out 2026-04-25
   * reduced 19 → 12, see ticker-registry.ts header) and `ingest-prices`
   * (3 CoinGecko crypto ids). Readers live under
   * `src/lib/data/prices.ts` (Step 10 price-overlay chart).
   *
   * Per blueprint §7.4 invariant, no file under
   * `src/lib/score-engine/**` may import from `@/lib/data/prices` —
   * price history is visualization-only, never a score input.
   */
  prices: "prices",
  /**
   * All `signal_events` reads (blueprint §4.5 Signal Alignment engine).
   *
   * Invalidated by the tail-call block in EVERY cron ingestion endpoint
   * (ingest-macro, ingest-technical, ingest-onchain, ingest-news,
   * ingest-cnn-fg). ingest-prices does NOT invalidate this tag because
   * price_readings is visualization-only (§8.5) and has no signal input.
   */
  signals: "signals",
} as const;

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];
