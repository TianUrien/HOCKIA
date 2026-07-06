-- Task 1 — weekly "pending applications" digest to publishers.
--
-- Pipeline (canonical cron→queue→webhook→edge-fn shape, same as the message
-- digest): pg_cron Monday 09:00 UTC → enqueue_application_digests() → INSERT
-- into application_digest_queue → DB webhook → notify-application-digest edge
-- fn (renders email, mints action tokens at SEND time, sendTrackedEmail).
-- The one-click buttons hit the application-action edge fn, which calls
-- apply_email_action() below — a single atomic statement chain so a stale or
-- double-clicked link can never overwrite in-app triage (status='pending'
-- precondition) or reuse a token (row lock + used_at).

-- ────────────────────────────────────────────────────────────────────
-- Queue
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.application_digest_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Monday of the digest week; the UNIQUE pair makes enqueue re-runs within
  -- the same week no-ops (cron overlap / manual re-run safe).
  week_start date NOT NULL,
  application_ids uuid[] NOT NULL,
  batch_ts timestamptz NOT NULL DEFAULT timezone('utc', now()),
  processed_at timestamptz,
  -- Unlike the fire-and-forget digests, a dropped send here loses a whole
  -- week of triage prompts — record failures for manual redrive.
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (publisher_id, week_start)
);

CREATE INDEX idx_application_digest_queue_unprocessed
  ON public.application_digest_queue (created_at)
  WHERE processed_at IS NULL;

ALTER TABLE public.application_digest_queue ENABLE ROW LEVEL SECURITY;
-- Service-role pipeline only.
REVOKE ALL ON TABLE public.application_digest_queue FROM anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- Weekly enqueue
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_application_digests()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_week_start date := date_trunc('week', timezone('utc', now()))::date;
  v_pub RECORD;
BEGIN
  -- Deploy-dark master switch (application_response_settings is single-row).
  IF NOT EXISTS (SELECT 1 FROM application_response_settings WHERE digest_enabled) THEN
    RETURN;
  END IF;

  FOR v_pub IN
    SELECT
      o.club_id AS publisher_id,
      array_agg(a.id ORDER BY a.applied_at) AS app_ids
    FROM opportunity_applications a
    JOIN opportunities o ON o.id = a.opportunity_id
    JOIN profiles p ON p.id = o.club_id
    WHERE a.status = 'pending'
      -- Closed opportunities are excluded: the publisher can't meaningfully
      -- triage them (their pending apps end via the expiry sweep instead).
      AND o.status = 'open'
      AND p.notify_applications = true
      AND p.email IS NOT NULL
      -- Test accounts are eligible ONLY on staging so the digest is QA-able
      -- there; EMAIL_ALLOWED_RECIPIENTS still gates actual delivery.
      AND (p.is_test_account = false OR public.is_staging_env())
    GROUP BY o.club_id
  LOOP
    INSERT INTO application_digest_queue (publisher_id, week_start, application_ids)
    VALUES (v_pub.publisher_id, v_week_start, v_pub.app_ids)
    ON CONFLICT (publisher_id, week_start) DO NOTHING;
  END LOOP;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- Atomic one-click action executor (called by the application-action edge fn
-- with the SHA-256 hash of the link token)
-- ────────────────────────────────────────────────────────────────────
-- Single function so validation → status change → token burn happen under
-- one row lock: concurrent clicks on the same link serialize on FOR UPDATE,
-- and the status='pending' precondition means a link can only ever perform
-- FIRST-TOUCH triage — it can never overwrite something the publisher (or
-- the expiry sweep) already decided. Returns an outcome + display fields for
-- the confirmation page.
CREATE OR REPLACE FUNCTION public.apply_email_action(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_token RECORD;
  v_app RECORD;
  v_updated integer;
BEGIN
  SELECT t.id, t.application_id, t.action, t.publisher_id, t.expires_at, t.used_at
    INTO v_token
    FROM email_action_tokens t
   WHERE t.token_hash = p_token_hash
   FOR UPDATE;

  IF v_token IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  -- Display context (needed by every page, including the failure ones).
  SELECT a.id, a.status, a.opportunity_id, o.title AS opportunity_title,
         p.full_name AS applicant_name
    INTO v_app
    FROM opportunity_applications a
    JOIN opportunities o ON o.id = a.opportunity_id
    JOIN profiles p ON p.id = a.applicant_id
   WHERE a.id = v_token.application_id;

  IF v_app IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  IF v_token.used_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'used',
      'action', v_token.action,
      'applicant_name', v_app.applicant_name,
      'opportunity_id', v_app.opportunity_id,
      'opportunity_title', v_app.opportunity_title
    );
  END IF;

  IF v_token.expires_at < timezone('utc', now()) THEN
    RETURN jsonb_build_object(
      'outcome', 'expired',
      'action', v_token.action,
      'applicant_name', v_app.applicant_name,
      'opportunity_id', v_app.opportunity_id,
      'opportunity_title', v_app.opportunity_title
    );
  END IF;

  IF v_app.status <> 'pending' THEN
    RETURN jsonb_build_object(
      'outcome', 'already_handled',
      'action', v_token.action,
      'current_status', v_app.status,
      'applicant_name', v_app.applicant_name,
      'opportunity_id', v_app.opportunity_id,
      'opportunity_title', v_app.opportunity_title
    );
  END IF;

  -- The same write shape as in-app triage (status + metadata in ONE update)
  -- so the history trigger records reason/changed_via and the notification
  -- trigger notifies the applicant exactly as if triaged in the app.
  UPDATE opportunity_applications
     SET status = v_token.action,
         metadata = COALESCE(metadata, '{}'::jsonb)
                    || jsonb_build_object('changed_via', 'email_action')
   WHERE id = v_token.application_id
     AND status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    -- Raced an in-app triage between the SELECT and the UPDATE.
    RETURN jsonb_build_object(
      'outcome', 'already_handled',
      'action', v_token.action,
      'applicant_name', v_app.applicant_name,
      'opportunity_id', v_app.opportunity_id,
      'opportunity_title', v_app.opportunity_title
    );
  END IF;

  UPDATE email_action_tokens
     SET used_at = timezone('utc', now())
   WHERE id = v_token.id;

  RETURN jsonb_build_object(
    'outcome', 'applied',
    'action', v_token.action,
    'applicant_name', v_app.applicant_name,
    'opportunity_id', v_app.opportunity_id,
    'opportunity_title', v_app.opportunity_title
  );
END;
$function$;

-- Only the service-role edge function may execute email actions.
REVOKE EXECUTE ON FUNCTION public.apply_email_action(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_email_action(text) TO service_role;

-- ────────────────────────────────────────────────────────────────────
-- Cron: Mondays 09:00 UTC (morning in Europe, early morning Argentina)
-- ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Idempotent: cron.schedule is not idempotent on jobname.
  PERFORM cron.unschedule('application_digest_weekly');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Insufficient privilege to unschedule existing cron job; continuing';
  WHEN others THEN
    RAISE NOTICE 'No prior application_digest_weekly schedule found';
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'application_digest_weekly',
    '0 9 * * 1',
    $cron$SELECT public.enqueue_application_digests();$cron$
  );
END $$;
