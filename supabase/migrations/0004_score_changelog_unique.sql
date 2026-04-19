-- Enforce idempotency for score_changelog writes.
--
-- Background: the 0001 schema gave `indicator_readings` and
-- `composite_snapshots` unique indexes on their natural keys, but
-- `score_changelog` was left without one — so `writeScoreChangelog`
-- in `src/lib/data/snapshot.ts` could only do a plain .insert().
-- Problem: the Vercel cron can legitimately re-fire for the same day
-- (manual retrigger, 5xx retry, etc.) and would then produce duplicate
-- delta rows for the same (asset_type, change_date).
--
-- Fix: add the same shape of uniqueness as `composite_snapshots` — one
-- row per (asset_type, change_date, model_version). On cron retry the
-- upsert now no-ops (or replaces with the recalculated delta, which is
-- what we want when a partial-failure day produces a better composite
-- on the second pass).
--
-- Safe to run at this point in Phase 1: no rows exist in score_changelog
-- yet (the cron route handler is being implemented in the same step
-- this migration lands in).

CREATE UNIQUE INDEX score_changelog_dedup
  ON public.score_changelog (asset_type, change_date, model_version);
