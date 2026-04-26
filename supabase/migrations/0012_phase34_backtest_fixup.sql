-- Phase 3.4 Trigger 2 review fix-up — addresses confidence ≥ 80
-- findings on 0011_phase34_backtest.sql.
--
-- Changes:
--   1. RLS family-read policies migrated from `USING (auth.role() =
--      'authenticated')` to the project-standard `TO authenticated
--      USING (true)` form (matches 0002_rls_policies.sql /
--      0007_phase2_rls.sql).
--   2. `backtest_runs.user_id` made NOT NULL and FK switched from
--      ON DELETE SET NULL to ON DELETE CASCADE — the API route always
--      stamps a non-null user_id at write time, and a NULL user_id
--      breaks the (request_hash, user_id) UNIQUE index semantics
--      (PostgreSQL treats NULLs as distinct, so deleted-user orphan
--      rows can duplicate live memo keys).
--   3. `backtest_snapshots.raw_inputs JSONB` column added — blueprint
--      §2.4 lists this as part of the per-day row. Currently unused by
--      the engine (replay re-weights existing per-category scores from
--      `composite_snapshots`), but Phase 3.4.1 signal-only backtest
--      will need it.
--   4. `backtest_runs` capacity comment refresh — the original 60-
--      trading-day estimate doesn't correspond to any constant in the
--      codebase. Default range is 90 calendar days (~64 trading days);
--      cap is 365 calendar days (~250 trading days).

-- 1. RLS form drift fix --------------------------------------------------

DROP POLICY IF EXISTS "family read all user_weights"
  ON public.user_weights;
CREATE POLICY "family read all user_weights"
  ON public.user_weights
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "family read all backtest_runs"
  ON public.backtest_runs;
CREATE POLICY "family read all backtest_runs"
  ON public.backtest_runs
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "family read all backtest_snapshots"
  ON public.backtest_snapshots;
CREATE POLICY "family read all backtest_snapshots"
  ON public.backtest_snapshots
  FOR SELECT
  TO authenticated
  USING (true);

-- 2. backtest_runs.user_id NOT NULL + ON DELETE CASCADE ------------------

-- Drop the existing FK so we can recreate it with CASCADE.
ALTER TABLE public.backtest_runs
  DROP CONSTRAINT IF EXISTS backtest_runs_user_id_fkey;

-- Enforce NOT NULL. Safe because the route invariant always supplies
-- a non-null user_id at insert time, and no users have been deleted
-- yet (Phase 3.4 launched 2026-04-26).
ALTER TABLE public.backtest_runs
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.backtest_runs
  ADD CONSTRAINT backtest_runs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 3. backtest_snapshots.raw_inputs ---------------------------------------

ALTER TABLE public.backtest_snapshots
  ADD COLUMN IF NOT EXISTS raw_inputs JSONB;

COMMENT ON COLUMN public.backtest_snapshots.raw_inputs IS
  'Phase 3.4.1 forward-looking — the macro/technical/onchain/sentiment dict used at replay. Currently NULL (engine re-weights existing scores).';

-- 4. Refreshed table comment ---------------------------------------------

COMMENT ON TABLE public.backtest_runs IS
  'Phase 3.4 — one row per backtest request. request_hash is the memoization key (SHA256 of canonical request + customWeights payload); family RLS allows shared reads. Capacity: ~250 detail rows worst case at the 365-day cap, or ~64 at the 90-day default — comfortably under the Supabase Free 500 MB ceiling for the 3-user family.';
