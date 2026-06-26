-- Application-clarity — second-audit fixes. Additive + idempotent.
-- (1) Lock opportunity_applications.ai_feedback to service-role writes only.
-- (2) Pass the structured opportunities.position into the status-change
--     notification metadata so the in-app + push copy stop echoing the whole
--     free-text title as the "position".

-- ── (1) ai_feedback is service-role-only ────────────────────────────────────
-- ai_feedback carries the AI-attributed explanation shown to the player. It is
-- written ONLY by the application-feedback edge fn (service role, auth.uid() NULL).
-- The column inherits the default authenticated UPDATE grant, and a club has RLS
-- update rights on its applicants' rows — so without this guard a club could PATCH
-- a forged AI message. This BEFORE trigger silently reverts any ai_feedback change
-- attempted by an authenticated writer; the service role (auth.uid() IS NULL) is
-- unaffected.
CREATE OR REPLACE FUNCTION public.protect_application_ai_feedback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      NEW.ai_feedback := NULL;
    ELSIF NEW.ai_feedback IS DISTINCT FROM OLD.ai_feedback THEN
      NEW.ai_feedback := OLD.ai_feedback;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_application_ai_feedback ON public.opportunity_applications;
CREATE TRIGGER trg_protect_application_ai_feedback
  BEFORE INSERT OR UPDATE ON public.opportunity_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_application_ai_feedback();

-- ── (2) structured position in the status-change notification ───────────────
-- Recreate handle_opportunity_application_notifications verbatim from
-- 20260531120000, adding o.position to the SELECT and 'position' to the
-- vacancy_application_status metadata. The client (config.ts) + push
-- (push-payload.ts) humanize this enum and prefer it over the title heuristic.
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

      IF OLD.status = 'pending' AND NEW.status IN ('shortlisted', 'maybe', 'rejected') THEN
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
