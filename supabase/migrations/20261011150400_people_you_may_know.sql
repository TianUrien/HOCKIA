-- Home v1, step 4: "People you may know" for the end of the feed (Figma H13).
-- Rollback: supabase/rollbacks/20261011150400_people_you_may_know.down.sql
-- Probe:    supabase/tests/security/people_you_may_know_acl.probe.sql (read-only)
--
-- Friends of friends first (ranked by mutual friends), then the newest
-- members to fill. Never: the viewer, existing friends or pending requests,
-- anyone in a block with the viewer, hidden profiles, unfinished onboarding,
-- test accounts (outside staging / test viewers). Club-facing viewers (clubs,
-- coaches who recruit) see adult players only, like every club-facing list.

CREATE OR REPLACE FUNCTION public.get_people_you_may_know(p_limit integer DEFAULT 12)
RETURNS TABLE (id uuid, full_name text, avatar_url text, role text, "position" text, base_location text,
               mutual_count integer, reason text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_test boolean;
  v_club_facing boolean;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 12), 1), 30);
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;
  SELECT is_staging_env() OR COALESCE(p.is_test_account, false),
         (p.role = 'club' OR (p.role = 'coach' AND COALESCE(p.coach_recruits_for_team, false)))
    INTO v_is_test, v_club_facing
  FROM profiles p WHERE p.id = v_user_id;

  RETURN QUERY
  WITH mine AS (
    SELECT e.friend_id FROM profile_friend_edges e WHERE e.profile_id = v_user_id AND e.status = 'accepted'
  ),
  related AS (  -- anyone already connected or requested either way
    SELECT e.friend_id FROM profile_friend_edges e WHERE e.profile_id = v_user_id
  ),
  fof AS (
    SELECT e.friend_id AS pid, count(*)::integer AS mutual
    FROM profile_friend_edges e
    JOIN mine m ON m.friend_id = e.profile_id
    WHERE e.status = 'accepted' AND e.friend_id <> v_user_id
    GROUP BY e.friend_id
  ),
  eligible AS (
    SELECT p.id, p.full_name, p.avatar_url, p.role, p.position, p.base_location, p.created_at,
           COALESCE(f.mutual, 0) AS mutual
    FROM profiles p
    LEFT JOIN fof f ON f.pid = p.id
    WHERE p.id <> v_user_id
      AND p.onboarding_completed = true
      AND p.role IN ('player', 'coach', 'club', 'umpire')
      AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
      AND (v_is_test OR COALESCE(p.is_test_account, false) = false)
      AND NOT public.is_blocked_pair(v_user_id, p.id)
      AND NOT EXISTS (SELECT 1 FROM related r WHERE r.friend_id = p.id)
      AND (NOT v_club_facing OR p.role <> 'player' OR public.profile_is_adult(p.date_of_birth))
  )
  SELECT x.id, x.full_name, x.avatar_url, x.role, x.position, x.base_location, x.mutual,
         CASE WHEN x.mutual > 0 THEN 'mutual_friends' ELSE 'new_member' END
  FROM eligible x
  ORDER BY (x.mutual > 0) DESC, x.mutual DESC, x.created_at DESC
  LIMIT v_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_people_you_may_know(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_people_you_may_know(integer) TO authenticated, service_role;
