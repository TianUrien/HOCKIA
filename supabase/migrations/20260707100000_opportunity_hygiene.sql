-- ============================================================================
-- P2 — Opportunity inventory hygiene (Master Order v2, strategic addendum #3)
-- ============================================================================
-- Verified on prod 2026-07-06: 13 of 21 open opportunities have a past
-- application_deadline (62% of visible inventory is dead) and 79 of the 102
-- pending applications sit on them. New users would browse a graveyard and
-- apply into voids — feeding the exact silence the response loop exists to
-- kill.
--
-- This migration ships DARK (hygiene_enabled=false). Arming order agreed with
-- the founder: staging end-to-end validation → arm prod → 13 dead opps close
-- + publishers get a one-click renewal email → Monday Jul 13's first digest
-- asks clubs to triage LIVE inventory only.
--
-- Pieces:
--   1. hygiene_enabled flag (deploy-dark master switch, same pattern as
--      digest/sweep) + opportunities.auto_closed_at (distinguishes hygiene
--      closes from manual ones — a renew link must never reopen a listing
--      the publisher closed on purpose).
--   2. email_action_tokens learns action='renew' (action was the
--      application_status enum; becomes text + CHECK — safe, no tokens
--      have been minted yet) and an opportunity_id target.
--   3. opportunity_renewal_queue + close_expired_opportunities() daily cron.
--   4. apply_renewal_action(): atomic one-click renew (+30 days, reopen).
--   5. Deadline predicates added to similar_open_opportunities and
--      enqueue_application_digests — suggestions and digests must never
--      point at listings past their deadline, even mid-week between runs.
--
-- Stranded pending applications on auto-closed opportunities are NOT touched
-- here: per founder decision (2026-07-07), they ride the existing expiry
-- sweep's single Jul 20 grandfathered clock — one clock, one promise.

-- ────────────────────────────────────────────────────────────────────
-- 1. Flag + auto-close marker
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.application_response_settings
  ADD COLUMN IF NOT EXISTS hygiene_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS auto_closed_at timestamptz;

-- ────────────────────────────────────────────────────────────────────
-- 2. email_action_tokens: allow 'renew' targeting an opportunity
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.email_action_tokens
  DROP CONSTRAINT IF EXISTS email_action_tokens_action_check;
ALTER TABLE public.email_action_tokens
  ALTER COLUMN action TYPE text USING action::text,
  ALTER COLUMN application_id DROP NOT NULL,
  ADD COLUMN opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE CASCADE;
ALTER TABLE public.email_action_tokens
  ADD CONSTRAINT email_action_tokens_action_check CHECK (
    -- triage tokens act on an application; renew tokens act on an opportunity
    (action IN ('shortlisted', 'maybe', 'rejected')
       AND application_id IS NOT NULL AND opportunity_id IS NULL)
    OR
    (action = 'renew'
       AND opportunity_id IS NOT NULL AND application_id IS NULL)
  );
CREATE INDEX idx_email_action_tokens_opportunity
  ON public.email_action_tokens (opportunity_id) WHERE opportunity_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────
-- 3. Renewal email queue + daily closer
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.opportunity_renewal_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  publisher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sweep_date date NOT NULL DEFAULT (timezone('utc', now()))::date,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (opportunity_id, sweep_date)
);

ALTER TABLE public.opportunity_renewal_queue ENABLE ROW LEVEL SECURITY;
-- Service-role-only queue (drained by the notify-opportunity-renewal edge
-- fn via DB webhook); the default-privileges CRUD grant is revoked.
REVOKE ALL ON TABLE public.opportunity_renewal_queue FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.close_expired_opportunities()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := timezone('utc', now());
  v_closed integer := 0;
BEGIN
  -- Deploy-dark master switch.
  IF NOT EXISTS (SELECT 1 FROM application_response_settings WHERE hygiene_enabled) THEN
    RETURN 0;
  END IF;

  -- The deadline DAY itself is still live; closure happens the day after.
  -- cleanup_feed_on_opportunity_close fires on this UPDATE — feed stays
  -- consistent for free. auto_closed_at marks this as a hygiene close so the
  -- renew link knows it may reopen.
  WITH closed AS (
    UPDATE opportunities o
       SET status = 'closed',
           closed_at = v_now,
           auto_closed_at = v_now,
           updated_at = v_now
     WHERE o.status = 'open'
       AND o.application_deadline < (v_now)::date
     RETURNING o.id, o.club_id
  ), queued AS (
    -- Renewal email is OPERATIONAL (the publisher's own listing went
    -- offline), so it is not gated on notify_applications — only on having
    -- an email and the standard test-account rule.
    INSERT INTO opportunity_renewal_queue (opportunity_id, publisher_id)
    SELECT c.id, c.club_id
    FROM closed c
    JOIN profiles p ON p.id = c.club_id
    WHERE p.email IS NOT NULL
      AND (p.is_test_account = false OR public.is_staging_env())
    ON CONFLICT (opportunity_id, sweep_date) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_closed FROM closed;

  RETURN v_closed;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.close_expired_opportunities() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_expired_opportunities() TO service_role;

-- ────────────────────────────────────────────────────────────────────
-- 4. Atomic one-click renewal (mirror of apply_email_action's shape:
--    validation → mutation → token burn under one row lock)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_renewal_action(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_token RECORD;
  v_opp RECORD;
  v_new_deadline date;
BEGIN
  SELECT t.id, t.opportunity_id, t.expires_at, t.used_at
    INTO v_token
    FROM email_action_tokens t
   WHERE t.token_hash = p_token_hash
     AND t.action = 'renew'
   FOR UPDATE;

  IF v_token IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  SELECT o.id, o.title, o.status, o.application_deadline, o.auto_closed_at
    INTO v_opp
    FROM opportunities o
   WHERE o.id = v_token.opportunity_id
   FOR UPDATE;

  IF v_opp IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  IF v_token.used_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'used', 'action', 'renew',
      'opportunity_id', v_opp.id, 'opportunity_title', v_opp.title
    );
  END IF;

  IF v_token.expires_at < timezone('utc', now()) THEN
    RETURN jsonb_build_object(
      'outcome', 'expired', 'action', 'renew',
      'opportunity_id', v_opp.id, 'opportunity_title', v_opp.title
    );
  END IF;

  -- A manually closed (or never-published) listing is the publisher's
  -- explicit intent — a renew link never overrides it. No-op, token kept.
  IF v_opp.status <> 'open' AND v_opp.auto_closed_at IS NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'closed_by_publisher', 'action', 'renew',
      'opportunity_id', v_opp.id, 'opportunity_title', v_opp.title
    );
  END IF;

  -- Renew = 30 fresh days from today (never shortens an already-later
  -- deadline if the listing is still open).
  v_new_deadline := greatest(coalesce(v_opp.application_deadline, (timezone('utc', now()))::date),
                             (timezone('utc', now()))::date + 30);

  UPDATE opportunities
     SET status = 'open',
         application_deadline = v_new_deadline,
         closed_at = NULL,
         auto_closed_at = NULL,
         updated_at = timezone('utc', now())
   WHERE id = v_opp.id;

  UPDATE email_action_tokens
     SET used_at = timezone('utc', now())
   WHERE id = v_token.id;

  RETURN jsonb_build_object(
    'outcome', 'renewed', 'action', 'renew',
    'opportunity_id', v_opp.id, 'opportunity_title', v_opp.title,
    'new_deadline', v_new_deadline
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.apply_renewal_action(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_renewal_action(text) TO service_role;

-- ────────────────────────────────────────────────────────────────────
-- 5a. similar_open_opportunities: never suggest a listing past its deadline
--     (body identical to 20260706090000 plus the deadline predicate)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.similar_open_opportunities(
  p_applicant uuid,
  p_exclude uuid[] DEFAULT '{}',
  p_limit integer DEFAULT 3
)
RETURNS TABLE (
  opportunity_id uuid,
  title text,
  position_text text,
  opportunity_type text,
  gender text,
  location_city text,
  location_country text,
  publisher_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_gender text;
  v_position text;
  v_nat1 integer;
  v_nat2 integer;
  v_norm text;
  v_nat_count int;
  v_eu_count int;
  v_non_eu_only boolean;
  -- EU member state ISO codes — mirrors check_application_eligibility.
  v_eu_codes text[] := ARRAY[
    'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE',
    'IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'
  ];
BEGIN
  SELECT p.role::text, p.gender, p.position, p.nationality_country_id, p.nationality2_country_id
    INTO v_role, v_gender, v_position, v_nat1, v_nat2
  FROM profiles p WHERE p.id = p_applicant;
  IF v_role IS NULL THEN RETURN; END IF;

  v_norm := lower(trim(coalesce(v_gender, '')));
  SELECT count(*), count(*) FILTER (WHERE c.code = ANY (v_eu_codes))
    INTO v_nat_count, v_eu_count
  FROM countries c WHERE c.id = v_nat1 OR c.id = v_nat2;
  v_non_eu_only := (v_nat_count > 0 AND v_eu_count = 0);

  RETURN QUERY
  SELECT o.id, o.title, o.position::text, o.opportunity_type::text, o.gender::text,
         o.location_city, o.location_country, pub.full_name
  FROM opportunities o
  JOIN profiles pub ON pub.id = o.club_id
  WHERE o.status = 'open'
    -- Inventory hygiene: a past-deadline listing is dead even while the
    -- daily closer hasn't caught it yet — never suggest applying into a void.
    AND (o.application_deadline IS NULL OR o.application_deadline >= (timezone('utc', now()))::date)
    AND (pub.is_test_account = false OR public.is_staging_env())
    AND o.id <> ALL (coalesce(p_exclude, '{}'::uuid[]))
    AND NOT EXISTS (
      SELECT 1 FROM opportunity_applications a
      WHERE a.opportunity_id = o.id AND a.applicant_id = p_applicant
    )
    AND o.opportunity_type::text = CASE WHEN v_role = 'coach' THEN 'coach' ELSE 'player' END
    AND NOT (o.eu_passport_required IS TRUE AND v_non_eu_only)
    AND NOT (o.opportunity_type = 'player' AND o.gender IN ('Women', 'Girls')
             AND v_norm IN ('men', 'man', 'male'))
    AND NOT (o.opportunity_type = 'player' AND o.gender IN ('Men', 'Boys')
             AND v_norm IN ('women', 'woman', 'female'))
  ORDER BY
    (CASE WHEN v_position IS NOT NULL AND o.position::text = v_position THEN 1 ELSE 0 END) DESC,
    coalesce(o.published_at, o.created_at) DESC
  LIMIT greatest(1, least(p_limit, 5));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.similar_open_opportunities(uuid, uuid[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.similar_open_opportunities(uuid, uuid[], integer) TO service_role;

-- ────────────────────────────────────────────────────────────────────
-- 5b. enqueue_application_digests: same defense-in-depth deadline predicate
--     (body identical to 20260701223000 plus the predicate)
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
      -- Inventory hygiene defense-in-depth: even if the daily closer hasn't
      -- run (or is disabled), the digest never asks a publisher to triage
      -- applications on a listing past its deadline.
      AND (o.application_deadline IS NULL OR o.application_deadline >= (timezone('utc', now()))::date)
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
-- 6. Cron: daily 07:30 UTC — before the 08:00 expiry sweep and the Monday
--    09:00 digest enqueue, so both always see post-hygiene inventory.
-- ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('opportunity_hygiene_daily');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN RAISE NOTICE 'Insufficient privilege to unschedule; continuing';
  WHEN others THEN RAISE NOTICE 'No prior opportunity_hygiene_daily schedule found';
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'opportunity_hygiene_daily',
    '30 7 * * *',
    $cron$SELECT public.close_expired_opportunities();$cron$
  );
END $$;
