-- Admin: members blocked by other members.
--
-- Founder 2026-11-09: the admin portal shows accounts an admin blocked
-- (Directory › Blocked), member reports and spam signals, but not when members
-- block each other (user_blocks). This adds one admin-only read: per blocked
-- member, how many people blocked them, when, and their reports and spam
-- signals, most-blocked first.
--
-- Who blocked whom is never returned: a block is a private safety action (a
-- player blocking someone who harasses her must not be exposed, even to the
-- admin list). Only counts and dates per blocked account.
--
-- Grants: REVOKE from PUBLIC and anon; EXECUTE to authenticated (the function
-- refuses non-admins) and service_role.
-- Rollback: supabase/rollbacks/20261109220000_admin_member_blocks.down.sql
-- Probe:    supabase/tests/security/admin_member_blocks_acl.probe.sql

CREATE OR REPLACE FUNCTION public.admin_get_member_blocks(
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer;
  v_rows  jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT count(DISTINCT b.blocked_id) INTO v_total FROM public.user_blocks b;

  SELECT jsonb_agg(to_jsonb(sub) ORDER BY sub.block_count DESC, sub.last_blocked_at DESC, sub.profile_id) INTO v_rows
    FROM (
      SELECT b.blocked_id AS profile_id,
             count(*)::int AS block_count,
             min(b.created_at) AS first_blocked_at,
             max(b.created_at) AS last_blocked_at,
             p.full_name, p.role, p.avatar_url,
             p.created_at AS account_created_at,
             coalesce(p.is_blocked, false) AS is_blocked, p.blocked_at,
             (SELECT count(*)::int FROM public.user_reports r WHERE r.target_id = b.blocked_id) AS report_count,
             (SELECT count(*)::int FROM public.spam_signals s WHERE s.user_id = b.blocked_id) AS signal_count
        FROM public.user_blocks b
        JOIN public.profiles p ON p.id = b.blocked_id
       GROUP BY b.blocked_id, p.full_name, p.role, p.avatar_url, p.created_at, p.is_blocked, p.blocked_at
       ORDER BY count(*) DESC, max(b.created_at) DESC, b.blocked_id
       LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
      OFFSET greatest(coalesce(p_offset, 0), 0)
    ) sub;

  RETURN jsonb_build_object('rows', coalesce(v_rows, '[]'::jsonb), 'total', coalesce(v_total, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_member_blocks(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_member_blocks(integer, integer) TO authenticated, service_role;
