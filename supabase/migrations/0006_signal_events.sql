-- Phase 2 Signal Alignment engine output table (blueprint §4.5, §8.2).
-- Populated by `src/lib/score-engine/signals.ts` (Step 7.5) after every ingest
-- path whose inputs touch any of the 6 signals defined in PRD §10.4.
--
-- Composite PK `(snapshot_date, signal_rules_version)` choice — two
-- distinct semantics are layered on this PK:
--
--   (a) Cross-version immutability: tuning threshold values requires a
--       SIGNAL_RULES_VERSION bump (e.g. v1.0.0 → v1.1.0), which creates
--       a PARALLEL row for the same date rather than mutating the old
--       evaluation's row. The old evaluation's (snapshot_date, old
--       version) row remains untouched — auditable history of "what
--       did we see under v1.0.0 rules?" mirrors the MODEL_VERSION
--       discipline on `composite_snapshots`. SIGNAL_RULES_VERSION is
--       intentionally independent from MODEL_VERSION (blueprint §2.3,
--       §4.5) because threshold tuning cadence differs from composite
--       weight tuning.
--
--   (b) Within-version idempotent overwrite: per blueprint §7.3
--       ("Idempotency — Multiple daily invocations on the same date
--       overwrite each other deterministically — the last computed
--       state wins"), multiple crons in the same day under the same
--       SIGNAL_RULES_VERSION upsert the row via ON CONFLICT DO UPDATE.
--       This is NOT snapshot immutability — within a (snapshot_date,
--       signal_rules_version) pair the row is last-write-wins, which is
--       acceptable because signal inputs only change hourly at most
--       and the last run reflects the latest ingestion state.
--
-- 0007 RLS enforces this split: service_role INSERT + UPDATE are both
-- granted (0007 `service_role_write_signal_events` +
-- `service_role_update_signal_events`) to enable (b); no UPDATE
-- vector exists that crosses version boundaries (a).

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
