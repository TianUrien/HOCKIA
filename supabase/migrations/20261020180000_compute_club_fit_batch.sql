-- Applicants list: one fit read per role instead of one per applicant.
--
-- useRoleApplicants called compute_club_fit once per application (N RPCs
-- for N applicants; the applicants route trace of 2026-10-19 shows four in
-- one page load). compute_club_fit_batch takes the player ids and answers
-- one row per player in a single request. It is a thin SQL wrapper: SECURITY
-- INVOKER like compute_club_fit, so every call still runs the same caller
-- checks (auth.uid() must be p_owner_id and a recruiter; otherwise no rows,
-- never an error). At most 200 ids are answered per call.
-- Rollback: supabase/rollbacks/20261020180000_compute_club_fit_batch.down.sql

CREATE OR REPLACE FUNCTION public.compute_club_fit_batch(
  p_owner_id uuid,
  p_player_ids uuid[],
  p_target text,
  p_region text,
  p_opportunity_id uuid
)
 RETURNS TABLE(player_id uuid, score numeric, state text, components jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT ids.player_id, f.score, f.state, f.components
  FROM unnest(p_player_ids[1:200]) AS ids(player_id)
  CROSS JOIN LATERAL public.compute_club_fit(p_owner_id, ids.player_id, p_target, p_region, p_opportunity_id) AS f;
$function$;

-- Grants: identical to compute_club_fit; never anon/PUBLIC.
REVOKE ALL ON FUNCTION public.compute_club_fit_batch(uuid, uuid[], text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_club_fit_batch(uuid, uuid[], text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.compute_club_fit_batch(uuid, uuid[], text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_club_fit_batch(uuid, uuid[], text, text, uuid) TO service_role;
