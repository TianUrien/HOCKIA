-- ROLLBACK for 20261011110000_get_member_photos.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20261011110000 --linked
--
-- Drops get_member_photos (created by the migration; nothing existed before it).
-- Clients then fall back to the single avatar.

DROP FUNCTION IF EXISTS public.get_member_photos(uuid[], integer);
