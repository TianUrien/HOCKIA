-- Rollback for 20261119100000_offer_withdrawn_email.sql: both functions as
-- 20261118160000_offer_email.sql left them. Offer withdrawals stop being
-- emailed; offers keep being emailed.

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

  -- A new or updated offer is emailed (enqueue_application_status_emails).
  IF p_event = 'offer_received'
     AND v_notification_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.application_status_email_queue q
                      WHERE q.processed_at IS NULL
                        AND v_notification_id = ANY (q.notification_ids)) THEN
    UPDATE public.profile_notifications
       SET emailed_at = NULL
     WHERE id = v_notification_id
       AND emailed_at IS NOT NULL;
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
        -- a club's offer (new or updated); withdrawn or answered offers
        -- change the row's event and are not picked
        OR (pn.kind = 'recruiting_update'
            AND pn.metadata->>'event' = 'offer_received')
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
