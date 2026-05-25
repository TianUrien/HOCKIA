-- C6 hotfix — split the seen_at write off the get_notifications read path.
--
-- The previous get_notifications RPC (migration 202511211630) wrapped a
-- final UPDATE inside the read query:
--
--   WITH ordered AS (SELECT ... LIMIT N OFFSET M),
--        marked  AS (UPDATE profile_notifications SET seen_at = now()
--                     WHERE id IN (SELECT id FROM ordered) ...)
--   SELECT ... FROM ordered;
--
-- Under concurrent reads for the same user — rapid navigation, multiple
-- tabs, a push notification opening the drawer while the bell badge is
-- already polling — the UPDATE acquires row-level locks on the matched
-- notifications. Subsequent reads queue behind the lock, and tail-latency
-- spiked to 20 seconds in production telemetry (external audit, 2026-05-24).
--
-- Fix: the read RPC becomes a pure SELECT (no write). A new RPC
-- mark_notifications_seen(p_ids uuid[]) does only the UPDATE. The frontend
-- fires the second RPC as fire-and-forget after the read returns — the
-- user sees the page immediately, and the seen_at timestamp lands a
-- moment later on a separate transaction without blocking anyone.
--
-- Indexes are already correct (idx_profile_notifications_recipient_state
-- partial index covers WHERE cleared_at IS NULL plus the ORDER BY columns).
-- This is purely a contention fix, not an index fix.

set check_function_bodies = off;
set search_path = public;

-- ── get_notifications: read-only, no UPDATE ──────────────────────────────
CREATE OR REPLACE FUNCTION public.get_notifications(
  p_filter text DEFAULT 'all',
  p_kind public.profile_notification_kind DEFAULT NULL,
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  kind public.profile_notification_kind,
  source_entity_id uuid,
  metadata jsonb,
  target_url text,
  created_at timestamptz,
  read_at timestamptz,
  seen_at timestamptz,
  cleared_at timestamptz,
  actor jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  clamped_limit integer := least(greatest(coalesce(p_limit, 30), 1), 200);
  clamped_offset integer := greatest(coalesce(p_offset, 0), 0);
BEGIN
  IF current_user_id IS NULL THEN
    RETURN;
  END IF;

  IF lower(coalesce(p_filter, 'all')) NOT IN ('all', 'unread', 'by_type') THEN
    RAISE EXCEPTION 'Invalid notification filter: %', p_filter USING ERRCODE = '22023';
  END IF;

  IF lower(coalesce(p_filter, 'all')) = 'by_type' AND p_kind IS NULL THEN
    RAISE EXCEPTION 'Filter "by_type" requires p_kind to be supplied' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    pn.id,
    pn.kind,
    pn.source_entity_id,
    pn.metadata,
    pn.target_url,
    pn.created_at,
    pn.read_at,
    pn.seen_at,
    pn.cleared_at,
    jsonb_build_object(
      'id', actor.id,
      'full_name', actor.full_name,
      'role', actor.role,
      'username', actor.username,
      'avatar_url', actor.avatar_url,
      'base_location', actor.base_location
    ) AS actor
  FROM public.profile_notifications pn
  LEFT JOIN public.profiles actor ON actor.id = pn.actor_profile_id
  WHERE pn.recipient_profile_id = current_user_id
    AND pn.cleared_at IS NULL
    AND (p_kind IS NULL OR pn.kind = p_kind)
    AND (
      lower(coalesce(p_filter, 'all')) <> 'unread'
      OR pn.read_at IS NULL
    )
  ORDER BY (pn.read_at IS NULL) DESC, pn.created_at DESC
  LIMIT clamped_limit OFFSET clamped_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_notifications(text, public.profile_notification_kind, integer, integer) TO authenticated;

-- ── mark_notifications_seen: write-only, fire-and-forget from client ─────
-- Idempotent — calling with already-seen IDs is a no-op (the WHERE
-- seen_at IS NULL clause filters them out). Caller is expected to pass
-- the ids returned by the immediately-preceding get_notifications call.
--
-- Returns void rather than the updated rows. PostgREST exposes void
-- functions cleanly and the frontend doesn't need the return value.
CREATE OR REPLACE FUNCTION public.mark_notifications_seen(
  p_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RETURN;
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Scope the UPDATE to the caller's own notifications so a client can't
  -- mark someone else's notifications seen even if they craft the ID list.
  UPDATE public.profile_notifications
     SET seen_at = timezone('utc', now())
   WHERE id = ANY(p_ids)
     AND recipient_profile_id = current_user_id
     AND seen_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_notifications_seen(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.get_notifications IS
  'Read-only notification page. Pair with mark_notifications_seen() called as fire-and-forget by the client.';

COMMENT ON FUNCTION public.mark_notifications_seen IS
  'Marks the given notification IDs seen for the caller. Idempotent. Designed to be called fire-and-forget after get_notifications returns, so the seen_at write does not block the read.';
