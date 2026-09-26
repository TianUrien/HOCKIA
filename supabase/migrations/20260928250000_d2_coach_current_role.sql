-- =========================================================================
-- D2 · 30-second profile — coach "Current role" key fact
-- =========================================================================
-- Founder ruling 2026-09-26: the coach key facts show the coach's current
-- role ("Head coach, U21 women"). New nullable column on profiles, set by the
-- coach in Edit profile. The tile falls back to the current club, then
-- "Not given" / "Not set".
--
--   * ADD COLUMN without a default: metadata-only, no table rewrite, no UPDATE
--     on profiles, no trigger fires.
--   * CHECK: trimmed length 1..60 when set (empty strings are saved as NULL by
--     the client).
--   * profiles uses column-level grants: anon + authenticated read it (it is
--     public profile content, like coach_specialization); members write their
--     own row through the existing RLS.
--   * profiles_self exposes it, appended after the view's existing columns
--     (column order differs between environments — same pattern as
--     20260926120000_full_match_privacy.sql).
-- Rollback: supabase/rollbacks/20260928250000_d2_coach_current_role.down.sql
-- =========================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS coach_current_role text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_coach_current_role_length;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_coach_current_role_length
  CHECK (coach_current_role IS NULL OR char_length(btrim(coach_current_role)) BETWEEN 1 AND 60);

COMMENT ON COLUMN public.profiles.coach_current_role IS
  'D2: the coach''s current role as they describe it ("Head coach, U21 women"). Shown on the coach key facts; max 60 characters.';

GRANT SELECT (coach_current_role) ON public.profiles TO anon, authenticated;
GRANT INSERT (coach_current_role), UPDATE (coach_current_role) ON public.profiles TO authenticated;

DO $view$
DECLARE
  v_cols text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.profiles_self'::regclass
                AND attname = 'coach_current_role' AND NOT attisdropped) THEN
    RETURN;
  END IF;
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO v_cols
    FROM pg_attribute
   WHERE attrelid = 'public.profiles_self'::regclass AND attnum > 0 AND NOT attisdropped;
  EXECUTE format(
    'CREATE OR REPLACE VIEW public.profiles_self WITH (security_barrier = true, security_invoker = true) AS '
    'SELECT %s, coach_current_role FROM public.profiles WHERE id = (SELECT auth.uid())',
    v_cols);
END
$view$;
