-- Phase 3.1 Step 2 review fix-up — disambiguate the ecos_readings UNIQUE
-- index sentinel.
--
-- 0013 used COALESCE(item_code, '_') to collapse NULL item_codes into a
-- single key bucket. Live-verified ECOS item codes are numeric strings
-- ('0101000', '0000001', '0', '000000', etc.), so '_' is currently
-- impossible — but a future series with ITEM_CODE1='_' would silently
-- collide with the null-sentinel and be dropped by ON CONFLICT DO
-- NOTHING. Swap to the empty string and add a CHECK constraint that
-- ECOS by spec cannot violate, making the invariant enforced rather
-- than implicit.

-- Drop the old index, recreate with the empty-string sentinel.
DROP INDEX IF EXISTS public.ecos_readings_series_item_observed_idx;

CREATE UNIQUE INDEX ecos_readings_series_item_observed_idx
  ON public.ecos_readings (series_code, COALESCE(item_code, ''), observed_at);

-- ECOS ITEM_CODE1 is always a non-empty string when present (numeric
-- key from the upstream catalog). Reject empty-string item_code so the
-- sentinel can never collide with real data.
ALTER TABLE public.ecos_readings
  ADD CONSTRAINT ecos_readings_item_code_nonempty
  CHECK (item_code IS NULL OR item_code <> '');
