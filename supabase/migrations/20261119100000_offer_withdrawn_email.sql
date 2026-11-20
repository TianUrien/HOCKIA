-- A club withdrawing its offer also reaches the player by email
-- (founder decision 2026-11-19).
--
-- Since 20261118160000 an offer is emailed in the application-status batch,
-- but its withdrawal notified in the app and by push only: a player who read
-- the offer email and had push off could go on believing the offer was open.
--
-- The withdrawal joins the same batch (every 30 minutes, one email per player
-- per batch, same switch, same preference notify_applications).
--
-- It is emailed only when the offer itself was emailed. The notification row
-- is re-used per application, so emailed_at tells which case this is:
--   * emailed_at set   -> the offer went out by email: clear it, the
--                         withdrawal is picked by the next batch;
--   * emailed_at empty -> the offer was withdrawn before any batch picked it:
--                         mark it as handled, nothing is emailed about an
--                         offer the player never got by email;
--   * a batch waiting to send holds the row -> left alone; the edge function
--                         drops an offer that is no longer live.
--
-- Changes:
--   1. _recruiting_notify: the offer_withdrawn branch above.
--   2. enqueue_application_status_emails: also picks offer_withdrawn rows.
--
-- Not breaking: same signatures and grants, no table, RLS or grant changes.
-- Deploy notify-application-status BEFORE applying this (the old function
-- ignores withdrawal rows and would mark the batch processed without an email).
--
-- Rollback: supabase/rollbacks/20261119100000_offer_withdrawn_email.down.sql

CREATE OR REPLACE FUNCTION public._recruiting_notify(
  p_recipient uuid, p_actor uuid, p_source uuid, p_event text,
  p_title text, p_summary text, p_extra jsonb, p_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notification_id uuid;
BEGIN
  v_notification_id := public.enqueue_notification(
    p_recipient,
    p_actor,
    'recruiting_update'::public.profile_notification_kind,
    p_source,
    coalesce(p_extra, '{}'::jsonb) || jsonb_build_object(
      'event', p_event,
      'title', left(p_title, 200),
      'summary', left(p_summary, 300),
      'target_url', p_url),
    p_url);

  IF v_notification_id IS NULL
     OR p_event NOT IN ('offer_received', 'offer_withdrawn')
     -- never touch a row a batch waiting to send still holds
     OR EXISTS (SELECT 1 FROM public.application_status_email_queue q
                 WHERE q.processed_at IS NULL
                   AND v_notification_id = ANY (q.notification_ids)) THEN
    RETURN;
  END IF;

  IF p_event = 'offer_received' THEN
    -- A new or updated offer is emailed (enqueue_application_status_emails).
    UPDATE public.profile_notifications
       SET emailed_at = NULL
     WHERE id = v_notification_id
       AND emailed_at IS NOT NULL;
  ELSE
    -- A withdrawal is emailed only when the offer was (see the header).
    UPDATE public.profile_notifications
       SET emailed_at = CASE WHEN emailed_at IS NULL THEN timezone('utc', now()) END
     WHERE id = v_notification_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._recruiting_notify(uuid, uuid, uuid, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_application_status_emails()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_enabled boolean;
  v_batch_ts timestamptz := timezone('utc', now());
  v_user RECORD;
BEGIN
  SELECT s.status_emails_enabled INTO v_enabled FROM application_response_settings s;
  IF NOT coalesce(v_enabled, false) THEN
    RETURN;
  END IF;

  FOR v_user IN
    SELECT pn.recipient_profile_id AS user_id, array_agg(pn.id) AS notif_ids
    FROM profile_notifications pn
    JOIN profiles p ON p.id = pn.recipient_profile_id
    WHERE (
        (pn.kind = 'vacancy_application_status'
         AND pn.metadata->>'status' IN ('shortlisted', 'rejected'))
        -- a club's offer (new or updated) and its withdrawal; an answered or
        -- expired offer changes the row's event and is not picked
        OR (pn.kind = 'recruiting_update'
            AND pn.metadata->>'event' IN ('offer_received', 'offer_withdrawn'))
      )
      AND pn.emailed_at IS NULL
      -- never email legacy backlog rows on arming day
      AND pn.created_at > v_batch_ts - interval '7 days'
      AND p.notify_applications = true
      AND p.email IS NOT NULL
      AND (p.is_test_account = false OR public.is_staging_env())
    GROUP BY pn.recipient_profile_id
  LOOP
    INSERT INTO application_status_email_queue (recipient_id, batch_ts, notification_ids)
    VALUES (v_user.user_id, v_batch_ts, v_user.notif_ids);

    UPDATE profile_notifications
       SET emailed_at = v_batch_ts
     WHERE id = ANY (v_user.notif_ids);
  END LOOP;
END;
$function$;
