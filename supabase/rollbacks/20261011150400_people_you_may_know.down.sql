-- ROLLBACK for 20261011150400_people_you_may_know.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20261011150400 --linked
DROP FUNCTION IF EXISTS public.get_people_you_may_know(integer);
