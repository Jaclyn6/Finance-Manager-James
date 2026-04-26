-- Phase 3.4 Step 3 — backtest schema (3 tables).
--
-- Reference: docs/phase3_4_backtest_blueprint.md §2.4 + §3.1
--
-- Schema design (hybrid 2-table + user_weights per §8 gate decisions):
--
-- 1. `user_weights` — named custom EngineWeights snapshots saved by
--    the tuning slider panel (Step 7). One row per (user, name); the
--    JSONB `payload` carries the full EngineWeights shape so a
--    backtest run can reference it via `weights_version` =
--    `'custom-{id}'`.
--
-- 2. `backtest_runs` — one row per backtest request. Memoization key
--    is `(request_hash, user_id)` so two users running the same
--    request still get separate rows (RLS family-shared reads, but
--    each user owns their own runs). Summary stats are normalized
--    columns so the dashboard "my recent backtests" reader can
--    SELECT without unpacking JSONB.
--
-- 3. `backtest_snapshots` — one row per (run, date). Per-day analytics
--    detail. Foreign-key cascade-delete from backtest_runs so deleting
--    a run cleans up its detail rows automatically.
--
-- Capacity (Supabase Free 500 MB DB ceiling):
--   30 backtests/month × 60 trading days = 1,830 detail + 30 meta rows/mo.
--   Annual ~24 MB → 5% of free-tier ceiling. No squeeze.
--
-- RLS policy:
--   - All three tables: family members READ all rows (`auth.role() =
--     'authenticated'`). Backtest data isn't sensitive within the
--     family — sharing the "what-if" view is the whole point of OOS
--     #2 being brought into scope.
--   - `backtest_runs` + `user_weights` write/delete are owner-only
--     (`user_id = auth.uid()`).
--   - `backtest_snapshots` has NO user-side INSERT policy — the API
--     route writes via the service-role admin client transactionally
--     with the parent run.

------------------------------------------------------------------------
-- 1. user_weights — named custom weight snapshots
------------------------------------------------------------------------

CREATE TABLE public.user_weights (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  payload         JSONB NOT NULL,         -- full EngineWeights snapshot
  description_ko  TEXT,                   -- optional user-supplied note
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One name per user — same name overwrites (UPSERT).
CREATE UNIQUE INDEX user_weights_user_name_idx
  ON public.user_weights (user_id, name);

CREATE INDEX user_weights_user_recent_idx
  ON public.user_weights (user_id, created_at DESC);

ALTER TABLE public.user_weights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "family read all user_weights"
  ON public.user_weights FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "owner write own user_weights"
  ON public.user_weights FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "owner update own user_weights"
  ON public.user_weights FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "owner delete own user_weights"
  ON public.user_weights FOR DELETE
  USING (user_id = auth.uid());

------------------------------------------------------------------------
-- 2. backtest_runs — one row per request (memoization + summary)
------------------------------------------------------------------------

CREATE TABLE public.backtest_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Memoization key: sha256(canonical(request)) so identical requests
  -- map to the same row per user.
  request_hash          TEXT NOT NULL,
  request_json          JSONB NOT NULL,

  -- Normalized summary columns (analytics-friendly).
  asset_type            asset_type_enum NOT NULL,
  date_from             DATE NOT NULL,
  date_to               DATE NOT NULL,
  model_version         TEXT NOT NULL,
  weights_version       TEXT NOT NULL,
  -- Optional ref to user_weights — populated when weights_version
  -- is 'custom-{id}'. NULL for built-in registry versions.
  user_weights_id       UUID REFERENCES public.user_weights(id) ON DELETE SET NULL,

  total_days            INT NOT NULL,
  days_with_replay      INT NOT NULL,
  days_missing_inputs   INT NOT NULL,
  avg_abs_delta         NUMERIC(6,3),
  max_abs_delta         NUMERIC(6,3),
  days_above_5pp        INT NOT NULL,
  duration_ms           INT NOT NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX backtest_runs_hash_user_idx
  ON public.backtest_runs (request_hash, user_id);

CREATE INDEX backtest_runs_user_recent_idx
  ON public.backtest_runs (user_id, created_at DESC);

CREATE INDEX backtest_runs_asset_recent_idx
  ON public.backtest_runs (asset_type, created_at DESC);

ALTER TABLE public.backtest_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "family read all backtest_runs"
  ON public.backtest_runs FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "owner write own backtest_runs"
  ON public.backtest_runs FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "owner delete own backtest_runs"
  ON public.backtest_runs FOR DELETE
  USING (user_id = auth.uid());

------------------------------------------------------------------------
-- 3. backtest_snapshots — one row per (run, date) for analytics detail
------------------------------------------------------------------------

CREATE TABLE public.backtest_snapshots (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                  UUID NOT NULL REFERENCES public.backtest_runs(id) ON DELETE CASCADE,
  snapshot_date           DATE NOT NULL,

  replay_score            NUMERIC(6,3),
  replay_band             TEXT,
  original_score          NUMERIC(6,3),
  original_model_version  TEXT,
  delta                   NUMERIC(6,3),

  -- Per-category breakdown of the replay weighting (for the deviation
  -- table's "어느 카테고리에서 차이가 났는가" drill-down).
  contributing            JSONB,
  -- Optional replay signals (compact form).
  signal_state            JSONB,
  -- Loud-failure surface for missing categories / inputs.
  gaps                    TEXT[]
);

CREATE UNIQUE INDEX backtest_snapshots_run_date_idx
  ON public.backtest_snapshots (run_id, snapshot_date);

CREATE INDEX backtest_snapshots_date_idx
  ON public.backtest_snapshots (snapshot_date);

ALTER TABLE public.backtest_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "family read all backtest_snapshots"
  ON public.backtest_snapshots FOR SELECT
  USING (auth.role() = 'authenticated');

-- No user-side INSERT/UPDATE/DELETE — service-role admin client only,
-- transactional with parent backtest_runs row.

------------------------------------------------------------------------
-- Comments for Supabase Studio / future maintainers
------------------------------------------------------------------------

COMMENT ON TABLE public.user_weights IS
  'Phase 3.4 — named custom EngineWeights snapshots (tuning slider).';

COMMENT ON TABLE public.backtest_runs IS
  'Phase 3.4 — one row per backtest request. request_hash is the memoization key; family RLS allows shared reads.';

COMMENT ON TABLE public.backtest_snapshots IS
  'Phase 3.4 — per-day replay results. Service-role-only writes, transactional with backtest_runs.';
