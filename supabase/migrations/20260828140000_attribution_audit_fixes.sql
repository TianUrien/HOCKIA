-- Attribution v2 — audit follow-ups (2026-08-28, same-day adversarial review
-- of Phases 1+2). Nothing here touches public.profiles (see the note at the
-- bottom about the updated_at trigger).
--
-- 1. admin_get_signup_cohort_retention grouped by the LEGACY column
--    profiles.acquisition_source; D8 stopped writing it, so every member from
--    today on would land in "unknown". Read signup_attribution.first_source.
-- 2. admin_get_acquisition_report: count every member who joined (FULL JOIN
--    profiles ∪ attribution rows; missing row → "unknown"/"missing"), date by
--    REGISTRATION (auth.users.created_at) not onboarding start, keep sources
--    that only existed in the previous period, clamp p_days.
-- 3. short_links.destination CHECK accepted '//evil.com'.
-- 4. normalize_attribution: strip NBSP/tabs like the client's trim(); rules:
--    paid-search utm is its own channel, Google host regex no longer matches
--    google.com.attacker.io, webmail / mail-app / Android-app referrers map
--    to their channel instead of "referral:<package>".
-- 5. record_signup_attribution: safe timestamp casts (a bad string aborted
--    the whole write), whitelisted enums (report keys were free-form client
--    strings), first_touch with no evidence → "unknown" (not "direct"), and
--    the `acq` snapshot that rides in auth metadata is used as a rescue when
--    the browser state was lost across the email/OAuth round-trip.
-- 6. Legacy shim: proper host extraction (ports / android-app:// schemes).
-- 7. resolve_short_link: per-code burst cap so a curl loop cannot inflate
--    click counts unboundedly. Index on signup_attribution.link_id.
-- 8. REVOKE FROM PUBLIC on two functions that skipped it.

-- ── 1. cohort retention reads the v2 source ──────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_get_signup_cohort_retention(p_weeks integer DEFAULT 12)
RETURNS TABLE (
  cohort_week date,
  acquisition_source text,
  signups integer,
  week2_returners integer,
  week2_pct numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  WITH cohort AS (
    SELECT p.id,
           date_trunc('week', p.created_at)::date AS wk,
           COALESCE(NULLIF(sa.first_source, ''), NULLIF(p.acquisition_source, ''), 'unknown') AS src,
           p.created_at
    FROM profiles p
    LEFT JOIN signup_attribution sa ON sa.user_id = p.id
    WHERE COALESCE(p.is_test_account, false) = false
      AND p.created_at >= date_trunc('week', timezone('utc', now()))
                          - make_interval(weeks => GREATEST(1, LEAST(p_weeks, 52)))
  )
  SELECT c.wk,
         c.src,
         count(*)::int,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM events e
           WHERE e.user_id = c.id
             AND e.created_at >= c.created_at + interval '7 days'
             AND e.created_at <  c.created_at + interval '14 days'
         ))::int,
         round(100.0 * count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM events e
           WHERE e.user_id = c.id
             AND e.created_at >= c.created_at + interval '7 days'
             AND e.created_at <  c.created_at + interval '14 days'
         )) / count(*), 1)
  FROM cohort c
  GROUP BY c.wk, c.src
  ORDER BY c.wk DESC, c.src;
END;
$function$;

-- ── 2. acquisition report counts every member who joined ─────────────────

CREATE OR REPLACE FUNCTION public.admin_get_acquisition_report(p_days integer DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := GREATEST(1, LEAST(COALESCE(p_days, 90), 3650));
  v_from timestamptz := now() - make_interval(days => GREATEST(1, LEAST(COALESCE(p_days, 90), 3650)));
  v_prev_from timestamptz := now() - make_interval(days => 2 * GREATEST(1, LEAST(COALESCE(p_days, 90), 3650)));
  v_result jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  WITH base AS (
    -- FULL JOIN: a member with a profile and no attribution row is still a
    -- signup (source "unknown", method "missing"); a member who registered
    -- but never started onboarding has a row and no profile. Dated by
    -- registration, which is what "signup" means.
    SELECT COALESCE(p.id, sa.user_id)                       AS user_id,
           COALESCE(sa.first_touch_source, 'unknown')       AS source,
           COALESCE(sa.first_touch_group, 'unknown')        AS channel_group,
           CASE WHEN sa.user_id IS NULL THEN 'missing'
                ELSE COALESCE(sa.attribution_method, 'unknown') END AS method,
           COALESCE(sa.attribution_confidence, 'unknown')   AS confidence,
           COALESCE(sa.platform, 'unknown')                 AS platform,
           COALESCE(u.created_at, p.created_at, sa.signup_at) AS joined_at,
           COALESCE(p.onboarding_completed, false)          AS onboarding_completed
    FROM signup_attribution sa
    FULL OUTER JOIN profiles p ON p.id = sa.user_id
    LEFT JOIN auth.users u ON u.id = COALESCE(p.id, sa.user_id)
    WHERE COALESCE(p.is_test_account, false) = false
  ),
  cur AS (SELECT * FROM base WHERE joined_at >= v_from),
  prev AS (SELECT * FROM base WHERE joined_at >= v_prev_from AND joined_at < v_from),
  cur_agg AS (
    SELECT source, MAX(channel_group) AS channel_group, COUNT(*)::int AS signups,
           COUNT(*) FILTER (WHERE onboarding_completed)::int AS activated
    FROM cur GROUP BY 1
  ),
  prev_agg AS (
    SELECT source, MAX(channel_group) AS channel_group, COUNT(*)::int AS prev_signups FROM prev GROUP BY 1
  ),
  by_channel AS (
    -- a source that only existed last period still shows: "now 0, was N"
    SELECT COALESCE(c.source, pa.source)               AS source,
           COALESCE(c.channel_group, pa.channel_group) AS channel_group,
           COALESCE(c.signups, 0)                      AS signups,
           COALESCE(c.activated, 0)                    AS activated,
           COALESCE(pa.prev_signups, 0)                AS prev_signups
    FROM cur_agg c
    FULL OUTER JOIN prev_agg pa ON pa.source = c.source
  )
  SELECT jsonb_build_object(
    'period_days', v_days,
    'generated_at', now(),
    'total_signups', (SELECT COUNT(*) FROM cur),
    'channels', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'source', source, 'group', channel_group, 'signups', signups,
        'activated', activated, 'prev_signups', prev_signups
      ) ORDER BY signups DESC, prev_signups DESC) FROM by_channel), '[]'::jsonb),
    'methods', COALESCE((SELECT jsonb_object_agg(m, n) FROM (
        SELECT method m, COUNT(*)::int n FROM cur GROUP BY 1) x), '{}'::jsonb),
    'confidence', COALESCE((SELECT jsonb_object_agg(m, n) FROM (
        SELECT confidence m, COUNT(*)::int n FROM cur GROUP BY 1) x), '{}'::jsonb),
    'platforms', COALESCE((SELECT jsonb_object_agg(m, n) FROM (
        SELECT platform m, COUNT(*)::int n FROM cur GROUP BY 1) x), '{}'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_acquisition_report(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_acquisition_report(integer) TO authenticated;

-- ── 3. no protocol-relative destinations ─────────────────────────────────

ALTER TABLE public.short_links DROP CONSTRAINT IF EXISTS short_links_destination_check;
ALTER TABLE public.short_links ADD CONSTRAINT short_links_destination_check
  CHECK (destination = 'store' OR destination ~ '^/([^/\\]|$)' OR destination ~ '^https://');

-- ── 4. normalization: whitespace parity + registry fixes ─────────────────

CREATE OR REPLACE FUNCTION public.normalize_attribution(
  p_utm_source    text,
  p_referrer_host text
)
RETURNS TABLE (source text, channel_group text, medium text, method text, discarded boolean)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  -- btrim() alone strips ASCII spaces only; the client mirror uses trim(),
  -- which also strips tabs, newlines and NBSP (pasted links carry them).
  v_utm  text := lower(btrim(coalesce(p_utm_source, ''),    E' \t\n\r' || chr(160)));
  v_host text := lower(btrim(coalesce(p_referrer_host, ''), E' \t\n\r' || chr(160)));
  r RECORD;
BEGIN
  IF v_utm <> '' THEN
    FOR r IN SELECT * FROM attribution_channel_rules WHERE kind = 'utm' AND v_utm ~* pattern ORDER BY priority LIMIT 1 LOOP
      RETURN QUERY SELECT r.source, r.channel_group, r.medium, 'utm'::text, r.discard; RETURN;
    END LOOP;
    RETURN QUERY SELECT left(v_utm, 60), 'other'::text, NULL::text, 'utm'::text, false; RETURN;
  END IF;

  IF v_host <> '' THEN
    FOR r IN SELECT * FROM attribution_channel_rules WHERE kind = 'host' AND v_host ~* pattern ORDER BY priority LIMIT 1 LOOP
      RETURN QUERY SELECT r.source, r.channel_group, r.medium, 'referrer'::text, r.discard; RETURN;
    END LOOP;
    RETURN QUERY SELECT left('referral:' || v_host, 80), 'referral'::text, 'referral'::text, 'referrer'::text, false; RETURN;
  END IF;

  RETURN QUERY SELECT 'direct'::text, 'direct'::text, NULL::text, 'none'::text, false;
END;
$$;
REVOKE ALL ON FUNCTION public.normalize_attribution(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_attribution(text, text) TO authenticated, service_role;

-- Patterns are the conflict key, so a changed pattern is a delete + insert.
DELETE FROM public.attribution_channel_rules
 WHERE (kind, pattern) IN (('host', '^(www\.)?google\.[a-z.]+$'), ('utm', '^(google|adwords|gads)$'));

INSERT INTO public.attribution_channel_rules (kind, pattern, source, channel_group, medium, discard, priority) VALUES
  -- paid search is never "organic"
  ('utm',  '^(adwords|gads|google_ads|googleads)$',                'google_ads',     'search', 'cpc',     false, 29),
  -- Google ccTLDs only: com | xx | co.xx | com.xx — google.com.attacker.io cannot match
  ('host', '^(www\.)?google\.(com|[a-z]{2}|com?\.[a-z]{2})$',      'google_organic', 'search', 'organic', false, 30),
  ('utm',  '^google$',                                             'google_organic', 'search', 'organic', false, 35),
  -- Android app referrers arrive as android-app://<package>
  ('host', '^com\.linkedin\.android$',                             'linkedin',  'social',    'social',    false, 52),
  ('host', '^com\.instagram\.android$',                            'instagram', 'social',    'social',    false, 53),
  ('host', '^com\.facebook\.(katana|orca|lite)$',                  'facebook',  'social',    'social',    false, 54),
  ('host', '^com\.twitter\.android$',                              'x',         'social',    'social',    false, 55),
  ('host', '^com\.whatsapp(\.w4b)?$',                              'whatsapp',  'messaging', 'messaging', false, 64),
  ('host', '^org\.telegram\.messenger$',                           'telegram',  'messaging', 'messaging', false, 65),
  -- webmail and mail apps are the email channel, not "referral sites"
  ('host', '^(mail\.google\.com|com\.google\.android\.gm|outlook\.(live|office|office365)\.com|com\.microsoft\.office\.outlook|mail\.yahoo\.com|mail\.proton\.me)$',
                                                                   'email',     'email',     'email',     false, 69)
ON CONFLICT (kind, pattern) DO UPDATE
  SET source = EXCLUDED.source, channel_group = EXCLUDED.channel_group,
      medium = EXCLUDED.medium, discard = EXCLUDED.discard, priority = EXCLUDED.priority;

-- ── 5. record_signup_attribution: hardened ───────────────────────────────

CREATE OR REPLACE FUNCTION public.attribution_safe_ts(p text)
RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  RETURN NULLIF(p, '')::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.attribution_safe_ts(text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.record_signup_attribution(p jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_first jsonb := p->'first_touch';
  v_acq jsonb;
  v_ft  RECORD;
  v_ln  RECORD;
  v_no_evidence boolean := false;
  v_source text; v_group text; v_method text; v_conf text;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  -- raw stays bounded: the touches ring buffer is the only open-ended part.
  IF pg_column_size(p) > 32768 THEN p := p - 'touches'; END IF;
  IF v_first = 'null'::jsonb THEN v_first := NULL; END IF;

  -- Rescue: the browser that landed from the source is not always the one
  -- that finishes signup (magic link opened in a new tab, consent-pending
  -- state living in sessionStorage). The client stashed a snapshot of its
  -- first touch in auth metadata at signup; use it when what arrived here
  -- carries no signal.
  IF v_first IS NULL OR (v_first->>'utm_source' IS NULL AND v_first->>'referring_domain' IS NULL) THEN
    SELECT u.raw_user_meta_data->'acq' INTO v_acq FROM auth.users u WHERE u.id = v_uid;
    IF v_acq IS NOT NULL AND (v_acq->>'utm_source' IS NOT NULL OR v_acq->>'referrer' IS NOT NULL) THEN
      v_first := jsonb_strip_nulls(jsonb_build_object(
        'utm_source',       v_acq->>'utm_source',
        'utm',              CASE WHEN v_acq->>'utm_source' IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object(
                                 'source', v_acq->>'utm_source', 'medium', v_acq->>'medium', 'campaign', v_acq->>'campaign')) END,
        'referring_domain', v_acq->>'referrer',
        'landing_page',     v_acq->>'landing',
        'captured_at',      v_acq->>'at',
        'link_id',          v_acq->>'link_id',
        'from_snapshot',    true));
      v_method := 'snapshot';
    END IF;
  END IF;
  v_no_evidence := v_first IS NULL;

  SELECT * INTO v_ft FROM normalize_attribution(v_first->>'utm_source', v_first->>'referring_domain');
  SELECT * INTO v_ln FROM normalize_attribution(p->'last_nd'->>'utm_source',   p->'last_nd'->>'referring_domain');

  v_source := CASE WHEN v_no_evidence OR v_ft.discarded THEN 'unknown' ELSE v_ft.source END;
  v_group  := CASE WHEN v_no_evidence OR v_ft.discarded THEN 'unknown' ELSE v_ft.channel_group END;
  v_method := COALESCE(v_method,
                CASE WHEN p->>'attribution_method' IN ('migrated', 'upgraded_first_signal', 'legacy_client', 'deep_link', 'install_referrer')
                     THEN p->>'attribution_method' END,
                CASE WHEN v_no_evidence THEN 'none' ELSE v_ft.method END);
  -- Confidence is derived from the evidence only — a client claim never
  -- exceeds what the touch actually carries (probe 2026-08-28).
  v_conf   := CASE WHEN v_no_evidence OR v_ft.discarded THEN 'low'
                   WHEN v_ft.method = 'utm' THEN 'high'
                   WHEN v_ft.method = 'referrer' THEN 'medium'
                   ELSE 'low' END;

  INSERT INTO signup_attribution (
    user_id, anonymous_id,
    first_referrer, first_source, utm, landing_path, first_seen_at,
    first_touch_source, first_touch_group, first_touch_medium, first_touch_campaign,
    first_touch_content, first_touch_term, first_touch_referrer, first_touch_domain,
    first_touch_landing, last_nd_source, last_nd_group, last_nd_campaign, last_nd_at,
    session_source, platform, device_category, deep_link, link_id,
    attribution_method, attribution_confidence, raw
  )
  VALUES (
    v_uid,
    left(p->>'anonymous_id', 128),
    left(v_first->>'referrer', 2048),
    v_source,
    NULLIF(v_first->'utm', 'null'::jsonb),
    left(v_first->>'landing_page', 512),
    public.attribution_safe_ts(v_first->>'captured_at'),
    v_source,
    v_group,
    left(COALESCE(v_first->'utm'->>'medium', v_ft.medium), 64),
    left(v_first->'utm'->>'campaign', 64),
    left(v_first->'utm'->>'content', 64),
    left(v_first->'utm'->>'term', 64),
    left(v_first->>'referrer', 2048),
    left(v_first->>'referring_domain', 253),
    left(v_first->>'landing_page', 512),
    CASE WHEN v_ln.discarded OR v_ln.source = 'direct' THEN NULL ELSE v_ln.source END,
    CASE WHEN v_ln.discarded OR v_ln.source = 'direct' THEN NULL ELSE v_ln.channel_group END,
    left(p->'last_nd'->'utm'->>'campaign', 64),
    public.attribution_safe_ts(p->'last_nd'->>'captured_at'),
    left(p->>'session_source', 80),
    CASE WHEN p->>'platform' IN ('web', 'ios', 'android') THEN p->>'platform' ELSE 'unknown' END,
    CASE WHEN p->>'device_category' IN ('desktop', 'phone', 'tablet') THEN p->>'device_category' ELSE 'unknown' END,
    left(p->>'deep_link', 2048),
    left(COALESCE(p->>'link_id', v_first->>'link_id'), 32),
    v_method,
    v_conf,
    p
  )
  ON CONFLICT (user_id) DO NOTHING;  -- immutable: first write wins, forever

  IF p->>'anonymous_id' IS NOT NULL THEN
    UPDATE events SET resolved_user_id = v_uid
     WHERE anonymous_id = p->>'anonymous_id'
       AND resolved_user_id IS NULL AND user_id IS NULL;
  END IF;
END;
$$;

-- ── 6. legacy shim: real host extraction ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.link_signup_attribution(
  p_anonymous_id text,
  p_first_referrer text DEFAULT NULL,
  p_utm jsonb DEFAULT NULL,
  p_landing_path text DEFAULT NULL,
  p_first_seen_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.record_signup_attribution(jsonb_build_object(
    'anonymous_id', p_anonymous_id,
    'attribution_method', 'legacy_client',
    'first_touch', jsonb_build_object(
      'utm_source', p_utm->>'source',
      'utm', p_utm,
      'referrer', p_first_referrer,
      -- scheme://[user@]host[:port]/… → host; a bare hostname passes through
      'referring_domain', COALESCE(
        substring(p_first_referrer from '^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^@/]+@)?([^/:?#]+)'),
        p_first_referrer),
      'landing_page', p_landing_path,
      'captured_at', p_first_seen_at
    )
  ));
$$;

-- ── 7. click burst cap + index ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_short_link(
  p_code text,
  p_platform text DEFAULT NULL,
  p_referrer_host text DEFAULT NULL,
  p_device text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.short_links%ROWTYPE;
BEGIN
  SELECT * INTO v_link FROM public.short_links WHERE code = lower(p_code) AND is_active;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Always resolve; count only within a sane burst. A real campaign never
  -- produces 120 taps/minute on one code, a curl loop does.
  IF (SELECT COUNT(*) FROM public.short_link_clicks c
       WHERE c.code = v_link.code AND c.clicked_at > now() - interval '1 minute') < 120 THEN
    INSERT INTO public.short_link_clicks (code, platform, referrer_host, device_category)
    VALUES (v_link.code, left(p_platform, 16), left(p_referrer_host, 128), left(p_device, 16));
    UPDATE public.short_links
       SET click_count = click_count + 1, last_clicked_at = now()
     WHERE code = v_link.code;
  END IF;

  RETURN jsonb_build_object(
    'code', v_link.code,
    'destination', v_link.destination,
    'utm_source', v_link.utm_source,
    'utm_medium', v_link.utm_medium,
    'utm_campaign', v_link.utm_campaign,
    'utm_content', v_link.utm_content,
    'utm_term', v_link.utm_term
  );
END;
$$;

CREATE INDEX IF NOT EXISTS signup_attribution_link_id_idx
  ON public.signup_attribution (link_id) WHERE link_id IS NOT NULL;

-- ── note ─────────────────────────────────────────────────────────────────
-- 20260828100000 ran `UPDATE profiles SET acquisition_source …` for every
-- row, which fired set_profiles_updated_at and rewrote profiles.updated_at
-- for 301 members. That is repaired separately from a pre-migration backup
-- with the trigger disabled; any future batch column write on profiles must
-- wrap itself in ALTER TABLE … DISABLE TRIGGER set_profiles_updated_at.
