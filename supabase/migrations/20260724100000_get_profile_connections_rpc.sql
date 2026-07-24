-- Public-portfolio Phase 3: ONE shared count+list RPC for a profile's
-- accepted connections (reconciled Connections design, 2026-07-22 panel).
--
-- WHY: the count pill / "See all N" (ConnectionsPreview) and the dedicated
-- visitor connections page previously used two different sources —
-- profiles.accepted_friend_count (denormalized, unfenced) for the number
-- and client-side edges+profiles queries (RLS-fenced) for the faces/list.
-- A viewer for whom some connections are hidden (blocked pair, hidden
-- profile, test account) saw "27 connections" over a 24-row list. This RPC
-- is now the single source for BOTH the visible list and the visible total,
-- so every signed-in surface agrees by construction.
--
-- Fences (mirrors get_club_members, the model visitor-list RPC):
--   * signed-in callers only — the reconciled design gates the visitor
--     connections surface behind sign-in (third parties never consented to
--     a crawlable graph; anonymous enumeration would bypass blocks). Anon
--     grants are revoked AND auth.uid() is re-checked in-body.
--   * accepted edges only.
--   * hidden profiles vanish: profile_is_hidden(is_blocked, frozen_minor_at).
--   * onboarding_completed only (ghost rows never listed).
--   * test accounts visible only to test-account viewers
--     (is_current_user_test_account — same carve-out as profiles RLS).
--   * pair-blocked connections vanish for THIS viewer (is_blocked_pair).
--   * viewer blocked from the TARGET profile → empty result (defense in
--     depth; the profile page itself is already unreachable).
--
-- p_search matches name OR username, case-insensitive substring.
-- p_role filters one role. total_count repeats on every row (single-probe
-- pattern: page callers read it from row 0; a zero-match page falls back
-- to a separate probe-less "0" state client-side).

CREATE OR REPLACE FUNCTION public.get_profile_connections(
  p_profile_id uuid,
  p_search text DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_limit integer DEFAULT 24,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  full_name text,
  avatar_url text,
  role text,
  username text,
  is_verified boolean,
  base_location text,
  current_club text,
  connected_at timestamp with time zone,
  total_count bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH visible AS (
    SELECT
      fp.id,
      fp.full_name,
      fp.avatar_url,
      fp.role::text AS role,
      fp.username,
      COALESCE(fp.is_verified, false) AS is_verified,
      fp.base_location,
      fp.current_club,
      COALESCE(e.accepted_at, e.created_at) AS connected_at
    FROM profile_friend_edges e
    JOIN profiles fp ON fp.id = e.friend_id
    WHERE e.profile_id = p_profile_id
      AND e.status = 'accepted'
      AND auth.uid() IS NOT NULL
      AND NOT public.is_blocked_pair(auth.uid(), p_profile_id)
      AND fp.onboarding_completed = true
      AND NOT public.profile_is_hidden(fp.is_blocked, fp.frozen_minor_at)
      AND (NOT COALESCE(fp.is_test_account, false) OR public.is_current_user_test_account())
      AND NOT public.is_blocked_pair(auth.uid(), fp.id)
      AND (
        p_search IS NULL
        OR fp.full_name ILIKE '%' || p_search || '%'
        OR fp.username ILIKE '%' || p_search || '%'
      )
      AND (p_role IS NULL OR fp.role::text = p_role)
  ),
  counted AS (SELECT COUNT(*) AS cnt FROM visible)
  SELECT
    v.id,
    v.full_name,
    v.avatar_url,
    v.role,
    v.username,
    v.is_verified,
    v.base_location,
    v.current_club,
    v.connected_at,
    c.cnt
  FROM visible v
  CROSS JOIN counted c
  ORDER BY v.connected_at DESC, v.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$function$;

REVOKE ALL ON FUNCTION public.get_profile_connections(uuid, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_connections(uuid, text, text, integer, integer) TO authenticated, service_role;
