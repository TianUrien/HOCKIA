-- Phase 3d: extend opportunity_gender enum with hockey-category values.
-- Backwards-compatible — existing 'Men'/'Women' rows untouched and continue
-- to render as "Adult Men"/"Adult Women" in the UI.
--
-- Per Postgres docs, ALTER TYPE ... ADD VALUE cannot run inside a
-- transaction with usage of the new value, but the Supabase migration
-- runner commits each statement; subsequent statements can use the values.
--
-- Tested values: Adult Men → 'Men' (legacy), Adult Women → 'Women' (legacy),
-- Girls / Boys / Mixed → new enum members.

ALTER TYPE public.opportunity_gender ADD VALUE IF NOT EXISTS 'Girls';
ALTER TYPE public.opportunity_gender ADD VALUE IF NOT EXISTS 'Boys';
ALTER TYPE public.opportunity_gender ADD VALUE IF NOT EXISTS 'Mixed';
