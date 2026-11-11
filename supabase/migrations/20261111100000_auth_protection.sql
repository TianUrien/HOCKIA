-- Sign-in and sign-up protection: measurement, then two switches (both OFF).
--
-- Founder ruling 2026-10-28: rate-limit first, enforce the bot check only
-- after measuring. Brief 2026-11-11 (engineering lead): measure OAuth starts
-- and failed sign-ins per network and device without storing raw IP
-- addresses, then a rate limit and a bot-check requirement, each behind a
-- runtime switch that defaults to off.
--
-- What this adds
--   1. auth_attempts          one row per sign-in / sign-up attempt, written by
--                             the auth-guard edge function (new clients) and by
--                             the before-user-created Auth hook (every client).
--                             Networks and devices are stored as keyed hashes.
--   2. auth_guard_check()     records an attempt and answers allowed / refused.
--   3. auth_guard_report()    records an outcome (a failed password sign-in).
--   4. hook_before_user_created()  Auth hook: counts new accounts per network
--                             and, with the rate-limit switch on, refuses a
--                             network that creates too many in an hour. It
--                             does nothing until it is selected in the
--                             dashboard (Authentication > Hooks).
--   5. admin_get_auth_attempts()   admin-only summary for the admin page.
--   6. prune_auth_attempts()  30-day retention, daily.
--
-- Switches (app_settings, absent row = OFF, same pattern as
-- facebook_login_enabled):
--   auth_rate_limit_enabled   = 'true'  -> limits are applied
--   auth_turnstile_enforced   = 'true'  -> auth-guard requires a bot-check token
-- Optional overrides (integers as text): auth_limit_device_max,
-- auth_limit_ip_max, auth_limit_window_seconds, auth_limit_signups_per_hour.
--
-- With both switches off nothing is ever refused: attempts over a threshold
-- are recorded as 'would_limit', which is the number to read before turning
-- the limit on.
--
-- Installed store builds do not call auth-guard, so nothing here can refuse
-- them except the hook's new-account ceiling, which is off by default.
--
-- Rollback: supabase/rollbacks/20261111100000_auth_protection.down.sql

-- ── 1 · Key for the hashes (per environment, never leaves the database) ────
CREATE TABLE IF NOT EXISTS public.auth_guard_keys (
  name       text PRIMARY KEY,
  secret     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.auth_guard_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_guard_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.auth_guard_keys TO service_role;

INSERT INTO public.auth_guard_keys (name, secret)
VALUES ('hash_v1', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

-- ── 2 · Attempts ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auth_attempts (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  source       text NOT NULL CHECK (source IN ('guard', 'hook')),
  kind         text NOT NULL CHECK (kind IN (
                 'oauth_start', 'password_signin', 'password_signin_failed',
                 'signup', 'magic_link', 'password_reset', 'user_created')),
  provider     text,
  ip_hash      text,
  device_hash  text,
  device_label text,
  platform     text,
  app_version  text,
  country      text,
  outcome      text NOT NULL CHECK (outcome IN (
                 'allowed', 'would_limit', 'rate_limited',
                 'captcha_required', 'captcha_failed', 'observed'))
);
CREATE INDEX IF NOT EXISTS auth_attempts_created_at_idx ON public.auth_attempts (created_at);
CREATE INDEX IF NOT EXISTS auth_attempts_ip_created_idx ON public.auth_attempts (ip_hash, created_at);

ALTER TABLE public.auth_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.auth_attempts TO service_role;

COMMENT ON TABLE public.auth_attempts IS
  'Sign-in / sign-up attempts for abuse measurement. Server-only (RLS on, no policies). ip_hash and device_hash are keyed hashes; raw IP addresses and user agents are never stored. 30-day retention (prune_auth_attempts).';

-- ── 3 · Helpers (server-only) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_guard_hash(p_value text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR btrim(p_value) = '' THEN NULL
    ELSE left(encode(extensions.hmac(p_value, (SELECT secret FROM public.auth_guard_keys WHERE name = 'hash_v1'), 'sha256'), 'hex'), 32)
  END;
$$;
REVOKE ALL ON FUNCTION public.auth_guard_hash(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_guard_hash(text) TO service_role;

CREATE OR REPLACE FUNCTION public.auth_guard_setting_int(p_key text, p_default integer)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value::integer FROM public.app_settings WHERE key = p_key AND value ~ '^[0-9]{1,6}$'),
    p_default);
$$;
REVOKE ALL ON FUNCTION public.auth_guard_setting_int(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_guard_setting_int(text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.auth_guard_switch(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_settings WHERE key = p_key AND value = 'true');
$$;
REVOKE ALL ON FUNCTION public.auth_guard_switch(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_guard_switch(text) TO service_role;

-- ── 4 · The check ─────────────────────────────────────────────────────────
-- p_captcha: 'none' (no token sent), 'valid', 'invalid', or 'unavailable'
-- (the verifier could not be reached or is not configured: never refuse).
--
-- Limits, per kind, over a sliding window (default 300 s):
--   device  = same network AND same device signature   default 10
--   network = same network, any device                 default 40
-- Only attempts that were let through count, so a refused caller is free
-- again once the window has moved on.
CREATE OR REPLACE FUNCTION public.auth_guard_check(
  p_kind         text,
  p_provider     text,
  p_ip           text,
  p_user_agent   text,
  p_install_id   text,
  p_device_label text,
  p_platform     text,
  p_app_version  text,
  p_country      text,
  p_captcha      text DEFAULT 'none'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit_on     boolean := public.auth_guard_switch('auth_rate_limit_enabled');
  v_captcha_on   boolean := public.auth_guard_switch('auth_turnstile_enforced');
  v_window       integer := public.auth_guard_setting_int('auth_limit_window_seconds', 300);
  v_device_max   integer := public.auth_guard_setting_int('auth_limit_device_max', 10);
  v_ip_max       integer := public.auth_guard_setting_int('auth_limit_ip_max', 40);
  v_ip_hash      text := public.auth_guard_hash(p_ip);
  v_device_hash  text := public.auth_guard_hash(coalesce(p_user_agent, '') || '|' || coalesce(p_install_id, ''));
  v_since        timestamptz;
  v_ip_all       integer := 0;
  v_ip_count     integer := 0;
  v_device_count integer := 0;
  v_over         boolean := false;
  v_outcome      text := 'allowed';
  v_oldest       timestamptz;
  v_retry        integer;
BEGIN
  IF p_kind NOT IN ('oauth_start', 'password_signin', 'signup', 'magic_link', 'password_reset') THEN
    RETURN jsonb_build_object('allowed', true, 'outcome', 'ignored');
  END IF;
  v_window := greatest(30, least(v_window, 86400));
  v_since := now() - make_interval(secs => v_window);

  IF v_ip_hash IS NOT NULL THEN
    SELECT count(*),
           count(*) FILTER (WHERE kind = p_kind AND outcome IN ('allowed', 'would_limit')),
           count(*) FILTER (WHERE kind = p_kind AND outcome IN ('allowed', 'would_limit') AND device_hash = v_device_hash),
           min(created_at) FILTER (WHERE kind = p_kind AND outcome IN ('allowed', 'would_limit'))
      INTO v_ip_all, v_ip_count, v_device_count, v_oldest
      FROM public.auth_attempts
     WHERE ip_hash = v_ip_hash AND created_at > v_since AND source = 'guard';
    v_over := v_device_count >= v_device_max OR v_ip_count >= v_ip_max;
  END IF;

  IF v_over AND v_limit_on THEN
    v_outcome := 'rate_limited';
  ELSIF v_captcha_on AND p_captcha = 'none' THEN
    v_outcome := 'captcha_required';
  ELSIF v_captcha_on AND p_captcha = 'invalid' THEN
    v_outcome := 'captcha_failed';
  ELSIF v_over THEN
    v_outcome := 'would_limit';
  END IF;

  -- A flood against this endpoint must not grow the table without bound:
  -- past ten times the network ceiling the answer is still given, unrecorded.
  IF v_ip_all < v_ip_max * 10 THEN
    INSERT INTO public.auth_attempts
      (source, kind, provider, ip_hash, device_hash, device_label, platform, app_version, country, outcome)
    VALUES
      ('guard', p_kind, left(p_provider, 20), v_ip_hash, v_device_hash, left(p_device_label, 80),
       left(p_platform, 12), left(p_app_version, 20), left(p_country, 2), v_outcome);
  END IF;

  IF v_outcome = 'rate_limited' THEN
    v_retry := greatest(30, v_window - floor(extract(epoch FROM (now() - coalesce(v_oldest, now()))))::integer);
    RETURN jsonb_build_object('allowed', false, 'outcome', v_outcome, 'reason', 'rate_limited', 'retry_after', v_retry);
  ELSIF v_outcome IN ('captcha_required', 'captcha_failed') THEN
    RETURN jsonb_build_object('allowed', false, 'outcome', v_outcome, 'reason', v_outcome);
  END IF;
  RETURN jsonb_build_object('allowed', true, 'outcome', v_outcome);
END;
$$;
REVOKE ALL ON FUNCTION public.auth_guard_check(text, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_guard_check(text, text, text, text, text, text, text, text, text, text) TO service_role;

-- ── 5 · Outcome reports (measurement only, never refuses) ─────────────────
CREATE OR REPLACE FUNCTION public.auth_guard_report(
  p_kind         text,
  p_ip           text,
  p_user_agent   text,
  p_install_id   text,
  p_device_label text,
  p_platform     text,
  p_app_version  text,
  p_country      text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ip_hash text := public.auth_guard_hash(p_ip);
  v_recent  integer;
BEGIN
  IF p_kind <> 'password_signin_failed' THEN RETURN; END IF;
  SELECT count(*) INTO v_recent FROM public.auth_attempts
   WHERE ip_hash = v_ip_hash AND created_at > now() - interval '5 minutes' AND source = 'guard';
  IF v_recent >= public.auth_guard_setting_int('auth_limit_ip_max', 40) * 10 THEN RETURN; END IF;
  INSERT INTO public.auth_attempts
    (source, kind, ip_hash, device_hash, device_label, platform, app_version, country, outcome)
  VALUES
    ('guard', p_kind, v_ip_hash,
     public.auth_guard_hash(coalesce(p_user_agent, '') || '|' || coalesce(p_install_id, '')),
     left(p_device_label, 80), left(p_platform, 12), left(p_app_version, 20), left(p_country, 2), 'observed');
END;
$$;
REVOKE ALL ON FUNCTION public.auth_guard_report(text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_guard_report(text, text, text, text, text, text, text, text) TO service_role;

-- ── 6 · Auth hook: new accounts per network ───────────────────────────────
-- Runs inside Supabase Auth for every new account from every client once it
-- is selected in the dashboard. It must never break sign-up by accident: any
-- error inside is swallowed and the account is allowed.
CREATE OR REPLACE FUNCTION public.hook_before_user_created(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ip_hash text;
  v_max     integer;
  v_recent  integer;
  v_over    boolean;
  v_refuse  boolean;
BEGIN
  v_ip_hash := public.auth_guard_hash(event->'metadata'->>'ip_address');
  v_max := public.auth_guard_setting_int('auth_limit_signups_per_hour', 30);
  SELECT count(*) INTO v_recent FROM public.auth_attempts
   WHERE ip_hash = v_ip_hash AND source = 'hook' AND kind = 'user_created'
     AND outcome IN ('allowed', 'would_limit') AND created_at > now() - interval '1 hour';
  v_over := v_ip_hash IS NOT NULL AND v_recent >= v_max;
  v_refuse := v_over AND public.auth_guard_switch('auth_rate_limit_enabled');

  INSERT INTO public.auth_attempts (source, kind, provider, ip_hash, outcome)
  VALUES ('hook', 'user_created', left(event->'user'->'app_metadata'->>'provider', 20), v_ip_hash,
          CASE WHEN v_refuse THEN 'rate_limited' WHEN v_over THEN 'would_limit' ELSE 'allowed' END);

  IF v_refuse THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'http_code', 429,
      'message', 'Too many new accounts from this network. Please try again in an hour.'));
  END IF;
  RETURN '{}'::jsonb;
EXCEPTION WHEN OTHERS THEN
  RETURN '{}'::jsonb;
END;
$$;
REVOKE ALL ON FUNCTION public.hook_before_user_created(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hook_before_user_created(jsonb) TO supabase_auth_admin, service_role;

-- ── 7 · Admin summary ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_auth_attempts(p_hours integer DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hours   integer := greatest(1, least(coalesce(p_hours, 24), 720));
  v_since   timestamptz;
  v_totals  jsonb;
  v_sources jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  v_since := now() - make_interval(hours => v_hours);

  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.attempts DESC) INTO v_totals
    FROM (
      SELECT kind, outcome, count(*)::integer AS attempts
        FROM public.auth_attempts WHERE created_at > v_since
       GROUP BY kind, outcome
    ) t;

  -- One row per network + device. The network is shown as a short tag of its
  -- hash: enough to tell two networks apart, not an address.
  SELECT jsonb_agg(to_jsonb(s) ORDER BY s.attempts DESC) INTO v_sources
    FROM (
      SELECT left(ip_hash, 8) AS network,
             left(device_hash, 8) AS device,
             max(device_label) AS device_label,
             max(platform) AS platform,
             max(app_version) AS app_version,
             max(country) AS country,
             count(*)::integer AS attempts,
             (count(*) FILTER (WHERE kind = 'oauth_start'))::integer AS oauth_starts,
             (count(*) FILTER (WHERE kind = 'password_signin_failed'))::integer AS failed_signins,
             (count(*) FILTER (WHERE kind = 'user_created'))::integer AS new_accounts,
             (count(*) FILTER (WHERE outcome = 'would_limit'))::integer AS would_limit,
             (count(*) FILTER (WHERE outcome IN ('rate_limited', 'captcha_required', 'captcha_failed')))::integer AS refused,
             min(created_at) AS first_seen,
             max(created_at) AS last_seen
        FROM public.auth_attempts
       WHERE created_at > v_since
       GROUP BY ip_hash, device_hash
       ORDER BY count(*) DESC
       LIMIT 50
    ) s;

  RETURN jsonb_build_object(
    'hours', v_hours,
    'rate_limit_enabled', public.auth_guard_switch('auth_rate_limit_enabled'),
    'turnstile_enforced', public.auth_guard_switch('auth_turnstile_enforced'),
    'device_max', public.auth_guard_setting_int('auth_limit_device_max', 10),
    'ip_max', public.auth_guard_setting_int('auth_limit_ip_max', 40),
    'window_seconds', public.auth_guard_setting_int('auth_limit_window_seconds', 300),
    'signups_per_hour', public.auth_guard_setting_int('auth_limit_signups_per_hour', 30),
    'totals', coalesce(v_totals, '[]'::jsonb),
    'sources', coalesce(v_sources, '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_auth_attempts(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_auth_attempts(integer) TO authenticated, service_role;

-- ── 8 · Retention ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prune_auth_attempts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_deleted integer;
BEGIN
  DELETE FROM public.auth_attempts WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION public.prune_auth_attempts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_auth_attempts() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune_auth_attempts_daily') THEN
      PERFORM cron.schedule('prune_auth_attempts_daily', '40 4 * * *',
        $cron$SELECT public.prune_auth_attempts();$cron$);
    END IF;
  END IF;
END $$;
