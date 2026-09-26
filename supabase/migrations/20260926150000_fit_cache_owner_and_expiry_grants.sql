-- Fit cache writes are limited to the caller's own rows; the application
-- expiry sweep is callable by the scheduler only.
--
-- _upsert_club_fit_cache is called by get_club_fit / get_club_fit_batch
-- (SECURITY INVOKER, so they run as the signed-in club), which always pass
-- auth.uid() as the owner. It keeps EXECUTE for authenticated and now checks
-- that the owner is the caller. Service-role and scheduler calls (no JWT
-- subject) are unaffected.
--
-- expire_overdue_applications runs from pg_cron (application_expiry_daily)
-- as the database owner; no client or edge function calls it.

CREATE OR REPLACE FUNCTION public._upsert_club_fit_cache(
  p_owner_id uuid, p_player_id uuid, p_context_hash text,
  p_score numeric, p_state text, p_components jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL AND p_owner_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.club_fit_cache (
    owner_id, player_id, context_hash, score, state, components, computed_at
  ) VALUES (
    p_owner_id, p_player_id, p_context_hash,
    p_score, p_state, p_components, timezone('utc', now())
  )
  ON CONFLICT (owner_id, player_id, context_hash) DO UPDATE
    SET score = EXCLUDED.score,
        state = EXCLUDED.state,
        components = EXCLUDED.components,
        computed_at = EXCLUDED.computed_at;
END;
$function$;

REVOKE ALL ON FUNCTION public._upsert_club_fit_cache(uuid, uuid, text, numeric, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._upsert_club_fit_cache(uuid, uuid, text, numeric, text, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.expire_overdue_applications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_overdue_applications() TO service_role;
