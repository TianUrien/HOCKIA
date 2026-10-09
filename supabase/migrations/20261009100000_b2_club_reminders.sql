-- =========================================================================
-- B2 · Club reminders
-- =========================================================================
-- Founder spec: Figma New-Hockia Backlog 406:19 and schedule 386:618, plus the
-- rulings of 9 Oct 2026. Publishers (clubs, and coaches who recruit and own
-- roles) get:
--   * NEW APPLICATION email, batched: at most one per hour per publisher,
--     listing every application since the last one. Replaces the immediate
--     per-application email of notify-application (which now stands down once
--     batched_application_emails_since is set). The push on
--     vacancy_application_received is unchanged.
--   * DAY 10 "Closing soon" (4 days left) and DAY 13 "Last call" (1 day left):
--     at 09:00 in the publisher's country timezone, at most ONE reminder email
--     per publisher per local day (both combine, Last call first), plus one
--     push (two new notification kinds below).
--   * DAY 14: closes as no reply — expire_overdue_applications is NOT changed.
-- The timing and copy rules live in supabase/functions/_shared/club-reminders.ts
-- (tested); this migration owns the data, the fences and the idempotency.
--
-- What ships here:
--   1. profile_notification_kind + 'applicants_closing_soon', 'applicant_last_call'.
--      Not used by any statement in this file (a new enum value cannot be used
--      in the transaction that adds it); only inside function bodies at run time.
--   2. application_response_settings + club_reminders_enabled (default false)
--      and batched_application_emails_since (default NULL). Both deploy-dark.
--   3. club_reminder_batches + club_reminder_log: one row per email/push sent
--      and one per (application, kind, channel). Unique constraints make every
--      re-run a no-op: UNIQUE (application_id, kind, channel), and one reminder
--      batch per (publisher, channel, local date). RLS on, no client access.
--   4. club_reminder_candidates(mode, now): the service-role read the edge
--      function plans from. Fences (CLAUDE.md "hidden-profile predicate"):
--      profile_is_hidden on applicants AND publishers, known minors out
--      (date_of_birth known and not profile_is_adult), blocked pairs out, test
--      accounts out on prod, pending applications only (any answer stops the
--      reminders), open roles only for reminders. Fit comes from
--      compute_club_fit, which answers only the owner it is asked about, so the
--      function sets the JWT subject to each publisher in turn (transaction-local,
--      restored at the end). Organisation names come from role_organisation.
--   5. club_reminder_claim / club_reminder_finish / club_reminder_skip: claim
--      before sending (advisory lock per publisher, ownership + still-pending
--      re-checked), release on a failed send, record the day-10 skip rule.
--      A push claim enqueues the notification in the same transaction.
--   6. run_club_reminders(mode) + two pg_cron jobs calling the club-reminders
--      edge function through pg_net with the Vault secrets used by
--      run_storage_cleanup (20260828170000):
--        club_reminders_hourly   '5 * * * *'     mode 'reminders'
--        club_new_applications   '*/10 * * * *'  mode 'new_applications'
--      Both return early while their switch is off.
--
-- Expiry clock (unchanged, 20260706090000_application_expiry.sql): an
-- application expires at the first daily sweep (08:00 UTC) after
-- GREATEST(applied_at, launch_date) + expiry_days. closes_at below is that
-- sweep time, so "closes tomorrow" is what the player will see.
--
-- No existing function, trigger or policy is redefined.
-- Rollback: supabase/rollbacks/20261009100000_b2_club_reminders.down.sql
-- Probes:   supabase/tests/security/b2_club_reminders_acl.probe.sql (read-only)
--           supabase/tests/security/b2_club_reminders.probe.sql (staging, rolled back)
-- =========================================================================


-- ═══ 1 · Notification kinds ═══

ALTER TYPE public.profile_notification_kind ADD VALUE IF NOT EXISTS 'applicants_closing_soon';
ALTER TYPE public.profile_notification_kind ADD VALUE IF NOT EXISTS 'applicant_last_call';


-- ═══ 2 · Switches (deploy-dark) ═══

ALTER TABLE public.application_response_settings
  ADD COLUMN IF NOT EXISTS club_reminders_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS batched_application_emails_since timestamptz;

COMMENT ON COLUMN public.application_response_settings.club_reminders_enabled IS
  'B2: day-10 / day-13 publisher reminders on. Also needs sweep_enabled + launch_date (nothing closes otherwise).';
COMMENT ON COLUMN public.application_response_settings.batched_application_emails_since IS
  'B2: when set, applications from this instant get the hourly batched email and notify-application stands down for them. NULL = the old immediate email.';


-- ═══ 3 · Log tables (service role only) ═══

CREATE TABLE IF NOT EXISTS public.club_reminder_batches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel      text NOT NULL CHECK (channel IN ('email', 'push')),
  batch_kind   text NOT NULL CHECK (batch_kind IN ('new_applications', 'reminder')),
  local_date   date NOT NULL,
  status       text NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed', 'sent')),
  item_count   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT timezone('utc', now()),
  sent_at      timestamptz
);

-- One reminder email and one reminder push per publisher per local day.
CREATE UNIQUE INDEX IF NOT EXISTS ux_club_reminder_batches_daily
  ON public.club_reminder_batches (publisher_id, channel, local_date)
  WHERE batch_kind = 'reminder';
CREATE INDEX IF NOT EXISTS idx_club_reminder_batches_recent
  ON public.club_reminder_batches (publisher_id, channel, batch_kind, created_at DESC);

ALTER TABLE public.club_reminder_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.club_reminder_batches FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.club_reminder_batches TO service_role;

CREATE TABLE IF NOT EXISTS public.club_reminder_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id           uuid REFERENCES public.club_reminder_batches(id) ON DELETE CASCADE,
  publisher_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  application_id     uuid NOT NULL REFERENCES public.opportunity_applications(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('new_application', 'closing_soon', 'last_call')),
  channel            text NOT NULL CHECK (channel IN ('email', 'push')),
  outcome            text NOT NULL DEFAULT 'sent' CHECK (outcome IN ('sent', 'skipped')),
  sent_on_local_date date NOT NULL,
  sent_at            timestamptz NOT NULL DEFAULT timezone('utc', now()),
  -- Each application gets each reminder kind at most once per channel, however
  -- often the job re-runs.
  CONSTRAINT club_reminder_log_once UNIQUE (application_id, kind, channel)
);

CREATE INDEX IF NOT EXISTS idx_club_reminder_log_publisher
  ON public.club_reminder_log (publisher_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_club_reminder_log_batch
  ON public.club_reminder_log (batch_id);

ALTER TABLE public.club_reminder_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.club_reminder_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.club_reminder_log TO service_role;

COMMENT ON TABLE public.club_reminder_batches IS
  'B2: one row per publisher email/push the club-reminders job sent (claimed before sending). Service role only.';
COMMENT ON TABLE public.club_reminder_log IS
  'B2: which application was in which reminder (new_application / closing_soon / last_call) per channel. UNIQUE per (application, kind, channel). Service role only.';


-- ═══ 4 · Candidates ═══
-- One row per pending application the job may mention, with the publisher's
-- context repeated on each row. 'reminders': every visible pending
-- application on the OPEN roles of publishers who have one closing within six
-- days (the edge function decides the exact local day). 'new_applications':
-- pending applications since batched_application_emails_since that were never
-- in a new-applications email, for publishers who take application emails.

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
    SELECT
      pub.id,
      pub.email,
      pub.full_name,
      pub.role::text,
      coalesce(bc.code, nc.code)::text,
      pub.notify_applications,
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
      r.title,
      r.opp_position,
      coalesce((SELECT ro.name FROM public.role_organisation(r.opp_id) ro),
               CASE WHEN pub.role = 'club' THEN pub.full_name END),
      ap.id,
      ap.full_name,
      ap.avatar_url,
      ap.role::text,
      ap.position,
      coalesce(apc.common_name, apc.name, apb.common_name, apb.name),
      ap.is_blocked,
      ap.frozen_minor_at,
      (ap.date_of_birth IS NOT NULL AND NOT public.profile_is_adult(ap.date_of_birth)),
      r.applied,
      r.close_at,
      fit.state,
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

COMMENT ON FUNCTION public.club_reminder_candidates(text, timestamptz) IS
  'B2: pending applications the club-reminders job may mention (fenced: hidden, known minors, blocked pairs, test accounts). Service role only.';

REVOKE ALL ON FUNCTION public.club_reminder_candidates(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.club_reminder_candidates(text, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_reminder_candidates(text, timestamptz) TO service_role;


-- ═══ 5 · Claim / finish / skip ═══

-- Claim BEFORE sending. Returns the batch id, or NULL when there is nothing to
-- send (already claimed today, the hourly new-applications gap not reached, or
-- every item already logged / no longer pending / not this publisher's).
-- p_items: [{"application_id": uuid, "kind": "new_application"|"closing_soon"|"last_call"}]
-- p_notification (push only): {"kind", "metadata", "target_url", "actor_id"}
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

COMMENT ON FUNCTION public.club_reminder_claim(uuid, text, text, date, jsonb, jsonb) IS
  'B2: claim a reminder/new-applications send before it goes (idempotent). A push claim enqueues its notification atomically. Service role only.';

REVOKE ALL ON FUNCTION public.club_reminder_claim(uuid, text, text, date, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.club_reminder_claim(uuid, text, text, date, jsonb, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_reminder_claim(uuid, text, text, date, jsonb, jsonb) TO service_role;

-- After the send: mark it sent, or release the claim (the items become due
-- again on the next run that may send them).
CREATE OR REPLACE FUNCTION public.club_reminder_finish(p_batch_id uuid, p_sent boolean)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_batch_id IS NULL THEN
    RETURN;
  END IF;
  IF coalesce(p_sent, false) THEN
    UPDATE public.club_reminder_batches
       SET status = 'sent', sent_at = timezone('utc', now())
     WHERE id = p_batch_id;
  ELSE
    DELETE FROM public.club_reminder_batches WHERE id = p_batch_id AND status = 'claimed';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.club_reminder_finish(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.club_reminder_finish(uuid, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_reminder_finish(uuid, boolean) TO service_role;

-- Day-10 skip rule (answered in the last 24 h AND nothing closes within 2
-- days): the skipped Closing soon items are logged for both channels so they
-- are not re-tried the next day. Returns the number of rows written.
CREATE OR REPLACE FUNCTION public.club_reminder_skip(
  p_publisher_id    uuid,
  p_local_date      date,
  p_application_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_publisher_id IS NULL OR p_local_date IS NULL OR p_application_ids IS NULL THEN
    RETURN 0;
  END IF;
  INSERT INTO public.club_reminder_log (batch_id, publisher_id, application_id, kind, channel, outcome, sent_on_local_date)
  SELECT NULL, p_publisher_id, a.id, 'closing_soon', ch.channel, 'skipped', p_local_date
    FROM public.opportunity_applications a
    JOIN public.opportunities o ON o.id = a.opportunity_id AND o.club_id = p_publisher_id
   CROSS JOIN (VALUES ('email'), ('push')) AS ch(channel)
   WHERE a.id = ANY (p_application_ids)
     AND a.status = 'pending'
  ON CONFLICT (application_id, kind, channel) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.club_reminder_skip(uuid, date, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.club_reminder_skip(uuid, date, uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_reminder_skip(uuid, date, uuid[]) TO service_role;


-- ═══ 6 · Scheduler ═══

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

REVOKE ALL ON FUNCTION public.run_club_reminders(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_club_reminders(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_club_reminders(text) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('club_reminders_hourly', 'club_new_applications');
    -- Minute 5 of every hour: 09:05 local in every whole-hour zone, 09:35 in
    -- half-hour zones; the edge function picks publishers whose local hour is 9.
    PERFORM cron.schedule('club_reminders_hourly', '5 * * * *', $cron$SELECT public.run_club_reminders('reminders');$cron$);
    -- Every 10 minutes; the claim enforces at most one email per publisher per hour.
    PERFORM cron.schedule('club_new_applications', '*/10 * * * *', $cron$SELECT public.run_club_reminders('new_applications');$cron$);
  END IF;
END $$;
