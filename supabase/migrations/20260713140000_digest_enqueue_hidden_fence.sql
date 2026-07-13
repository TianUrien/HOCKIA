-- Follow-up from the 2026-07-13 digest checkpoint: enqueue_application_digests
-- counted pending applications WITHOUT the hidden-applicant fence — a banned/
-- frozen applicant would be counted in (and named by) a club's digest email.
-- Live-verified zero exposure at re-enable time; this closes the gap per the
-- standing invariant (digests count people → hidden rows excluded from the
-- count). Also fences hidden PUBLISHERS (a banned club shouldn't be emailed).
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

-- Self-check: both fences present in the live body.
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.enqueue_application_digests()'::regprocedure);
  IF position('profile_is_hidden(ap.is_blocked' in v_def) = 0
     OR position('profile_is_hidden(p.is_blocked' in v_def) = 0 THEN
    RAISE EXCEPTION 'DIGEST-FENCE-CHECK: hidden fences missing';
  END IF;
END $$;
