-- =========================================================================
-- Club recruiting flow fixes (release audit, founder-approved 2026-10-09)
-- =========================================================================
--
-- A · Decline after Good fit / Maybe tells the player.
--     handle_opportunity_application_notifications only notified on a move
--     OUT OF 'pending'. A player moved shortlisted → rejected or
--     maybe → rejected heard nothing. Now: ANY move into 'rejected', and a
--     move into 'shortlisted' from 'pending' or 'maybe', notifies the player
--     (same kind vacancy_application_status, same metadata, same status-email
--     pipeline). The name in club_name is the organisation the role recruits
--     for (role_organisation) for a coach's role, the club account's name for
--     a club, as in _fill_waiting_applications. Players read "Not selected"
--     (client copy helpers, unchanged).
--     Status email: profile_notifications holds ONE row per
--     (recipient, kind, application); enqueue_notification upserts it and
--     never resets emailed_at. A decline after an emailed Good fit therefore
--     re-used an already-emailed row and the decline email (with the club's
--     note from ai_feedback) was never sent. When the row's status really
--     changes, emailed_at is reset — unless an unprocessed email batch already
--     holds the row (that batch reads the current status and note when it
--     sends). When the row already carries the same status (e.g. rejected →
--     pending → rejected), nothing is re-sent.
--     Server moves never reach these branches: offer / signing functions and
--     the recruiting expiry move into 'shortlisted' only from offered /
--     offer_declined / accepted / signed_pending_confirmation, the expiry
--     sweep moves to 'no_response', fills move to 'filled', a reopen restores
--     from 'filled'. None of them moves into 'rejected'.
--
-- Each redefined body is the latest definition plus the lines this file needs:
--   handle_opportunity_application_notifications ← 20260706090000_application_expiry.sql
--
-- Rollback: supabase/rollbacks/20261009200000_club_flow_fixes.down.sql
-- Probes:   supabase/tests/security/club_flow_fixes_acl.probe.sql (read-only)
--           supabase/tests/security/club_flow_fixes.probe.sql (staging, rolled back)
-- =========================================================================


-- ═══ A · handle_opportunity_application_notifications ═══
-- Body = 20260706090000_application_expiry.sql + the decline / maybe / email lines.

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
  v_publisher_role TEXT;
  v_prev_status TEXT;
  v_notification_id UUID;
BEGIN
  SELECT o.id, o.club_id, o.title, p.full_name, o.position, p.role::text
  INTO v_opportunity_id, v_club_id, v_opportunity_title, v_club_name, v_position, v_publisher_role
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

      -- 'maybe' intentionally absent as a target: player-side it stays "under review".
      -- 'no_response' intentionally absent: the expiry sweep sends ONE
      -- per-player aggregate instead of per-row notifications.
      -- Any move into 'rejected' tells the player (also after Good fit / Maybe);
      -- 'shortlisted' only when it comes from review ('pending' / 'maybe'), never
      -- when an offer or signing step falls back to it.
      IF NEW.status = 'rejected'
         OR (NEW.status = 'shortlisted' AND OLD.status IN ('pending', 'maybe')) THEN
        -- The message this player already has for this application, if any.
        SELECT pn.metadata->>'status' INTO v_prev_status
          FROM public.profile_notifications pn
         WHERE pn.recipient_profile_id = NEW.applicant_id
           AND pn.kind = 'vacancy_application_status'
           AND pn.source_entity_id = NEW.id;

        -- Same message already delivered (e.g. rejected → pending → rejected): nothing new.
        IF v_prev_status IS DISTINCT FROM NEW.status::text THEN
          -- A club account as before; a coach's role names the organisation it
          -- recruits for (role_organisation), else the coach.
          IF v_publisher_role IS DISTINCT FROM 'club' THEN
            v_club_name := coalesce((SELECT ro.name FROM public.role_organisation(NEW.opportunity_id) ro), v_club_name);
          END IF;

          v_notification_id := public.enqueue_notification(
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

          -- The row is re-used per application: a new status must be emailable
          -- again, unless a batch still waiting to send already holds the row.
          IF v_notification_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM public.application_status_email_queue q
                              WHERE q.processed_at IS NULL
                                AND v_notification_id = ANY (q.notification_ids)) THEN
            UPDATE public.profile_notifications
               SET emailed_at = NULL
             WHERE id = v_notification_id
               AND emailed_at IS NOT NULL;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger function: fires as its owner whatever the grants; nobody calls it directly.
REVOKE ALL ON FUNCTION public.handle_opportunity_application_notifications() FROM PUBLIC, anon, authenticated;
