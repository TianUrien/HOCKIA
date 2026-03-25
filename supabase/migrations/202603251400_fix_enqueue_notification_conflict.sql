-- Fix: enqueue_notification ON CONFLICT was missing recipient_profile_id.
-- The unique index was updated to (recipient_profile_id, kind, source_entity_id)
-- in migration 202602150100, but our comprehensive block enforcement migration
-- used the old (kind, source_entity_id) signature.

CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_recipient_profile_id uuid, p_actor_profile_id uuid, p_kind public.profile_notification_kind,
  p_source_entity_id uuid DEFAULT NULL, p_metadata jsonb DEFAULT '{}'::jsonb, p_target_url text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE inserted_id uuid; now_ts timestamptz := timezone('utc', now());
BEGIN
  IF p_recipient_profile_id IS NULL THEN RETURN NULL; END IF;

  -- Block check: don't notify blocked users
  IF p_actor_profile_id IS NOT NULL AND public.is_blocked_pair(p_recipient_profile_id, p_actor_profile_id) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.profile_notifications (
    recipient_profile_id, actor_profile_id, kind, source_entity_id, metadata, target_url,
    created_at, updated_at, read_at, seen_at, cleared_at
  ) VALUES (
    p_recipient_profile_id, p_actor_profile_id, p_kind, p_source_entity_id,
    coalesce(p_metadata, '{}'::jsonb), p_target_url, now_ts, now_ts, NULL, NULL, NULL
  )
  ON CONFLICT (recipient_profile_id, kind, source_entity_id) WHERE source_entity_id IS NOT NULL DO UPDATE
    SET actor_profile_id = excluded.actor_profile_id, metadata = excluded.metadata,
        target_url = excluded.target_url, created_at = excluded.created_at,
        updated_at = excluded.updated_at, read_at = NULL, seen_at = NULL, cleared_at = NULL
  RETURNING id INTO inserted_id;
  RETURN inserted_id;
END;
$$;
