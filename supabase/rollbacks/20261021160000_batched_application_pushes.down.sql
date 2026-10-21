-- Rollback for 20261021160000_batched_application_pushes.sql
-- Restores the B2 bodies (20261009100000_b2_club_reminders.sql) and drops the
-- switch. In a live project clear the switch first, so send-push resumes the
-- immediate push before the column disappears:
--   UPDATE public.application_response_settings SET batched_application_pushes_since = NULL;

CREATE OR REPLACE FUNCTION public.club_reminder_candidates(
  p_mode text,
  p_now  timestamptz DEFAULT timezone('utc', now())
)
RETURNS TABLE (
  publisher_id                   uuid,
  publisher_email                text,
  publisher_full_name            text,
  publisher_role                 text,
  publisher_country_code         text,
  publisher_notify_applications  boolean,
  answered_last_24h              boolean,
  last_reminder_email_date       date,
  last_reminder_push_date        date,
  last_new_applications_email_at timestamptz,
  application_id                 uuid,
  opportunity_id                 uuid,
  role_title                     text,
  role_position                  text,
  org_name                       text,
  applicant_id                   uuid,
  applicant_full_name            text,
  applicant_avatar_url           text,
  applicant_role                 text,
  applicant_position             text,
  applicant_country              text,
  applicant_is_blocked           boolean,
  applicant_frozen_minor_at      timestamptz,
  applicant_known_minor          boolean,
  applied_at                     timestamptz,
  closes_at                      timestamptz,
  fit_state                      text,
  email_closing_soon_logged      boolean,
  email_last_call_logged         boolean,
  push_closing_soon_logged       boolean,
  push_last_call_logged          boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_launch   timestamptz;
  v_days     integer;
  v_sweep    boolean;
  v_on       boolean;
  v_since    timestamptz;
  v_claims   text := current_setting('request.jwt.claims', true);
  v_sub      text := current_setting('request.jwt.claim.sub', true);
  v_pub      uuid;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('reminders', 'new_applications') THEN
    RAISE EXCEPTION 'Unknown mode' USING ERRCODE = '22023';
  END IF;

  SELECT s.launch_date, s.expiry_days, s.sweep_enabled, s.club_reminders_enabled, s.batched_application_emails_since
    INTO v_launch, v_days, v_sweep, v_on, v_since
    FROM public.application_response_settings s
   LIMIT 1;

  IF p_mode = 'reminders' AND NOT (coalesce(v_on, false) AND coalesce(v_sweep, false) AND v_launch IS NOT NULL) THEN
    RETURN;
  END IF;
  IF p_mode = 'new_applications' AND v_since IS NULL THEN
    RETURN;
  END IF;

  FOR v_pub IN
    SELECT DISTINCT o.club_id
      FROM public.opportunity_applications a
      JOIN public.opportunities o ON o.id = a.opportunity_id
      JOIN public.profiles pub    ON pub.id = o.club_id
      JOIN public.profiles ap     ON ap.id = a.applicant_id
     WHERE a.status = 'pending'
       AND pub.role IN ('club', 'coach')
       AND pub.onboarding_completed = true
       AND NOT public.profile_is_hidden(pub.is_blocked, pub.frozen_minor_at)
       AND (pub.is_test_account = false OR public.is_staging_env())
       AND NOT public.profile_is_hidden(ap.is_blocked, ap.frozen_minor_at)
       AND NOT (ap.date_of_birth IS NOT NULL AND NOT public.profile_is_adult(ap.date_of_birth))
       AND (ap.is_test_account = false OR public.is_staging_env())
       AND NOT public.is_blocked_pair(o.club_id, a.applicant_id)
       AND CASE p_mode
             WHEN 'reminders' THEN
               o.status = 'open'
               AND v_launch IS NOT NULL
               AND (date_trunc('day', (greatest(a.applied_at, v_launch) + make_interval(days => v_days)) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
                    + interval '8 hours') < p_now + interval '7 days'
             ELSE
               a.applied_at >= v_since
               AND a.applied_at >= p_now - interval '7 days'
               AND pub.email IS NOT NULL
               AND pub.notify_applications IS DISTINCT FROM false
               AND NOT EXISTS (SELECT 1 FROM public.club_reminder_log l
                                WHERE l.application_id = a.id AND l.kind = 'new_application' AND l.channel = 'email')
           END
  LOOP
    -- compute_club_fit answers only "auth.uid() = owner and a recruiter".
    -- Transaction-local; restored after the loop.
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_pub, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_pub::text, true);

    RETURN QUERY
    WITH pend AS (
      SELECT a.id AS app_id, a.opportunity_id AS opp_id, a.applicant_id AS ap_id, a.applied_at AS applied,
             o.title, o.position::text AS opp_position, o.gender::text AS opp_gender,
             CASE WHEN v_launch IS NULL THEN NULL ELSE
               (SELECT CASE WHEN t08 > d THEN t08 ELSE t08 + interval '1 day' END
                  FROM (SELECT d, (date_trunc('day', d AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') + interval '8 hours' AS t08
                          FROM (SELECT greatest(a.applied_at, v_launch) + make_interval(days => v_days) AS d) dd) x)
             END AS close_at
        FROM public.opportunity_applications a
        JOIN public.opportunities o ON o.id = a.opportunity_id
        JOIN public.profiles ap     ON ap.id = a.applicant_id
       WHERE o.club_id = v_pub
         AND a.status = 'pending'
         AND NOT public.profile_is_hidden(ap.is_blocked, ap.frozen_minor_at)
         AND NOT (ap.date_of_birth IS NOT NULL AND NOT public.profile_is_adult(ap.date_of_birth))
         AND (ap.is_test_account = false OR public.is_staging_env())
         AND NOT public.is_blocked_pair(o.club_id, a.applicant_id)
         AND CASE p_mode
               WHEN 'reminders' THEN o.status = 'open'
               ELSE a.applied_at >= v_since
                    AND a.applied_at >= p_now - interval '7 days'
                    AND NOT EXISTS (SELECT 1 FROM public.club_reminder_log l
                                     WHERE l.application_id = a.id AND l.kind = 'new_application' AND l.channel = 'email')
             END
    )
    -- Explicit casts: RETURN QUERY needs the exact declared types (varchar ≠ text).
    SELECT
      pub.id,
      pub.email::text,
      pub.full_name::text,
      pub.role::text,
      coalesce(bc.code, nc.code)::text,
      pub.notify_applications::boolean,
      EXISTS (
        SELECT 1
          FROM public.application_status_history h
          JOIN public.opportunity_applications a2 ON a2.id = h.application_id
          JOIN public.opportunities o2 ON o2.id = a2.opportunity_id
         WHERE o2.club_id = v_pub
           AND h.created_at > p_now - interval '24 hours'
           AND h.old_status = 'pending'
           AND h.new_status NOT IN ('pending', 'no_response', 'withdrawn')
      ),
      (SELECT max(b.local_date) FROM public.club_reminder_batches b
        WHERE b.publisher_id = v_pub AND b.channel = 'email' AND b.batch_kind = 'reminder'),
      (SELECT max(b.local_date) FROM public.club_reminder_batches b
        WHERE b.publisher_id = v_pub AND b.channel = 'push' AND b.batch_kind = 'reminder'),
      (SELECT max(b.created_at) FROM public.club_reminder_batches b
        WHERE b.publisher_id = v_pub AND b.channel = 'email' AND b.batch_kind = 'new_applications'),
      r.app_id,
      r.opp_id,
      r.title::text,
      r.opp_position,
      coalesce((SELECT ro.name FROM public.role_organisation(r.opp_id) ro),
               CASE WHEN pub.role = 'club' THEN pub.full_name END)::text,
      ap.id,
      ap.full_name::text,
      ap.avatar_url::text,
      ap.role::text,
      ap.position::text,
      coalesce(apc.common_name, apc.name, apb.common_name, apb.name)::text,
      ap.is_blocked::boolean,
      ap.frozen_minor_at::timestamptz,
      (ap.date_of_birth IS NOT NULL AND NOT public.profile_is_adult(ap.date_of_birth)),
      r.applied::timestamptz,
      r.close_at::timestamptz,
      fit.state::text,
      EXISTS (SELECT 1 FROM public.club_reminder_log l WHERE l.application_id = r.app_id AND l.kind = 'closing_soon' AND l.channel = 'email'),
      EXISTS (SELECT 1 FROM public.club_reminder_log l WHERE l.application_id = r.app_id AND l.kind = 'last_call'    AND l.channel = 'email'),
      EXISTS (SELECT 1 FROM public.club_reminder_log l WHERE l.application_id = r.app_id AND l.kind = 'closing_soon' AND l.channel = 'push'),
      EXISTS (SELECT 1 FROM public.club_reminder_log l WHERE l.application_id = r.app_id AND l.kind = 'last_call'    AND l.channel = 'push')
    FROM pend r
    JOIN public.profiles pub ON pub.id = v_pub
    JOIN public.profiles ap  ON ap.id = r.ap_id
    LEFT JOIN public.countries bc  ON bc.id = pub.base_country_id
    LEFT JOIN public.countries nc  ON nc.id = pub.nationality_country_id
    LEFT JOIN public.countries apc ON apc.id = ap.nationality_country_id
    LEFT JOIN public.countries apb ON apb.id = ap.base_country_id
    LEFT JOIN LATERAL (
      SELECT f.state
        FROM public.compute_club_fit(
               v_pub, r.ap_id,
               CASE lower(coalesce(r.opp_gender, ''))
                 WHEN 'men' THEN 'Men' WHEN 'boys' THEN 'Men'
                 WHEN 'women' THEN 'Women' WHEN 'girls' THEN 'Women'
                 WHEN 'mixed' THEN 'Mixed'
               END,
               NULL, r.opp_id) f
       WHERE r.opp_gender IS NOT NULL
       LIMIT 1
    ) fit ON true
    ORDER BY r.close_at NULLS LAST, r.applied;
  END LOOP;

  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
END;
$$;

CREATE OR REPLACE FUNCTION public.club_reminder_claim(
  p_publisher_id uuid,
  p_channel      text,
  p_batch_kind   text,
  p_local_date   date,
  p_items        jsonb,
  p_notification jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch uuid;
  v_n     integer;
  v_kind  text;
BEGIN
  IF p_publisher_id IS NULL OR p_local_date IS NULL
     OR p_channel NOT IN ('email', 'push')
     OR p_batch_kind NOT IN ('new_applications', 'reminder')
     OR p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Invalid claim' USING ERRCODE = '22023';
  END IF;
  IF p_batch_kind = 'new_applications' AND p_channel <> 'email' THEN
    RAISE EXCEPTION 'New applications are emailed only' USING ERRCODE = '22023';
  END IF;
  IF p_notification IS NOT NULL THEN
    v_kind := p_notification->>'kind';
    IF p_channel <> 'push' OR v_kind IS NULL OR v_kind NOT IN ('applicants_closing_soon', 'applicant_last_call') THEN
      RAISE EXCEPTION 'Invalid notification' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Serialise claims per publisher (two overlapping runs cannot both send).
  PERFORM pg_advisory_xact_lock(hashtextextended('club_reminder:' || p_publisher_id::text, 0));

  IF p_batch_kind = 'new_applications' AND EXISTS (
       SELECT 1 FROM public.club_reminder_batches b
        WHERE b.publisher_id = p_publisher_id AND b.channel = 'email' AND b.batch_kind = 'new_applications'
          AND b.created_at > timezone('utc', now()) - interval '60 minutes') THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.club_reminder_batches (publisher_id, channel, batch_kind, local_date)
  VALUES (p_publisher_id, p_channel, p_batch_kind, p_local_date)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_batch;
  IF v_batch IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.club_reminder_log (batch_id, publisher_id, application_id, kind, channel, outcome, sent_on_local_date)
  SELECT v_batch, p_publisher_id, a.id, i.kind, p_channel, 'sent', p_local_date
    FROM jsonb_to_recordset(p_items) AS i(application_id uuid, kind text)
    JOIN public.opportunity_applications a ON a.id = i.application_id AND a.status = 'pending'
    JOIN public.opportunities o ON o.id = a.opportunity_id AND o.club_id = p_publisher_id
   WHERE i.kind IN ('new_application', 'closing_soon', 'last_call')
     AND (i.kind = 'new_application') = (p_batch_kind = 'new_applications')
  ON CONFLICT (application_id, kind, channel) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    DELETE FROM public.club_reminder_batches WHERE id = v_batch;
    RETURN NULL;
  END IF;

  UPDATE public.club_reminder_batches SET item_count = v_n WHERE id = v_batch;

  IF p_notification IS NOT NULL THEN
    PERFORM public.enqueue_notification(
      p_publisher_id,
      nullif(p_notification->>'actor_id', '')::uuid,
      v_kind::public.profile_notification_kind,
      p_publisher_id,
      coalesce(p_notification->'metadata', '{}'::jsonb),
      p_notification->>'target_url'
    );
    UPDATE public.club_reminder_batches
       SET status = 'sent', sent_at = timezone('utc', now())
     WHERE id = v_batch;
  END IF;

  RETURN v_batch;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_club_reminders(p_mode text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_on    boolean;
  v_since timestamptz;
  v_url   text;
  v_key   text;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('reminders', 'new_applications') THEN
    RAISE EXCEPTION 'Unknown mode' USING ERRCODE = '22023';
  END IF;

  SELECT s.club_reminders_enabled, s.batched_application_emails_since
    INTO v_on, v_since
    FROM public.application_response_settings s
   LIMIT 1;
  IF p_mode = 'reminders' AND NOT coalesce(v_on, false) THEN
    RETURN;
  END IF;
  IF p_mode = 'new_applications' AND v_since IS NULL THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_project_url' ORDER BY created_at DESC LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key' ORDER BY created_at DESC LIMIT 1;
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'club-reminders skipped: vault secrets supabase_project_url / supabase_service_role_key not set';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := rtrim(v_url, '/') || '/functions/v1/club-reminders',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body    := jsonb_build_object('mode', p_mode),
    timeout_milliseconds := 120000
  );
END;
$$;

DELETE FROM public.club_reminder_batches WHERE batch_kind = 'new_applications' AND channel = 'push';
DELETE FROM public.club_reminder_log WHERE kind = 'new_application' AND channel = 'push';

ALTER TABLE public.application_response_settings
  DROP COLUMN IF EXISTS batched_application_pushes_since;
