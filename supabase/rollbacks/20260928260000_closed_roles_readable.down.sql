-- ROLLBACK for 20260928260000_closed_roles_readable.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- No data is touched: it removes one read policy and its helper.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20260928260000 --linked

DROP POLICY IF EXISTS "Members can view closed opportunities" ON public.opportunities;
DROP FUNCTION IF EXISTS public.member_can_view_closed_opportunity(uuid);
