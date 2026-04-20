-- ============================================================================
-- rename_xe_to_gb_eng  (staging-only, 2026-04-20 01:28:18 UTC)
-- ============================================================================
-- STAGING-APPLIED version. Staging had only ONE England row (id=202, code='XE',
-- code_alpha3='XEN'). This migration simply renames it to the ISO 3166-2
-- alpha code 'GB-ENG' / 'ENG' — no FK migration needed because there was no
-- second GB-ENG row to merge into.
--
-- Production had TWO England rows (legacy id=207 'XE' and id=202 'GB-ENG') and
-- needed a proper merge, handled by 20260420011956_consolidate_england_xe_into_gb_eng.sql.
--
-- Do NOT use this version for fresh database initialisation — if no XE row
-- exists, this UPDATE becomes a no-op, leaving the DB in whatever state it
-- already had.
--
-- Tracked in git solely for audit parity with staging's
-- supabase_migrations.schema_migrations table; the migration is already
-- applied on staging and is marked as applied on production via repair.
-- ============================================================================

UPDATE public.countries
SET code = 'GB-ENG',
    code_alpha3 = 'ENG'
WHERE code = 'XE';
