-- ROLLBACK for 20261009200000_club_flow_fixes.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20261009200000 --linked
--
-- Restores the previous bodies, verbatim, of:
--   handle_opportunity_application_notifications ← 20260706090000_application_expiry.sql
--   _fill_waiting_applications                   ← 20261004200000_role_organisation_name.sql
--   handle_opportunity_recruiting_close          ← 20260928120000_recruiting_server_functions.sql
-- then drops _restore_filled_applications (created by the migration).
-- Data: metadata.before_filled keys written by fills stay on the applications
-- (harmless: nothing else reads them); restored applications stay restored.
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


-- _fill_waiting_applications: body of 20261004200000_role_organisation_name.sql, verbatim.

CREATE OR REPLACE FUNCTION public._fill_waiting_applications(p_opportunity_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opp   record;
  v_app   record;
  v_count integer := 0;
BEGIN
  -- club_name: a club account as before; a coach's role names the organisation it
  -- recruits for (role_organisation), else the coach.
  SELECT o.id, o.club_id, o.title, o.position,
         CASE WHEN p.role = 'club' THEN p.full_name
              ELSE coalesce((SELECT ro.name FROM public.role_organisation(o.id) ro), p.full_name) END AS club_name
    INTO v_opp
    FROM public.opportunities o
    LEFT JOIN public.profiles p ON p.id = o.club_id
   WHERE o.id = p_opportunity_id;

  FOR v_app IN
    SELECT a.id, a.applicant_id
      FROM public.opportunity_applications a
     WHERE a.opportunity_id = p_opportunity_id
       AND a.status::text IN ('pending', 'shortlisted', 'maybe', 'offered', 'accepted')
     FOR UPDATE
  LOOP
    UPDATE public.opportunity_offers
       SET status = 'cancelled', responded_at = timezone('utc', now())
     WHERE application_id = v_app.id AND status = 'live';

    PERFORM public._set_application_status(v_app.id, 'filled', 'role_filled');

    -- Same kind the applicant already gets for shortlisted / rejected, so every app
    -- version renders it ("<club> updated your application").
    PERFORM public.enqueue_notification(
      v_app.applicant_id,
      v_opp.club_id,
      'vacancy_application_status'::public.profile_notification_kind,
      v_app.id,
      jsonb_build_object(
        'application_id', v_app.id,
        'opportunity_id', p_opportunity_id,
        'vacancy_title', v_opp.title,
        'club_name', v_opp.club_name,
        'position', v_opp.position,
        'status', 'filled'),
      NULL);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public._fill_waiting_applications(uuid) FROM PUBLIC, anon, authenticated;


-- handle_opportunity_recruiting_close: body of 20260928120000_recruiting_server_functions.sql, verbatim.

CREATE OR REPLACE FUNCTION public.handle_opportunity_recruiting_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Invites expire with the role.
  IF OLD.status = 'open' AND NEW.status <> 'open' THEN
    UPDATE public.opportunity_invites
       SET status = 'expired'
     WHERE opportunity_id = NEW.id AND status = 'sent';
  END IF;

  -- Closed as filled → everyone still waiting gets the kind note.
  IF NEW.status = 'closed' AND NEW.closed_reason = 'filled'
     AND (OLD.status IS DISTINCT FROM 'closed' OR OLD.closed_reason IS DISTINCT FROM 'filled') THEN
    PERFORM public._fill_waiting_applications(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_opportunity_recruiting_close() FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public._restore_filled_applications(uuid);
