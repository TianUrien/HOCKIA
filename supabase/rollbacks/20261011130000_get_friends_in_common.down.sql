-- ROLLBACK for 20261011130000_get_friends_in_common.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20261011130000 --linked
--
-- Drops the function (created by the migration). The preview falls back to
-- the per-member friends-in-common read.

DROP FUNCTION IF EXISTS public.get_friends_in_common(uuid[]);
