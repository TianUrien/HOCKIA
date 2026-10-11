-- Friends in common for many members in one call (Community preview + swipe
-- deck: "3 friends in common" with three avatars). Replaces one friend-edge
-- read plus up to five pages of get_profile_connections per member.
-- Rollback: supabase/rollbacks/20261011130000_get_friends_in_common.down.sql
-- Probe:    supabase/tests/security/get_friends_in_common_acl.probe.sql (read-only)
--
-- Same fences as get_profile_connections: signed-in viewers only; never across
-- a block (viewer ↔ member or viewer ↔ friend); hidden profiles, unfinished
-- onboarding and test accounts (unless the viewer is one) stay out. The
-- friends returned are the viewer's own friends, so nothing new is revealed
-- beyond "this member is also friends with them".
--
-- Up to 60 members per call, up to 3 friends each (newest friendship first)
-- plus the total per member.

CREATE OR REPLACE FUNCTION public.get_friends_in_common(p_member_ids uuid[])
RETURNS TABLE (member_id uuid, friend_id uuid, full_name text, avatar_url text, role text, total bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH members AS (
    SELECT m.id
    FROM unnest((p_member_ids)[1:60]) AS m(id)
    WHERE auth.uid() IS NOT NULL
      AND m.id <> auth.uid()
      AND NOT public.is_blocked_pair(auth.uid(), m.id)
  ),
  mine AS (
    SELECT e.friend_id
    FROM profile_friend_edges e
    WHERE e.profile_id = auth.uid() AND e.status = 'accepted'
  ),
  mutual AS (
    SELECT me.id AS member_id, fp.id AS friend_id, fp.full_name, fp.avatar_url, fp.role::text AS role,
           COALESCE(e.accepted_at, e.created_at) AS connected_at
    FROM members me
    JOIN profile_friend_edges e ON e.profile_id = me.id AND e.status = 'accepted'
    JOIN mine ON mine.friend_id = e.friend_id
    JOIN profiles fp ON fp.id = e.friend_id
    WHERE fp.onboarding_completed = true
      AND NOT public.profile_is_hidden(fp.is_blocked, fp.frozen_minor_at)
      AND (NOT COALESCE(fp.is_test_account, false) OR public.is_current_user_test_account())
      AND NOT public.is_blocked_pair(auth.uid(), fp.id)
  ),
  ranked AS (
    SELECT m.*, row_number() OVER (PARTITION BY m.member_id ORDER BY m.connected_at DESC, m.friend_id) AS rn,
           count(*) OVER (PARTITION BY m.member_id) AS total
    FROM mutual m
  )
  SELECT r.member_id, r.friend_id, r.full_name, r.avatar_url, r.role, r.total
  FROM ranked r
  WHERE r.rn <= 3
  ORDER BY r.member_id, r.rn;
$function$;

REVOKE ALL ON FUNCTION public.get_friends_in_common(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_friends_in_common(uuid[]) TO authenticated, service_role;
