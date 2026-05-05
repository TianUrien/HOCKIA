-- =========================================================================
-- Notify applicants when their opportunity application status changes
-- =========================================================================
-- The 'vacancy_application_status' notification kind has been in the
-- enum since 202511211000, the client has rendering config for it
-- (notifications/config.ts), and the push-payload mapper handles it
-- (functions/send-push/push-payload.ts) — but no trigger ever fired
-- it. Players who applied to an opportunity got nothing back when the
-- club shortlisted, accepted, or rejected them.
--
-- Fix: extend handle_opportunity_application_notifications() so that
-- when a club moves an application out of 'pending', the applicant
-- gets a notification.
--
-- Fires only on 'pending' → ('shortlisted'|'maybe'|'rejected'|'accepted').
-- Re-actioning (e.g. shortlisted → rejected) does NOT fire — keeps the
-- applicant from being spammed if a club iterates on their decision.
-- The trigger continues to clear the club-side queue notification on
-- any status change (existing behaviour).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.handle_opportunity_application_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opportunity_id UUID;
  v_club_id UUID;
  v_opportunity_title TEXT;
  v_club_name TEXT;
BEGIN
  SELECT o.id, o.club_id, o.title, p.full_name
  INTO v_opportunity_id, v_club_id, v_opportunity_title, v_club_name
  FROM public.opportunities o
  LEFT JOIN public.profiles p ON p.id = o.club_id
  WHERE o.id = NEW.opportunity_id;

  IF v_club_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Notify the club of the new application (existing behaviour)
    PERFORM public.enqueue_notification(
      v_club_id,
      NEW.applicant_id,
      'vacancy_application_received',
      NEW.id,
      jsonb_build_object(
        'application_id', NEW.id,
        'opportunity_id', NEW.opportunity_id,
        'opportunity_title', v_opportunity_title,
        'applicant_id', NEW.applicant_id,
        'application_status', NEW.status
      ),
      NULL
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      -- Clear the club-side queue notification (existing behaviour)
      UPDATE public.profile_notifications
         SET cleared_at = timezone('utc', now())
       WHERE kind = 'vacancy_application_received'
         AND source_entity_id = NEW.id;

      -- New: notify the applicant when their status moves out of
      -- 'pending'. Re-actioning between non-pending statuses is
      -- intentionally silent so an iterating club doesn't spam the
      -- applicant with conflicting updates.
      IF OLD.status = 'pending' AND NEW.status IN ('shortlisted', 'maybe', 'rejected', 'accepted') THEN
        PERFORM public.enqueue_notification(
          NEW.applicant_id,            -- recipient: the applicant
          v_club_id,                   -- actor: the club
          'vacancy_application_status',
          NEW.id,                      -- source_entity_id: the application
          jsonb_build_object(
            'application_id', NEW.id,
            'opportunity_id', NEW.opportunity_id,
            'vacancy_title', v_opportunity_title,
            'club_name', v_club_name,
            'status', NEW.status
          ),
          NULL
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
