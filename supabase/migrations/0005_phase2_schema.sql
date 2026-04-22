-- Phase 2 reading tables: technical, on-chain, news sentiment, price history.
-- Mirrors Phase 1 `indicator_readings` metadata convention (source_name, model_version,
-- fetch_status, raw_payload) so the Phase 1 staleness / error-path logic extends
-- uniformly across all new data streams. RLS policies live in 0007.
--
-- Invariant (blueprint §2.2 tenet 2, snapshot immutability): every reading row is
-- stamped with `model_version` and is write-once per (natural-key, model_version).
-- Corrections happen via MODEL_VERSION bump, not in-place UPDATE.
--
-- Exception: `price_readings` has no `model_version` — it's visualization-only
-- (PRD §8.5 line 188, blueprint §7.4 "Price history — visualization-only invariant")
-- and re-fetches overwrite bars. The §7.4 invariant also forbids imports from
-- `@/lib/data/prices` inside `src/lib/score-engine/**`.

-- ============================================================
-- technical_readings
-- Local RSI/MACD/MA/Bollinger/Disparity derivations from Alpha Vantage daily bars.
-- One row per (ticker, indicator_key, observed_at, model_version).
-- ============================================================

CREATE TABLE public.technical_readings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker           TEXT        NOT NULL,
  indicator_key    TEXT        NOT NULL,    -- 'RSI_14', 'MACD_12_26_9', 'MA_50', 'MA_200', 'BB_20_2', 'DISPARITY'
  asset_type       public.asset_type_enum NOT NULL,
  value_raw        NUMERIC,
  value_normalized NUMERIC,
  score_0_100      NUMERIC,
  observed_at      DATE        NOT NULL,    -- daily bar date
  ingested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_name      TEXT        NOT NULL,    -- 'alpha_vantage' (ingestion source)
  model_version    TEXT        NOT NULL,
  fetch_status     public.fetch_status_enum NOT NULL DEFAULT 'success',
  raw_payload      JSONB
);

CREATE UNIQUE INDEX technical_readings_dedup
  ON public.technical_readings (ticker, indicator_key, observed_at, model_version);

CREATE INDEX technical_readings_ticker_obs
  ON public.technical_readings (ticker, observed_at DESC);

-- ============================================================
-- onchain_readings
-- Bitbo (MVRV_Z, SOPR), CoinGlass (BTC_ETF_NETFLOW), alternative.me (CRYPTO_FG).
--
-- CNN_FG placement: blueprint §5 routing table left the CNN F&G destination
-- "TBD at Step 2" (onchain_readings vs news_sentiment). Step 1 DDL resolves
-- it here as a practical convenience — CNN F&G is hourly-refresh like the
-- on-chain sources, and the row shape (single `score_0_100` number per day,
-- no ticker, no article_count) matches `onchain_readings` more closely than
-- `news_sentiment`. CNN F&G is NOT an on-chain category score input
-- (blueprint §4.1 classifies it as a Sentiment modifier); it is a
-- cross-category signal input consumed by `EXTREME_FEAR` in the signal
-- engine (blueprint §4.5). Readers must route CNN_FG rows to the sentiment
-- category aggregator + the signal engine, not the on-chain aggregator.
-- ============================================================

CREATE TABLE public.onchain_readings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator_key    TEXT        NOT NULL,    -- 'MVRV_Z', 'SOPR', 'BTC_ETF_NETFLOW', 'CRYPTO_FG', 'CNN_FG'
  asset_type       public.asset_type_enum NOT NULL,
  value_raw        NUMERIC,
  value_normalized NUMERIC,
  score_0_100      NUMERIC,
  observed_at      DATE        NOT NULL,
  ingested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_name      TEXT        NOT NULL,    -- 'bitbo' | 'coinglass' | 'alternative_me' | 'cnn'
  model_version    TEXT        NOT NULL,
  fetch_status     public.fetch_status_enum NOT NULL DEFAULT 'success',
  raw_payload      JSONB
);

CREATE UNIQUE INDEX onchain_readings_dedup
  ON public.onchain_readings (indicator_key, observed_at, model_version);

-- ============================================================
-- news_sentiment
-- Finnhub per-ticker sentiment aggregations. `ticker` is nullable so
-- category-level summaries can coexist with per-ticker rows.
-- The unique index uses COALESCE(ticker, '') because Postgres treats
-- NULLs as distinct in plain unique indexes — a functional index over
-- COALESCE gives us the "one row per (asset_type, ticker-or-category,
-- observed_at, model_version)" guarantee we want.
-- ============================================================

CREATE TABLE public.news_sentiment (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type       public.asset_type_enum NOT NULL,
  ticker           TEXT,                       -- nullable for category-level summaries
  score_0_100      NUMERIC     NOT NULL,       -- normalized sentiment 0 (bearish) - 100 (bullish)
  article_count    INT         NOT NULL DEFAULT 0,
  observed_at      DATE        NOT NULL,
  ingested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_name      TEXT        NOT NULL,       -- 'finnhub'
  model_version    TEXT        NOT NULL,
  fetch_status     public.fetch_status_enum NOT NULL DEFAULT 'success',
  raw_payload      JSONB
);

CREATE UNIQUE INDEX news_sentiment_dedup
  ON public.news_sentiment (asset_type, COALESCE(ticker, ''), observed_at, model_version);

-- ============================================================
-- price_readings
-- Daily OHLCV bars for chart rendering. Visualization-only (PRD §8.5 line 188);
-- not an input to the composite score. Hence no model_version column.
-- Re-fetches overwrite — no snapshot immutability constraint.
-- ============================================================

CREATE TABLE public.price_readings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker           TEXT        NOT NULL,
  asset_type       public.asset_type_enum NOT NULL,
  price_date       DATE        NOT NULL,
  close            NUMERIC     NOT NULL,
  open             NUMERIC,
  high             NUMERIC,
  low              NUMERIC,
  volume           NUMERIC,
  source_name      TEXT        NOT NULL,       -- 'alpha_vantage' | 'coingecko'
  ingested_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX price_readings_dedup
  ON public.price_readings (ticker, price_date);

CREATE INDEX price_readings_ticker_date
  ON public.price_readings (ticker, price_date DESC);
