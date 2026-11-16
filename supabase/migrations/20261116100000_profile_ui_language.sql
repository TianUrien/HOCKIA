-- Interface language preference (Spanish localization, Stage 0; founder
-- go-ahead 2026-11-16, plan in docs/engineering/spanish-localization-plan.md).
--
-- Why: the app is getting a Spanish interface. The server writes emails and
-- push notifications while the member is away, so it needs to know which
-- language the member chose. The same column is the gate that keeps Spanish
-- server text away from members who never opted in.
--
-- 1. profiles.ui_language (nullable text). NULL = no choice made: the app
--    follows its own default (English today) and the server writes English.
--    Allowed values: 'en', 'es'. Every existing profile stays NULL.
-- 2. Column grants (profiles uses column-level grants since 20260707180000):
--    SELECT, INSERT and UPDATE to authenticated only. It is not granted to
--    anon: nothing public needs it. Row access is still RLS, so a member can
--    only write their own row.
-- 3. profiles_self (the owner's own-row view) gets the column, as every new
--    profiles column does (pattern from 20261023130000).
--
-- Not breaking: one nullable column, no RPC changes; no client reads or
-- writes it yet, and installed store builds never will.
--
-- Rollback: supabase/rollbacks/20261116100000_profile_ui_language.down.sql

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ui_language text;

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_ui_language_check') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_ui_language_check CHECK (ui_language IS NULL OR ui_language IN ('en', 'es'));
  END IF;
END
$check$;

COMMENT ON COLUMN public.profiles.ui_language IS
  'Interface language the member chose (''en'' or ''es''). NULL = no choice: app default, server text in English.';

GRANT SELECT (ui_language) ON public.profiles TO authenticated;
GRANT INSERT (ui_language), UPDATE (ui_language) ON public.profiles TO authenticated;

DO $view$
DECLARE
  v_cols text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.profiles_self'::regclass
                AND attname = 'ui_language' AND NOT attisdropped) THEN
    RETURN;
  END IF;
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO v_cols
    FROM pg_attribute
   WHERE attrelid = 'public.profiles_self'::regclass AND attnum > 0 AND NOT attisdropped;
  EXECUTE format(
    'CREATE OR REPLACE VIEW public.profiles_self WITH (security_barrier = true, security_invoker = true) AS '
    'SELECT %s, ui_language FROM public.profiles WHERE id = (SELECT auth.uid())',
    v_cols);
END
$view$;
