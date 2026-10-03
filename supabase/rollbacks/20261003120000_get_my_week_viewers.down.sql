-- ROLLBACK for 20261003120000_get_my_week_viewers.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20261003120000 --linked
--
-- The migration only added one new function; nothing existing was changed,
-- so the rollback is the drop. The client falls back to an empty
-- "Who looked at you" section when the RPC is missing.

DROP FUNCTION IF EXISTS public.get_my_week_viewers(integer);

NOTIFY pgrst, 'reload schema';
