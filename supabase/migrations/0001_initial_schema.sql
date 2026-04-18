-- Phase 1 core schema: indicator readings + composite snapshots + changelog + user prefs + ingest audit.
-- RLS policies live in 0002. Family user accounts are created via the Supabase Admin API (not SQL).

-- ============================================================
-- Enums
-- ============================================================

CREATE TYPE public.fetch_status_enum AS ENUM (
  'success',   -- Fresh value from upstream source
  'error',     -- Upstream fetch failed entirely
  'stale',     -- Cached value beyond its refresh window
  'partial'    -- Some sub-fetches succeeded, others did not
);

CREATE TYPE public.asset_type_enum AS ENUM (
  'us_equity',   -- 미국주식
  'kr_equity',   -- 한국주식
  'btc',         -- BTC (Phase 2에서 ETH 추가 여부 별도 논의)
  'global_etf',  -- 글로벌 ETF
  'common'       -- Macro core indicators not tied to a single asset class
);

-- ============================================================
-- indicator_readings
-- Every fetched indicator observation, ever. Source of truth for backtest.
-- ============================================================

CREATE TABLE public.indicator_readings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator_key    TEXT        NOT NULL,
  asset_type       public.asset_type_enum NOT NULL DEFAULT 'common',
  value_raw        NUMERIC,
  value_normalized NUMERIC,
  score_0_100      NUMERIC,
  observed_at      TIMESTAMPTZ NOT NULL,
  released_at      TIMESTAMPTZ,
  ingested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_name      TEXT        NOT NULL,
  source_url       TEXT,
  frequency        TEXT,
  window_used      TEXT,
  model_version    TEXT        NOT NULL,
  fetch_status     public.fetch_status_enum NOT NULL DEFAULT 'success',
  is_revised       BOOLEAN     NOT NULL DEFAULT FALSE,
  raw_payload      JSONB
);

CREATE UNIQUE INDEX indicator_readings_dedup
  ON public.indicator_readings (indicator_key, observed_at, model_version);

CREATE INDEX indicator_readings_key_obs
  ON public.indicator_readings (indicator_key, observed_at DESC);

CREATE INDEX indicator_readings_ingested
  ON public.indicator_readings (ingested_at DESC);

-- ============================================================
-- composite_snapshots
-- What the dashboard reads. One row per (asset_type, date, model_version).
-- ============================================================

CREATE TABLE public.composite_snapshots (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type      public.asset_type_enum NOT NULL,
  snapshot_date   DATE        NOT NULL,
  score_0_100     NUMERIC     NOT NULL,
  band            TEXT        NOT NULL,
  model_version   TEXT        NOT NULL,
  contributing_indicators JSONB NOT NULL,
  fetch_status    public.fetch_status_enum NOT NULL DEFAULT 'success',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX composite_snapshots_dedup
  ON public.composite_snapshots (asset_type, snapshot_date, model_version);

CREATE INDEX composite_snapshots_date
  ON public.composite_snapshots (snapshot_date DESC, asset_type);

-- ============================================================
-- score_changelog
-- Delta vs previous snapshot. Written by cron after composite_snapshots upsert.
-- ============================================================

CREATE TABLE public.score_changelog (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type      public.asset_type_enum NOT NULL,
  change_date     DATE        NOT NULL,
  previous_score  NUMERIC,
  current_score   NUMERIC     NOT NULL,
  delta           NUMERIC,
  previous_band   TEXT,
  current_band    TEXT        NOT NULL,
  band_changed    BOOLEAN     NOT NULL DEFAULT FALSE,
  top_movers      JSONB,
  model_version   TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX score_changelog_date
  ON public.score_changelog (change_date DESC, asset_type);

-- ============================================================
-- user_preferences
-- Per-family-member persona (beginner / intermediate / expert).
-- Bootstrap rows inserted in 0002 after RLS is up.
-- ============================================================

CREATE TABLE public.user_preferences (
  user_id    UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  persona    TEXT        NOT NULL DEFAULT 'intermediate'
    CHECK (persona IN ('beginner', 'intermediate', 'expert')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- ingest_runs
-- Audit row per cron execution. Helps detect pipeline health.
-- ============================================================

CREATE TABLE public.ingest_runs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  model_version         TEXT        NOT NULL,
  indicators_attempted  INT         NOT NULL DEFAULT 0,
  indicators_success    INT         NOT NULL DEFAULT 0,
  indicators_failed     INT         NOT NULL DEFAULT 0,
  snapshots_written     INT         NOT NULL DEFAULT 0,
  error_summary         TEXT,
  duration_ms           INT
);

CREATE INDEX ingest_runs_run_at
  ON public.ingest_runs (run_at DESC);
