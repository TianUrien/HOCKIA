-- Rollback for 20261015170000_admin_activity_series.sql: the function is new,
-- nothing else depends on it.
DROP FUNCTION IF EXISTS public.admin_get_activity_series(integer);
