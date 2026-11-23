-- Admin: who blocked a member.
--
-- Founder 2026-11-23: for safety work the admin needs to see who blocked
-- whom. This replaces the 2026-11-09 rule that the admin portal never shows
-- it (20261109220000_admin_member_blocks.sql). The list function is unchanged
-- and still returns counts and dates only. This adds one admin-only read for a
-- single blocked member, and every call is written to admin_audit_logs
-- (action 'view_member_blockers'), so there is a record of which admin looked
-- at which member's blockers and when.
--
-- A block stays private to everyone else: no member, club or the blocked
-- person can read user_blocks rows that are not their own (RLS unchanged).
--
-- Grants: REVOKE from PUBLIC and anon; EXECUTE to authenticated (the function
-- refuses non-admins) and service_role.
-- Rollback: supabase/rollbacks/20261123200000_admin_member_blockers.down.sql
-- Probe:    supabase/tests/security/admin_member_blockers_acl.probe.sql

CREATE OR REPLACE FUNCTION public.admin_get_member_blockers(p_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile id required';
  END IF;

  SELECT jsonb_agg(to_jsonb(sub) ORDER BY sub.blocked_at DESC, sub.profile_id) INTO v_rows
    FROM (
      SELECT b.blocker_id AS profile_id,
             p.full_name, p.role, p.avatar_url,
             b.created_at AS blocked_at,
             coalesce(p.is_blocked, false) AS is_blocked
        FROM public.user_blocks b
        LEFT JOIN public.profiles p ON p.id = b.blocker_id
       WHERE b.blocked_id = p_profile_id
       ORDER BY b.created_at DESC, b.blocker_id
       LIMIT 200
    ) sub;

  INSERT INTO public.admin_audit_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), 'view_member_blockers', 'profile', p_profile_id,
          jsonb_build_object('blockers_returned', coalesce(jsonb_array_length(v_rows), 0)));

  RETURN jsonb_build_object('rows', coalesce(v_rows, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_member_blockers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_member_blockers(uuid) TO authenticated, service_role;
