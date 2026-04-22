-- Phase 2 Row-Level Security policies.
-- Mirrors Phase 1 (0002_rls_policies.sql): authenticated users read, service_role writes.
-- No per-user isolation — all three family members see the same rows (blueprint
-- §2.2 tenet 3, "family-wide, not per-user").
--
-- Write-path policy nuances per blueprint §2.2 tenet 2 (snapshot immutability):
--   technical_readings, onchain_readings, news_sentiment — INSERT only.
--     Snapshot rows stamped with `model_version`; corrections via version bump.
--   price_readings                                      — INSERT + UPDATE.
--     Visualization-only (PRD §8.5 line 188). Re-fetches overwrite OHLCV bars;
--     no immutability constraint because these rows never feed the composite.
--   signal_events                                       — INSERT + UPDATE.
--     The signal engine may re-run for the same (snapshot_date,
--     signal_rules_version) when a later cron in the same day refreshes inputs;
--     ON CONFLICT DO UPDATE is the permitted correction vector (0006 comment).

-- ============================================================
-- Enable RLS on all new Phase 2 tables
-- ============================================================

ALTER TABLE public.technical_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onchain_readings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_sentiment     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_readings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_events      ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- technical_readings
-- ============================================================

CREATE POLICY "authenticated_read_technical_readings"
  ON public.technical_readings
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service_role_write_technical_readings"
  ON public.technical_readings
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ============================================================
-- onchain_readings
-- ============================================================

CREATE POLICY "authenticated_read_onchain_readings"
  ON public.onchain_readings
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service_role_write_onchain_readings"
  ON public.onchain_readings
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ============================================================
-- news_sentiment
-- ============================================================

CREATE POLICY "authenticated_read_news_sentiment"
  ON public.news_sentiment
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service_role_write_news_sentiment"
  ON public.news_sentiment
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ============================================================
-- price_readings
-- Visualization-only; UPDATE permitted for re-fetch overwrites.
-- ============================================================

CREATE POLICY "authenticated_read_price_readings"
  ON public.price_readings
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service_role_write_price_readings"
  ON public.price_readings
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "service_role_update_price_readings"
  ON public.price_readings
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- signal_events
-- UPDATE permitted so the signal engine can upsert by (snapshot_date,
-- signal_rules_version) when a later cron in the same day re-evaluates.
-- ============================================================

CREATE POLICY "authenticated_read_signal_events"
  ON public.signal_events
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service_role_write_signal_events"
  ON public.signal_events
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "service_role_update_signal_events"
  ON public.signal_events
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);
