-- Task 3 — player status notifications + application auto-expiry.
--
-- 3a: the player-notification trigger already exists; the edit here REMOVES
--     'maybe' from its IN-list (player-side a "maybe" keeps showing "under
--     review" — a notification adds anxiety without value; it still counts as
--     a club response internally via application_status_history). Emails for
--     shortlisted/rejected ride a new emailed_at-scan pipeline (same shape as
--     the message digest).
-- 3b: daily sweep expires overdue pending applications to 'no_response',
--     clocked from GREATEST(applied_at, launch_date) — the pre-launch backlog
--     gets a full window after arming instead of expiring en masse. The sweep
--     OWNS its player notifications, batched per player ('applications_expired'
--     aggregate kind) — deliberately NOT added to the per-row trigger, so a
--     player with several applications expiring the same day (or the launch
--     backlog) never gets N separate notifications. History logging stays free
--     via trg_record_application_status_history (changed_via='auto_expiry').
--     Expiry includes applications on CLOSED opportunities (the player
--     deserves closure; the publisher can't meaningfully act).
--
-- Everything is deploy-dark: the sweep needs sweep_enabled + launch_date, and
-- status emails need the new status_emails_enabled flag.

-- ────────────────────────────────────────────────────────────────────
-- 3a. Trigger edit: 'maybe' no longer notifies the player
--     (body otherwise identical to the live 20260626150000 version —
--     including o.position in metadata; do not regress that field)
-- ────────────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────────────
-- Settings: separate deploy-dark switch for the 3a status emails
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.application_response_settings
  ADD COLUMN IF NOT EXISTS status_emails_enabled boolean NOT NULL DEFAULT false;

-- ────────────────────────────────────────────────────────────────────
-- Queues (service-role pipelines only)
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.application_expiry_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sweep_date date NOT NULL,
  application_ids uuid[] NOT NULL,
  batch_ts timestamptz NOT NULL DEFAULT timezone('utc', now()),
  processed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  -- one expiry email per player per sweep day, no matter how the sweep re-runs
  UNIQUE (applicant_id, sweep_date)
);
CREATE INDEX idx_application_expiry_queue_unprocessed
  ON public.application_expiry_queue (created_at) WHERE processed_at IS NULL;
ALTER TABLE public.application_expiry_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.application_expiry_queue FROM anon, authenticated;

CREATE TABLE public.application_status_email_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  batch_ts timestamptz NOT NULL DEFAULT timezone('utc', now()),
  notification_ids uuid[] NOT NULL,
  processed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX idx_application_status_email_queue_unprocessed
  ON public.application_status_email_queue (created_at) WHERE processed_at IS NULL;
ALTER TABLE public.application_status_email_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.application_status_email_queue FROM anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- Similar open opportunities (for the rejection + expiry emails)
-- ────────────────────────────────────────────────────────────────────
-- Hard filters lifted from check_application_eligibility (20260521160000) so
-- a suggestion can never be something the player couldn't apply to; soft
-- ranking = position match then recency, which IS the agreed fallback
-- (fewer than N good matches → newest open fill-ins, never forced bad ones).
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
-- 3b. Daily expiry sweep
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expire_overdue_applications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_launch timestamptz;
  v_days integer;
  v_enabled boolean;
  v_now timestamptz := timezone('utc', now());
  v_sweep_date date := (timezone('utc', now()))::date;
  r RECORD;
BEGIN
  SELECT s.launch_date, s.expiry_days, s.sweep_enabled
    INTO v_launch, v_days, v_enabled
  FROM application_response_settings s;

  -- Deploy-dark: both the switch AND an explicit launch_date are required.
  IF NOT coalesce(v_enabled, false) OR v_launch IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    WITH expired AS (
      -- Same write shape as triage (status + metadata in one UPDATE) so the
      -- history trigger records changed_via='auto_expiry'. The notification
      -- trigger stays silent for no_response, and clears the publisher's
      -- 'application received' bell. Closed opportunities included on purpose.
      UPDATE opportunity_applications a
         SET status = 'no_response',
             metadata = coalesce(a.metadata, '{}'::jsonb)
                        || jsonb_build_object('changed_via', 'auto_expiry')
       WHERE a.status = 'pending'
         AND GREATEST(a.applied_at, v_launch) + make_interval(days => v_days) < v_now
       RETURNING a.id, a.applicant_id, a.opportunity_id
    )
    SELECT e.applicant_id,
           array_agg(e.id) AS app_ids,
           array_agg(e.opportunity_id) AS opp_ids,
           (array_agg(e.id ORDER BY e.id))[1] AS anchor_id,
           count(*)::int AS n
    FROM expired e
    GROUP BY e.applicant_id
  LOOP
    -- Expiry itself applies to everyone (data correctness); player-facing
    -- notifications/emails only for real accounts (any account on staging).
    IF EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = r.applicant_id
        AND (p.is_test_account = false OR public.is_staging_env())
    ) THEN
      -- ONE aggregate in-app/push notification per player per sweep.
      PERFORM public.enqueue_notification(
        r.applicant_id,
        NULL,
        'applications_expired',
        r.anchor_id,
        jsonb_build_object(
          'application_ids', to_jsonb(r.app_ids),
          'opportunity_ids', to_jsonb(r.opp_ids),
          'count', r.n
        ),
        '/opportunities'
      );
      -- ONE email per player per sweep day (webhook drains the queue).
      INSERT INTO application_expiry_queue (applicant_id, sweep_date, application_ids)
      VALUES (r.applicant_id, v_sweep_date, r.app_ids)
      ON CONFLICT (applicant_id, sweep_date) DO NOTHING;
    END IF;
  END LOOP;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 3a. Status-change emails (shortlisted / rejected) — emailed_at scan,
--     same shape as enqueue_message_digests
-- ────────────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────────────
-- Cron: expiry daily 08:00 UTC (an hour before the Monday digest, so the
-- digest never lists applications the sweep just closed); status emails
-- every 30 minutes (message-digest cadence)
-- ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('application_expiry_daily');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN RAISE NOTICE 'Insufficient privilege to unschedule; continuing';
  WHEN others THEN RAISE NOTICE 'No prior application_expiry_daily schedule found';
END $$;
DO $$
BEGIN
  PERFORM cron.schedule('application_expiry_daily', '0 8 * * *',
    $cron$SELECT public.expire_overdue_applications();$cron$);
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('application_status_emails');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN RAISE NOTICE 'Insufficient privilege to unschedule; continuing';
  WHEN others THEN RAISE NOTICE 'No prior application_status_emails schedule found';
END $$;
DO $$
BEGIN
  PERFORM cron.schedule('application_status_emails', '*/30 * * * *',
    $cron$SELECT public.enqueue_application_status_emails();$cron$);
END $$;
