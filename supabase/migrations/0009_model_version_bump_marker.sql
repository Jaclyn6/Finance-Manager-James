-- Model-version cutover marker table (blueprint §4.4, §8.5).
--
-- Backs the dashboard header badge "모델 vX.Y.Z — YYYY-MM-DD 전환" and the
-- `/asset/[slug]` trend chart's `ReferenceLine` at the cutover date. Reading
-- the cutover date from the DB (instead of hard-coding it in TS) means the
-- UI stays truthful across environments even if the Phase 2 deploy slips.
--
-- Write-path: INSERT only. Each row is a historical fact — once a cutover
-- happened on a given date, it did; corrections would be a separate,
-- future-dated row rather than an in-place edit. (There are exactly two rows
-- for the foreseeable future — v1.0.0 and v2.0.0 — so the INSERT-only policy
-- is not burdensome.)

CREATE TABLE IF NOT EXISTS public.model_version_history (
  model_version  TEXT        PRIMARY KEY,
  cutover_date   DATE        NOT NULL,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.model_version_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_model_version_history"
  ON public.model_version_history
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service_role_write_model_version_history"
  ON public.model_version_history
  FOR INSERT
  TO service_role
  WITH CHECK (true);

INSERT INTO public.model_version_history (model_version, cutover_date, notes)
VALUES
  ('v1.0.0', '2026-03-21', 'Phase 1 MVP — 7 FRED macro indicators, equal-asymmetric weights.'),
  ('v2.0.0', '2026-04-23', 'Phase 2 — 4-category model (macro/technical/onchain/sentiment) per PRD §10 asset-specific weights.')
ON CONFLICT (model_version) DO NOTHING;
