-- Rename the asset_type enum value 'btc' → 'crypto' so the asset class
-- can cover the broader cryptocurrency market (BTC + ETH + majors)
-- rather than being artificially narrowed to Bitcoin. The PRD has
-- always spoken in terms of "BTC/ETH" for this category; the schema
-- should match that intent.
--
-- Safe to run at this point in Phase 1: no rows exist in any table
-- that uses this enum (the ingest cron has not yet been implemented).

ALTER TYPE public.asset_type_enum RENAME VALUE 'btc' TO 'crypto';
