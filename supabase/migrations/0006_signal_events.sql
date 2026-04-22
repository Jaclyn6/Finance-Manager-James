-- Phase 2 Signal Alignment engine output table (blueprint §4.5, §8.2).
-- Populated by `src/lib/score-engine/signals.ts` (Step 7.5) after every ingest
-- path whose inputs touch any of the 6 signals defined in PRD §10.4.
--
-- Composite PK `(snapshot_date, signal_rules_version)` choice:
--   Snapshot immutability (blueprint §2.2 tenet 2, §4.5) — a given
--   calendar day's signal evaluation under a given rules version is
--   immutable. Tuning threshold values requires a SIGNAL_RULES_VERSION
--   bump (e.g. v1.0.0 → v1.1.0), which creates a parallel row for the
--   same date rather than overwriting the old evaluation. This keeps
--   the historical "what did we see?" auditable even as thresholds
--   evolve — mirroring the MODEL_VERSION discipline on
--   `composite_snapshots`. SIGNAL_RULES_VERSION is intentionally
--   independent from MODEL_VERSION (blueprint §2.3, §4.5) because the
--   threshold tuning cadence differs from composite weight tuning.
--
-- UPDATE policy (0007 RLS): the writer may upsert with ON CONFLICT
-- DO UPDATE within a single (snapshot_date, signal_rules_version) when
-- re-running a cron for the same day (e.g. technical cron finishes
-- after macro cron and the signal re-eval needs to land). This is the
-- one permitted UPDATE vector; other corrections require a version
-- bump.

CREATE TABLE public.signal_events (
  snapshot_date         DATE        NOT NULL,
  signal_rules_version  TEXT        NOT NULL,
  active_signals        JSONB       NOT NULL,  -- ["EXTREME_FEAR", "LIQUIDITY_EASING", ...]
  alignment_count       INT         NOT NULL,  -- len(active_signals), cached for index-friendly queries
  per_signal_detail     JSONB       NOT NULL,  -- per-signal inputs, threshold, on/off/unknown state
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_date, signal_rules_version)
);

CREATE INDEX signal_events_date
  ON public.signal_events (snapshot_date DESC);
