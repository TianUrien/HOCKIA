-- ROLLBACK for 20261009200000_club_flow_fixes.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20261009200000 --linked
--
-- Restores the previous bodies, verbatim, of:
--   handle_opportunity_application_notifications ← 20260706090000_application_expiry.sql
-- Grants: the hardening REVOKEs of the migration are kept (nothing calls the
-- trigger function directly; triggers fire regardless of EXECUTE).
-- Notifications already written stay as they are.


-- handle_opportunity_application_notifications: body of 20260706090000_application_expiry.sql, verbatim.

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
  v_position public.opportunity_position;
BEGIN
  SELECT o.id, o.club_id, o.title, p.full_name, o.position
  INTO v_opportunity_id, v_club_id, v_opportunity_title, v_club_name, v_position
  FROM public.opportunities o
  LEFT JOIN public.profiles p ON p.id = o.club_id
  WHERE o.id = NEW.opportunity_id;

  IF v_club_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
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
      UPDATE public.profile_notifications
         SET cleared_at = timezone('utc', now())
       WHERE kind = 'vacancy_application_received'
         AND source_entity_id = NEW.id;

      -- 'maybe' intentionally absent: player-side it stays "under review".
      -- 'no_response' intentionally absent: the expiry sweep sends ONE
      -- per-player aggregate instead of per-row notifications.
      IF OLD.status = 'pending' AND NEW.status IN ('shortlisted', 'rejected') THEN
        PERFORM public.enqueue_notification(
          NEW.applicant_id,
          v_club_id,
          'vacancy_application_status',
          NEW.id,
          jsonb_build_object(
            'application_id', NEW.id,
            'opportunity_id', NEW.opportunity_id,
            'vacancy_title', v_opportunity_title,
            'club_name', v_club_name,
            'position', v_position,
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

REVOKE ALL ON FUNCTION public.handle_opportunity_application_notifications() FROM PUBLIC, anon, authenticated;
