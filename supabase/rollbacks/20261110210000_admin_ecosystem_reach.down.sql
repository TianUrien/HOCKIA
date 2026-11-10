-- Rollback for 20261110210000_admin_ecosystem_reach.sql: the function is new,
-- so rolling back removes it. The admin page shows its error state without it.
DROP FUNCTION IF EXISTS public.admin_get_ecosystem_reach(integer);
