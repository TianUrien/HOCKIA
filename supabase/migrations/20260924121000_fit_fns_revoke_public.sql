-- Follow-up to 20260924120000: Postgres grants EXECUTE on every new function
-- to PUBLIC by default, so "REVOKE ... FROM anon" alone changed nothing —
-- anon still executed through PUBLIC (probe on staging: anon got an empty
-- result instead of "permission denied"). Revoke from PUBLIC and grant back
-- only to the roles that may compute fit: signed-in users (the function
-- itself then insists the caller is the club/coach owner) and service_role.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.compute_club_fit(uuid, uuid, text, text, uuid)',
    'public.get_club_fit(uuid, uuid)',
    'public.get_club_fit_batch(uuid[], uuid)',
    'public._club_fit_context_hash(text, text, uuid)',
    'public._upsert_club_fit_cache(uuid, uuid, text, numeric, text, jsonb)',
    'public._club_level_band(uuid, text)',
    'public._player_level_band(uuid, text)',
    'public._recency_30d(timestamptz)',
    'public._target_accepts_category(text, text)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;
