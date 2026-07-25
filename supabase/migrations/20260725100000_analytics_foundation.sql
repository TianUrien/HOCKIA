-- Analytics foundation (Phase 0): professional funnel instrumentation on the
-- OWNED first-party `events` pipeline. Adds the dimensions a mature product-
-- analytics setup needs (visitor identity, sessions, geo, device, source) plus
-- signup attribution + identity stitching — without changing track_event's
-- signature, so every existing caller keeps working.
--
-- WHY server-side enrichment: country and IP must be derived from the request,
-- never trusted from the client. Supabase sits behind Cloudflare, so
-- `request.headers` carries cf-ipcountry + x-forwarded-for on real PostgREST
-- calls (null in the SQL editor / direct connections — verify via a browser).

-- ── 1. New dimension columns on events ──────────────────────────────────────
-- (session_id, user_agent, ip_hash already exist but were never populated.)
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS anonymous_id   text,   -- durable per-browser visitor id (unique/returning)
  ADD COLUMN IF NOT EXISTS resolved_user_id uuid, -- identity stitching: who this anon turned out to be
  ADD COLUMN IF NOT EXISTS country        text,   -- 2-letter, server-derived from cf-ipcountry
  ADD COLUMN IF NOT EXISTS device         text,   -- desktop | mobile | tablet (client-parsed UA)
  ADD COLUMN IF NOT EXISTS browser        text,   -- chrome | safari | ... (client-parsed UA)
  ADD COLUMN IF NOT EXISTS referrer_source text,  -- google | linkedin | meta | direct | ...
  ADD COLUMN IF NOT EXISTS utm            jsonb;  -- {source,medium,campaign,term,content}

CREATE INDEX IF NOT EXISTS events_anonymous_id_created_idx
  ON public.events (anonymous_id, created_at DESC) WHERE anonymous_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_name_created_idx
  ON public.events (event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS events_resolved_user_idx
  ON public.events (resolved_user_id) WHERE resolved_user_id IS NOT NULL;

-- ── 2. track_event: same signature, now self-enriching ──────────────────────
-- Reads the identity/device fields the client puts in `properties`, promotes
-- them to columns, derives country + ip_hash from request headers, and strips
-- the promoted keys back out of properties so the jsonb stays event-specific.
CREATE OR REPLACE FUNCTION public.track_event(
  p_event_name text,
  p_entity_type text DEFAULT NULL::text,
  p_entity_id uuid DEFAULT NULL::uuid,
  p_properties jsonb DEFAULT '{}'::jsonb,
  p_error_code text DEFAULT NULL::text,
  p_error_message text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_role TEXT;
  v_event_id UUID;
  v_headers json;
  v_country text;
  v_ip text;
  v_ip_hash text;
  v_props jsonb := COALESCE(p_properties, '{}'::jsonb);
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NOT NULL THEN
    SELECT role INTO v_role FROM profiles WHERE id = v_user_id;
  END IF;

  -- Request headers are only set on PostgREST calls (null otherwise).
  BEGIN
    v_headers := NULLIF(current_setting('request.headers', true), '')::json;
  EXCEPTION WHEN OTHERS THEN
    v_headers := NULL;
  END;

  IF v_headers IS NOT NULL THEN
    v_country := NULLIF(UPPER(COALESCE(v_headers->>'cf-ipcountry', v_headers->>'x-vercel-ip-country', '')), '');
    IF v_country IN ('XX','T1','') THEN v_country := NULL; END IF;  -- CF unknown/Tor
    v_ip := split_part(COALESCE(v_headers->>'cf-connecting-ip', v_headers->>'x-forwarded-for', ''), ',', 1);
    v_ip := NULLIF(trim(v_ip), '');
    IF v_ip IS NOT NULL THEN
      -- Salted pseudonymous hash (GDPR): never store the raw IP.
      v_ip_hash := md5(v_ip || '::hockia-analytics-v1');
    END IF;
  END IF;

  INSERT INTO events (
    event_name, user_id, role, entity_type, entity_id,
    session_id, anonymous_id, country, device, browser, referrer_source, utm,
    ip_hash, properties, error_code, error_message
  ) VALUES (
    p_event_name, v_user_id, v_role, p_entity_type, p_entity_id,
    v_props->>'session_id',
    v_props->>'anonymous_id',
    v_country,
    v_props->>'device',
    v_props->>'browser',
    v_props->>'referrer_source',
    CASE WHEN v_props ? 'utm' THEN v_props->'utm' ELSE NULL END,
    v_ip_hash,
    -- keep properties event-specific: drop the promoted identity/device keys
    (v_props - 'session_id' - 'anonymous_id' - 'device' - 'browser' - 'referrer_source' - 'utm'),
    p_error_code, p_error_message
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$function$;

-- ── 3. Signup attribution + identity stitching ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.signup_attribution (
  user_id        uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  anonymous_id   text,
  first_referrer text,
  first_source   text,
  utm            jsonb,
  landing_path   text,
  first_seen_at  timestamptz,
  signup_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.signup_attribution ENABLE ROW LEVEL SECURITY;
-- No public policies: written only via the SECURITY DEFINER RPC below, read
-- only by admin dashboards (service_role / admin RPCs bypass RLS).
CREATE INDEX IF NOT EXISTS signup_attribution_anon_idx ON public.signup_attribution (anonymous_id);
CREATE INDEX IF NOT EXISTS signup_attribution_source_idx ON public.signup_attribution (first_source);

-- Called once by the client right after registration completes. First-touch:
-- never overwrites an existing row. Also stitches every prior anonymous event
-- from this browser to the now-known user via resolved_user_id (preserving the
-- at-event-time anonymity in user_id).
CREATE OR REPLACE FUNCTION public.link_signup_attribution(
  p_anonymous_id text,
  p_first_referrer text DEFAULT NULL,
  p_first_source text DEFAULT NULL,
  p_utm jsonb DEFAULT NULL,
  p_landing_path text DEFAULT NULL,
  p_first_seen_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_anonymous_id IS NULL THEN RETURN; END IF;

  INSERT INTO signup_attribution (user_id, anonymous_id, first_referrer, first_source, utm, landing_path, first_seen_at)
  VALUES (v_uid, p_anonymous_id, p_first_referrer, p_first_source, p_utm, p_landing_path, p_first_seen_at)
  ON CONFLICT (user_id) DO NOTHING;

  -- Identity stitching: bounded to this browser's anonymous_id.
  UPDATE events
     SET resolved_user_id = v_uid
   WHERE anonymous_id = p_anonymous_id
     AND resolved_user_id IS NULL
     AND user_id IS NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.link_signup_attribution(text, text, text, jsonb, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_signup_attribution(text, text, text, jsonb, text, timestamptz) TO authenticated, service_role;
