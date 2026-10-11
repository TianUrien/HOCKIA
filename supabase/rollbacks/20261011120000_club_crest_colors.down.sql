-- ROLLBACK for 20261011120000_club_crest_colors.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20261011120000 --linked
--
-- Drops the table (created by the migration; nothing existed before it).
-- Club cards then work the colour out on the phone, else use brand purple.

DROP TABLE IF EXISTS public.club_crest_colors;
