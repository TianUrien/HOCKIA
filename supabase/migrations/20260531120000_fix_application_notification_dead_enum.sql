-- =========================================================================
-- Fix: applicant status changes 400 with "invalid input value for enum
-- application_status: accepted"
-- =========================================================================
-- handle_opportunity_application_notifications() (last set in
-- 20260508200000_notify_applicant_on_status_change.sql) gates the
-- applicant notification on:
--
--   NEW.status IN ('shortlisted', 'maybe', 'rejected', 'accepted')
--
-- 'accepted' was a value of the application_status enum in the original
-- schema (202511130101: pending/reviewed/shortlisted/interview/accepted/
-- rejected/withdrawn) but the enum was later narrowed to
-- pending/shortlisted/maybe/rejected. The dead 'accepted' literal is
-- coerced to application_status when the IN-list is evaluated at trigger
-- runtime; because the label no longer exists, Postgres raises
-- 22P02 (invalid input value for enum ... "accepted") and ABORTS the
-- whole UPDATE.
--
-- Effect: EVERY applicant status change (Good fit / Maybe / Not a fit →
-- shortlisted/maybe/rejected) failed with a 400 on the PATCH. The client
-- was sending valid values; the trigger's stale literal killed the write.
--
-- Fix: recreate the function with the dead 'accepted' literal removed
-- from the IN-list. No other behaviour changes — INSERT notification,
-- queue-clear on status change, and the pending→decision applicant
-- notification are all preserved verbatim.
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

      -- Notify the applicant when their status moves out of 'pending'.
      -- Re-actioning between non-pending statuses is intentionally silent
      -- so an iterating club doesn't spam the applicant.
      -- NOTE: 'accepted' removed from this list — it is no longer a valid
      -- application_status enum label and its presence aborted the UPDATE.
      IF OLD.status = 'pending' AND NEW.status IN ('shortlisted', 'maybe', 'rejected') THEN
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
