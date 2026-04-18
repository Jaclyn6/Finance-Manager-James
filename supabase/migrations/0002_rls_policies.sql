-- Phase 1 Row-Level Security policies.
-- Principle: authenticated users read, service_role writes. No direct client writes.
-- user_preferences is the only table with per-user isolation.

-- ============================================================
-- Enable RLS on all tables
-- ============================================================

ALTER TABLE public.indicator_readings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.composite_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_changelog     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingest_runs         ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- indicator_readings
-- ============================================================

CREATE POLICY "authenticated_read_indicator_readings"
  ON public.indicator_readings
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service_role_write_indicator_readings"
  ON public.indicator_readings
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "service_role_update_indicator_readings"
  ON public.indicator_readings
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- composite_snapshots
-- ============================================================

CREATE POLICY "authenticated_read_composite_snapshots"
  ON public.composite_snapshots
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service_role_write_composite_snapshots"
  ON public.composite_snapshots
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ============================================================
-- score_changelog
-- ============================================================

CREATE POLICY "authenticated_read_score_changelog"
  ON public.score_changelog
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service_role_write_score_changelog"
  ON public.score_changelog
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ============================================================
-- ingest_runs
-- ============================================================

CREATE POLICY "authenticated_read_ingest_runs"
  ON public.ingest_runs
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service_role_write_ingest_runs"
  ON public.ingest_runs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ============================================================
-- user_preferences
-- Strict per-user isolation. (SELECT auth.uid()) wrapper caches
-- the function call per-statement instead of per-row — small but
-- meaningful optimization on wider scans.
-- ============================================================

CREATE POLICY "users_read_own_preferences"
  ON public.user_preferences
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "users_insert_own_preferences"
  ON public.user_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "users_update_own_preferences"
  ON public.user_preferences
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
