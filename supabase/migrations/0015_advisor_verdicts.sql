-- 0015: advisor_verdicts — daily persisted advisor verdicts.
--
-- Verdict history part 1/3 (advisor pivot follow-up, 2026-07-08).
-- The advisor engine (src/lib/advisor/) currently computes verdicts
-- on READ only; nothing records what the verdict WAS, so there is no
-- "판정이 언제 할인→전환으로 바뀌었나" timeline, no flip detection,
-- and no future hit-rate measurement ("할인 판정 후 3개월 수익률").
-- This table stores one row per (asset_type, verdict_date,
-- engine_version), written by a cron tail (part 2) after the daily
-- technical ingest so the row reflects the day's final price bar.
--
-- Design notes:
-- - `engine_version` mirrors the model_version discipline on every
--   other reading table: verdicts from different rule-sets never
--   collide, and readers tiebreak newest-version-wins (the same
--   cutover lesson as 34df3e6 / 90ff598).
-- - `label` is TEXT with a CHECK, not an enum type: adding a verdict
--   label should be an additive CHECK swap, not an enum migration
--   (same rationale as signal_events.state in 0006).
-- - `evidence` JSONB holds the full serialized verdict (pillars,
--   evidence sentences, drawdown state) for forensics/UI; the scalar
--   columns exist so timeline/flip queries never parse JSONB.
-- - Writes: service-role only (cron), no INSERT/UPDATE policy —
--   consistent with every other reading table (0002 §form).

CREATE TABLE public.advisor_verdicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type public.asset_type_enum NOT NULL,
  verdict_date date NOT NULL,
  engine_version text NOT NULL,
  label text NOT NULL
    CHECK (label IN (
      'insufficient_data',
      'no_drawdown',
      'healthy_pullback',
      'discount_zone',
      'mixed_signals',
      'reversal_risk'
    )),
  net_score numeric,
  confidence numeric NOT NULL,
  drawdown_pct numeric,
  peak_date date,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX advisor_verdicts_dedup
  ON public.advisor_verdicts (asset_type, verdict_date, engine_version);

-- Timeline reads: latest-N-days per asset.
CREATE INDEX advisor_verdicts_asset_date
  ON public.advisor_verdicts (asset_type, verdict_date DESC);

ALTER TABLE public.advisor_verdicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "family read all advisor_verdicts"
  ON public.advisor_verdicts
  FOR SELECT
  TO authenticated
  USING (true);
