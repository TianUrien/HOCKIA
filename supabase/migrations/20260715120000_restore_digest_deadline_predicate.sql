-- M7 — restore the application_deadline predicate to enqueue_application_digests.
--
-- 20260707100000_opportunity_hygiene added a defense-in-depth predicate
-- (application_deadline IS NULL OR >= today) so that, even if the daily closer
-- (close_expired_opportunities) lags or hygiene_enabled is false, the weekly
-- digest never nags a publisher to triage applications on a deadline-passed
-- role. The later 20260713140000_digest_enqueue_hidden_fence rewrote this
-- function from the pre-hygiene body to add the hidden fences and silently
-- dropped the deadline predicate. Live-verified: prod carries the hidden
-- fences but not the deadline predicate (current exposure 0 — hygiene is on
-- and there are 0 open past-deadline rows — but the belt-and-suspenders guard
-- is gone). This restores it alongside the fences and adds a self-check so the
-- next rebase-from-stale-base fails loudly instead of dropping it again.

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
    JOIN profiles ap ON ap.id = a.applicant_id
    WHERE a.status = 'pending'
      -- Closed opportunities are excluded: the publisher can't meaningfully
      -- triage them (their pending apps end via the expiry sweep instead).
      AND o.status = 'open'
      -- Defense-in-depth: even if the daily closer lags or is disabled, never
      -- ask a publisher to triage applications on a deadline-passed role.
      AND (o.application_deadline IS NULL OR o.application_deadline >= now()::date)
      AND p.notify_applications = true
      AND p.email IS NOT NULL
      -- Test accounts are eligible ONLY on staging so the digest is QA-able
      -- there; EMAIL_ALLOWED_RECIPIENTS still gates actual delivery.
      AND (p.is_test_account = false OR public.is_staging_env())
      -- Hidden-profile invariant: hidden applicants never counted/named,
      -- hidden publishers never emailed.
      AND NOT public.profile_is_hidden(ap.is_blocked, ap.frozen_minor_at)
      AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    GROUP BY o.club_id
  LOOP
    INSERT INTO application_digest_queue (publisher_id, week_start, application_ids)
    VALUES (v_pub.publisher_id, v_week_start, v_pub.app_ids)
    ON CONFLICT (publisher_id, week_start) DO NOTHING;
  END LOOP;
END;
$function$;

-- Regression guard: assert both the deadline predicate AND the hidden fence
-- survive in the deployed body. A future CREATE OR REPLACE rebased from an
-- older copy that drops either one will fail THIS migration on replay and,
-- more importantly, documents the contract for the next editor.
DO $$
DECLARE
  v_body text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_body
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'enqueue_application_digests';

  IF v_body IS NULL OR position('application_deadline' IN v_body) = 0 THEN
    RAISE EXCEPTION 'enqueue_application_digests is missing the application_deadline predicate (rebase-from-stale-base regression guard)';
  END IF;
  IF position('profile_is_hidden' IN v_body) = 0 THEN
    RAISE EXCEPTION 'enqueue_application_digests is missing the profile_is_hidden fence';
  END IF;
END $$;
