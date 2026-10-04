-- ROLLBACK for 20261004100000_d5_role_suggestions.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20261004100000 --linked
--
-- Unschedules role_suggestions_nightly, drops the two opportunities triggers,
-- the D5 functions and both tables. The migration changed no existing
-- function, policy or grant, so nothing else is restored. The stored
-- suggestions are derived data (recomputed from profiles), nothing is lost.
-- The client shows "No players fit this role yet" when the RPC is missing
-- (missing-backend fallback); nl-search's refine mode answers with the neutral
-- error card.

DO $$
BEGIN
  PERFORM cron.unschedule('role_suggestions_nightly');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN RAISE NOTICE 'Insufficient privilege to unschedule; continuing';
  WHEN others THEN RAISE NOTICE 'No role_suggestions_nightly schedule found';
END $$;

DROP TRIGGER IF EXISTS role_suggestions_on_insert ON public.opportunities;
DROP TRIGGER IF EXISTS role_suggestions_on_update ON public.opportunities;

DROP FUNCTION IF EXISTS public._role_suggestions_on_change();
DROP FUNCTION IF EXISTS public.run_role_suggestions_nightly();
DROP FUNCTION IF EXISTS public.get_role_suggestions(uuid);
DROP FUNCTION IF EXISTS public.refresh_role_suggestions(uuid);
DROP FUNCTION IF EXISTS public.compute_role_suggestions(uuid);
DROP FUNCTION IF EXISTS public._role_fit_target(text);

DROP TABLE IF EXISTS public.role_suggestion_runs;
DROP TABLE IF EXISTS public.role_suggestions;

NOTIFY pgrst, 'reload schema';
