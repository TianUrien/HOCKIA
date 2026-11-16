-- Rollback for 20261116100000_profile_ui_language.sql.
-- Roll the client back first if a released build reads or writes
-- ui_language (PostgREST select lists or updates naming the column would
-- 400). Members' saved language choices are lost.
-- 1. profiles_self without ui_language (recreated; grants kept).
-- 2. Drop the grants, the check and the column.

DO $view$
DECLARE
  v_cols text;
  v_grants text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO v_cols
    FROM pg_attribute
   WHERE attrelid = 'public.profiles_self'::regclass AND attnum > 0 AND NOT attisdropped
     AND attname <> 'ui_language';
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

REVOKE SELECT (ui_language), INSERT (ui_language), UPDATE (ui_language) ON public.profiles FROM authenticated;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_ui_language_check;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS ui_language;
