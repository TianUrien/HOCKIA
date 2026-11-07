-- Rollback for 20261107170000_brand_partnerships.sql: everything here is new.
-- Dropping the table deletes players' partnership choices; export it first if needed.
DROP FUNCTION IF EXISTS public.get_ambassador_candidates(integer);
DROP FUNCTION IF EXISTS public.set_my_brand_partnership(boolean, boolean, text, integer);
DROP FUNCTION IF EXISTS public.get_my_brand_partnership();
DROP TABLE IF EXISTS public.brand_partnership_prefs;
NOTIFY pgrst, 'reload schema';
