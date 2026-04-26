-- Phase 3.1 Step 2 — regime classification + ECOS macro schema.
--
-- Reference: docs/phase3_1_regime_classification_blueprint.md §3
--
-- What this migration changes:
--
-- 1. New table `ecos_readings` — ECOS (한국은행 OpenAPI) reading store.
--    Mirrors the FRED `indicator_readings` shape but adds an
--    `item_code` column because many ECOS `STAT_CODE`s are stat-GROUPS
--    that disambiguate sub-series via `ITEM_CODE1` (see
--    src/lib/score-engine/sources/ecos-parse.ts §1). Family-shared
--    SELECT under RLS; writes are service-role only via the future
--    ingest-ecos cron, mirroring the indicator_readings pattern.
--
-- 2. Three regime columns on `composite_snapshots` — the classifier's
--    label, confidence, and per-feature input map. Stored alongside the
--    snapshot so the /backtest deviation table can explain regime
--    decisions without re-running the classifier.
--
-- 3. `model_version_history` row for v2.1.0 — marks the cutover for
--    Phase 3.1's regime + kr_equity ECOS additions. v2.0.0 baseline
--    weights remain in WEIGHTS_REGISTRY for replay/comparison.
--
-- Capacity (Supabase Free 500 MB):
--   ecos_readings — 6 series × 1 reading/day × 365 = ~2,200 rows/year.
--   regime columns add ~80 bytes × 2 snapshots/day × 4 assets = trivial.
--   Net annual growth well under 1 MB.

------------------------------------------------------------------------
-- 1. ecos_readings — ECOS reading store
------------------------------------------------------------------------

CREATE TABLE public.ecos_readings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_code      TEXT NOT NULL,          -- ECOS STAT_CODE (e.g. '722Y001')
  item_code        TEXT,                   -- ITEM_CODE1 filter; null for ungrouped series
  observed_at      DATE NOT NULL,
  value_raw        NUMERIC,
  value_normalized NUMERIC,
  score_0_100      NUMERIC,
  fetch_status     public.fetch_status_enum NOT NULL DEFAULT 'success',
  source_name      TEXT NOT NULL DEFAULT 'ecos',
  ingested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload      JSONB,
  model_version    TEXT NOT NULL
);

-- Composite uniqueness key on (series, item_code, observed_at).
-- COALESCE the nullable item_code to a sentinel string so two rows with
-- NULL item_code on the same (series, date) still collide — Postgres
-- treats NULL != NULL in UNIQUE indexes by default.
CREATE UNIQUE INDEX ecos_readings_series_item_observed_idx
  ON public.ecos_readings (series_code, COALESCE(item_code, '_'), observed_at);

CREATE INDEX ecos_readings_observed_idx
  ON public.ecos_readings (observed_at DESC);

ALTER TABLE public.ecos_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "family read all ecos_readings"
  ON public.ecos_readings
  FOR SELECT
  TO authenticated
  USING (true);
-- No user-side INSERT/UPDATE/DELETE — service-role admin only via the
-- ingest-ecos cron, mirroring the indicator_readings ingest pattern.

COMMENT ON TABLE public.ecos_readings IS
  'Phase 3.1 — ECOS (한국은행) reading store. (series_code, item_code, observed_at) is the UNIQUE upsert key; item_code disambiguates sub-series within a stat-group STAT_CODE.';

------------------------------------------------------------------------
-- 2. composite_snapshots — regime columns
------------------------------------------------------------------------

ALTER TABLE public.composite_snapshots
  ADD COLUMN regime_label TEXT,
  ADD COLUMN regime_confidence NUMERIC(5,4),
  ADD COLUMN regime_features JSONB;

COMMENT ON COLUMN public.composite_snapshots.regime_label IS
  'Phase 3.1 — one of risk_on_easing / risk_on_neutral / risk_off_tightening / risk_off_recession / transition. Null when classifier confidence < 0.6 or inputs incomplete.';

COMMENT ON COLUMN public.composite_snapshots.regime_confidence IS
  'Phase 3.1 — classifier output 0.0-1.0. Null = loud failure (insufficient inputs).';

COMMENT ON COLUMN public.composite_snapshots.regime_features IS
  'Phase 3.1 — per-feature numeric inputs the classifier evaluated, e.g. {"vix": 22.4, "fedfunds_slope": -0.25}. Used by /backtest deviation-table to explain regime decisions.';

------------------------------------------------------------------------
-- 3. model_version_history — v2.1.0 cutover marker
------------------------------------------------------------------------

INSERT INTO public.model_version_history (model_version, cutover_date, notes)
VALUES (
  'v2.1.0',
  CURRENT_DATE,
  'Phase 3.1: regime classification + ECOS macro for kr_equity. v2.0.0-baseline preserved in WEIGHTS_REGISTRY.'
)
ON CONFLICT (model_version) DO NOTHING;
