-- =========================================================================
-- reference_request_rejected — emit notification on decline
-- =========================================================================
-- The notification config already handles `reference_request_rejected`
-- (see client/src/components/notifications/config.ts) but the backend
-- trigger in 202511211000_unified_notifications.sql never enqueued it.
-- Result: requesters were silently left in the dark when their reference
-- request was declined.
--
-- Affects all roles that can request references (player, coach, umpire).
-- The pending `reference_request_received` notification is still cleared
-- for the reference-giver on status change; this just adds the requester-
-- facing decline notification.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.handle_profile_reference_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  now_ts timestamptz := timezone('utc', now());
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'pending' THEN
      PERFORM public.enqueue_notification(
        NEW.reference_id,
        NEW.requester_id,
        'reference_request_received',
        NEW.id,
        jsonb_build_object(
          'reference_id', NEW.id,
          'requester_id', NEW.requester_id,
          'relationship_type', NEW.relationship_type,
          'request_note', NEW.request_note
        ),
        NULL
      );
    ELSIF NEW.status = 'accepted' THEN
      PERFORM public.enqueue_notification(
        NEW.requester_id,
        NEW.reference_id,
        'reference_request_accepted',
        NEW.id,
        jsonb_build_object(
          'reference_id', NEW.id,
          'reference_profile_id', NEW.reference_id,
          'relationship_type', NEW.relationship_type,
          'endorsement_text', NEW.endorsement_text
        ),
        NULL
      );
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'pending' AND NEW.status IN ('accepted', 'declined', 'revoked') THEN
      UPDATE public.profile_notifications
         SET cleared_at = now_ts
       WHERE kind = 'reference_request_received'
         AND source_entity_id = NEW.id;
    END IF;

    IF OLD.status <> 'accepted' AND NEW.status = 'accepted' THEN
      PERFORM public.enqueue_notification(
        NEW.requester_id,
        NEW.reference_id,
        'reference_request_accepted',
        NEW.id,
        jsonb_build_object(
          'reference_id', NEW.id,
          'reference_profile_id', NEW.reference_id,
          'relationship_type', NEW.relationship_type,
          'endorsement_text', NEW.endorsement_text
        ),
        NULL
      );
    ELSIF NEW.status = 'accepted' AND OLD.endorsement_text IS DISTINCT FROM NEW.endorsement_text THEN
      PERFORM public.enqueue_notification(
        NEW.requester_id,
        NEW.reference_id,
        'reference_updated',
        NEW.id,
        jsonb_build_object(
          'reference_id', NEW.id,
          'reference_profile_id', NEW.reference_id,
          'relationship_type', NEW.relationship_type,
          'endorsement_text', NEW.endorsement_text
        ),
        NULL
      );
    END IF;

    -- NEW: when the reference-giver declines a pending request, notify
    -- the requester so they don't wonder what happened. 'revoked' = the
    -- requester's own cancel, so we don't notify them about their own action.
    IF OLD.status = 'pending' AND NEW.status = 'declined' THEN
      PERFORM public.enqueue_notification(
        NEW.requester_id,
        NEW.reference_id,
        'reference_request_rejected',
        NEW.id,
        jsonb_build_object(
          'reference_id', NEW.id,
          'reference_profile_id', NEW.reference_id,
          'relationship_type', NEW.relationship_type
        ),
        NULL
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
