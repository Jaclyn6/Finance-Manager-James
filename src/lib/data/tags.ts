/**
 * Canonical cache-tag names used by the data layer.
 *
 * These strings must match EXACTLY between:
 * - readers calling `cacheTag(...)` inside `'use cache'` scopes
 *   (src/lib/data/indicators.ts, src/lib/data/changelog.ts),
 * - the cron route handler calling `revalidateTag(..., { expire: 0 })`
 *   after a successful ingest (src/app/api/cron/ingest-macro/route.ts,
 *   scheduled for blueprint §9 Step 8).
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
} as const;

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];
