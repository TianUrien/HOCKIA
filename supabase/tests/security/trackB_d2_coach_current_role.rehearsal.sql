-- Rehearsal for 20260928250000_d2_coach_current_role.sql (and its rollback file).
-- Run on STAGING only (the coach fixture is the E2E coach there). Applies the
-- migration's statements, checks them, runs the rollback's statements, and ends
-- by raising 'REHEARSAL RESULTS' — the whole statement rolls back, nothing kept.
-- Result 2026-09-26 on staging: 8/8 PASS; staging unchanged afterwards
-- (profiles_self 106 columns, same column-order md5, no coach_current_role).
DO $rehearsal$
DECLARE
  c_coach constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';
  v_out text := '';
  v_cols text;
  v_before_md5 text;
  v_before_n int;
  v_after_n int;
  v_prefix_md5 text;
  v_last text;
  v_max_before timestamptz;
  v_max_after timestamptz;
  v_val text;
  v_ok boolean;
  v_grants text;
BEGIN
  SELECT md5(string_agg(attname, ',' ORDER BY attnum)), count(*) INTO v_before_md5, v_before_n
    FROM pg_attribute WHERE attrelid='public.profiles_self'::regclass AND attnum>0 AND NOT attisdropped;
  SELECT max(updated_at) INTO v_max_before FROM public.profiles;

  -- migration 20260928250000
  EXECUTE 'ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS coach_current_role text';
  EXECUTE 'ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_coach_current_role_length';
  EXECUTE 'ALTER TABLE public.profiles ADD CONSTRAINT profiles_coach_current_role_length CHECK (coach_current_role IS NULL OR char_length(btrim(coach_current_role)) BETWEEN 1 AND 60)';
  EXECUTE 'GRANT SELECT (coach_current_role) ON public.profiles TO anon, authenticated';
  EXECUTE 'GRANT INSERT (coach_current_role), UPDATE (coach_current_role) ON public.profiles TO authenticated';
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.profiles_self'::regclass AND attname='coach_current_role' AND NOT attisdropped) THEN
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO v_cols
      FROM pg_attribute WHERE attrelid='public.profiles_self'::regclass AND attnum>0 AND NOT attisdropped;
    EXECUTE format('CREATE OR REPLACE VIEW public.profiles_self WITH (security_barrier = true, security_invoker = true) AS SELECT %s, coach_current_role FROM public.profiles WHERE id = (SELECT auth.uid())', v_cols);
  END IF;

  SELECT max(updated_at) INTO v_max_after FROM public.profiles;
  v_out := v_out || format(E'1 no profile row touched: %s\n', CASE WHEN v_max_before IS NOT DISTINCT FROM v_max_after THEN 'PASS' ELSE 'FAIL' END);
  SELECT count(*) INTO v_after_n FROM pg_attribute WHERE attrelid='public.profiles_self'::regclass AND attnum>0 AND NOT attisdropped;
  SELECT md5(string_agg(attname, ',' ORDER BY attnum)) INTO v_prefix_md5 FROM pg_attribute WHERE attrelid='public.profiles_self'::regclass AND attnum>0 AND attnum<=v_before_n AND NOT attisdropped;
  SELECT attname INTO v_last FROM pg_attribute WHERE attrelid='public.profiles_self'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum DESC LIMIT 1;
  v_out := v_out || format(E'2 profiles_self %s→%s cols, existing order kept, new col last: %s\n', v_before_n, v_after_n, CASE WHEN v_after_n=v_before_n+1 AND v_prefix_md5=v_before_md5 AND v_last='coach_current_role' THEN 'PASS' ELSE 'FAIL' END);
  v_out := v_out || format(E'3 grants (anon read, members write, anon no write): %s\n',
    CASE WHEN has_column_privilege('anon','public.profiles','coach_current_role','SELECT') AND has_column_privilege('authenticated','public.profiles','coach_current_role','UPDATE') AND NOT has_column_privilege('anon','public.profiles','coach_current_role','UPDATE') THEN 'PASS' ELSE 'FAIL' END);
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_coach, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE public.profiles SET coach_current_role = 'Head coach, U21 women' WHERE id = c_coach;
    SELECT coach_current_role INTO v_val FROM public.profiles_self;
    EXECUTE 'RESET ROLE';
    v_out := v_out || format(E'4 coach writes own role, reads it via profiles_self: %s\n', CASE WHEN v_val='Head coach, U21 women' THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'undo-4';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'undo-4' THEN v_out := v_out || format(E'4 FAIL %s\n', SQLERRM); END IF;
  END;
  EXECUTE 'RESET ROLE';
  v_ok := false;
  BEGIN UPDATE public.profiles SET coach_current_role = repeat('x', 61) WHERE id = c_coach; EXCEPTION WHEN check_violation THEN v_ok := true; END;
  v_out := v_out || format(E'5a 61 chars rejected: %s\n', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END);
  v_ok := false;
  BEGIN UPDATE public.profiles SET coach_current_role = '   ' WHERE id = c_coach; EXCEPTION WHEN check_violation THEN v_ok := true; END;
  v_out := v_out || format(E'5b blank rejected: %s\n', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END);
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    SELECT coach_current_role INTO v_val FROM public.profiles WHERE id = c_coach;
    EXECUTE 'RESET ROLE';
    v_out := v_out || E'6 anon can select coach_current_role: PASS\n';
  EXCEPTION WHEN insufficient_privilege THEN EXECUTE 'RESET ROLE'; v_out := v_out || E'6 anon select: FAIL\n';
  END;

  -- rollback file supabase/rollbacks/20260928250000_d2_coach_current_role.down.sql
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO v_cols
    FROM pg_attribute WHERE attrelid='public.profiles_self'::regclass AND attnum>0 AND NOT attisdropped AND attname <> 'coach_current_role';
  SELECT string_agg(format('GRANT %s ON public.profiles_self TO %I', privilege_type, grantee), '; ') INTO v_grants
    FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='profiles_self';
  EXECUTE 'DROP VIEW public.profiles_self';
  EXECUTE format('CREATE VIEW public.profiles_self WITH (security_barrier = true, security_invoker = true) AS SELECT %s FROM public.profiles WHERE id = (SELECT auth.uid())', v_cols);
  IF v_grants IS NOT NULL THEN EXECUTE v_grants; END IF;
  EXECUTE 'ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_coach_current_role_length';
  EXECUTE 'ALTER TABLE public.profiles DROP COLUMN IF EXISTS coach_current_role';
  SELECT md5(string_agg(attname, ',' ORDER BY attnum)) INTO v_prefix_md5 FROM pg_attribute WHERE attrelid='public.profiles_self'::regclass AND attnum>0 AND NOT attisdropped;
  v_out := v_out || format(E'7 rollback restores profiles_self exactly, grants kept: %s\n',
    CASE WHEN v_prefix_md5 = v_before_md5 AND has_table_privilege('authenticated','public.profiles_self','SELECT') AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.profiles'::regclass AND attname='coach_current_role' AND NOT attisdropped) THEN 'PASS' ELSE 'FAIL' END);
  RAISE EXCEPTION E'REHEARSAL RESULTS (rolled back)\n%', v_out;
END
$rehearsal$;
