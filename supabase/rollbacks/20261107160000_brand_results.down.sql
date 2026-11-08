-- Rollback for 20261107160000_brand_results.sql: the function is new.
DROP FUNCTION IF EXISTS public.get_my_brand_results(integer);
NOTIFY pgrst, 'reload schema';
