-- Rollback for 20261118160000_offer_email.sql: both functions as they were
-- (_recruiting_notify from 20260928120000, enqueue_application_status_emails
-- from 20260706090000). Offers stop being emailed. The emailed_at marks set
-- on existing offer notifications stay (nothing reads them after rollback).

CREATE OR REPLACE FUNCTION public._recruiting_notify(
  p_recipient uuid, p_actor uuid, p_source uuid, p_event text,
  p_title text, p_summary text, p_extra jsonb, p_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.enqueue_notification(
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
    WHERE pn.kind = 'vacancy_application_status'
      AND pn.emailed_at IS NULL
      -- never email legacy backlog rows on arming day
      AND pn.created_at > v_batch_ts - interval '7 days'
      AND pn.metadata->>'status' IN ('shortlisted', 'rejected')
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
