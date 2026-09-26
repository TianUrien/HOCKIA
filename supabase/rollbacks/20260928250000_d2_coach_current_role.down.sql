-- ROLLBACK for 20260928250000_d2_coach_current_role.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- DATA LOSS: coach_current_role values are dropped. Dump them first:
--   psql "$DB_URL" -c "\copy (SELECT id, coach_current_role FROM public.profiles WHERE coach_current_role IS NOT NULL) TO 'coach_current_role.csv' CSV HEADER"
-- profiles_self is rebuilt from its current columns minus coach_current_role
-- (a view column can't be dropped with CREATE OR REPLACE, so it is recreated).
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20260928250000 --linked

DO $view$
DECLARE
  v_cols text;
  v_grants text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO v_cols
    FROM pg_attribute
   WHERE attrelid = 'public.profiles_self'::regclass AND attnum > 0 AND NOT attisdropped
     AND attname <> 'coach_current_role';
  -- Keep the view's grants across the drop / create.
  SELECT string_agg(format('GRANT %s ON public.profiles_self TO %I', privilege_type, grantee), '; ')
    INTO v_grants
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'profiles_self';
  EXECUTE 'DROP VIEW public.profiles_self';
  EXECUTE format(
    'CREATE VIEW public.profiles_self WITH (security_barrier = true, security_invoker = true) AS '
    'SELECT %s FROM public.profiles WHERE id = (SELECT auth.uid())',
    v_cols);
  IF v_grants IS NOT NULL THEN EXECUTE v_grants; END IF;
END
$view$;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_coach_current_role_length;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS coach_current_role;
