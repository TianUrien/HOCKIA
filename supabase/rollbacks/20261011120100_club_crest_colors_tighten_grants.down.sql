-- ROLLBACK for 20261011120100_club_crest_colors_tighten_grants.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20261011120100 --linked
--
-- Restores the default-privilege grants the table had before (RLS still guards rows).

GRANT ALL ON public.club_crest_colors TO anon, authenticated;
