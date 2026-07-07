-- P3 age gate — the DOB privacy revoke (founder decision #5, 2026-07-07).
--
-- Raw date_of_birth becomes owner/admin/server-only:
--   - owner reads it via the profiles_self view (view owner bypasses grants)
--   - admins via SECURITY DEFINER admin RPCs
--   - server-side functions run as owner — unaffected
--   - everyone else gets SERVER-COMPUTED AGE via get_profile_ages / RPC
--     output columns. Age remains fully visible product-wide — it is core
--     recruiting data; only the raw birthdate is private.
--
-- Leak-class audit before this revoke: no SECURITY DEFINER read RPC emits
-- raw date_of_birth (discover_profiles emits computed age and uses DOB only
-- for min/max-age filtering; nl-search converts to age before the LLM).
-- The column UPDATE grant is intentionally untouched: users edit their own
-- DOB (RLS restricts rows); reads are what leak.
--
-- ORDERING CONSTRAINT: apply only where the client already reads own-profile
-- via profiles_self and public age via get_profile_ages (staging: branch
-- deploy; prod: after the staging→main merge). PostgREST select=* fails on
-- ANY ungranted column — an early apply breaks every profiles select('*').
REVOKE SELECT (date_of_birth) ON public.profiles FROM anon, authenticated;

-- ADVERSARIAL-PROBE FIX: the column revoke above is a silent no-op against
-- authenticated's TABLE-level SELECT grant (anon was already column-level,
-- so its revoke held; authenticated's "102 granted columns" was just the
-- catalog expanding one table grant). Convert authenticated to explicit
-- column grants minus date_of_birth.
--
-- ⚠️ MAINTENANCE CONTRACT from here on: every future ADD COLUMN on
-- public.profiles MUST include `GRANT SELECT (new_col) ON public.profiles
-- TO authenticated;` (and anon if public) or every client `select('*')`
-- on profiles breaks instantly. Mirrors the existing anon reality.
DO $$
DECLARE v_cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ')
    INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles'
     AND column_name <> 'date_of_birth';
  EXECUTE 'REVOKE SELECT ON public.profiles FROM authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.profiles TO authenticated', v_cols);
END $$;
