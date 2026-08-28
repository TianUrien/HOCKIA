-- ════════════════════════════════════════════════════════════════════════
-- Attribution v2 — one engine, immutable first touch, normalized channels
-- (founder-approved plan, 2026-08-28; decisions D1–D3, D8)
--
-- Replaces the two parallel systems (lib/acquisition.ts →
-- profiles.acquisition_source, lib/analyticsIdentity.ts →
-- signup_attribution). Audit findings this fixes, all verified on prod:
--   · OAuth returns became permanent first touches (9 rows, every one with
--     landing_path=/auth/callback — reproduced live in a browser);
--   · raw fragments (www.google.co.in, l.instagram.com, "ig") in reporting;
--   · frozen-direct bias (3 real Instagram members recorded as "direct");
--   · 24% true channel conflicts between the two systems.
--
-- Design:
--   attribution_channel_rules  — the ONE normalization registry (client
--     ships a mirrored TS copy; a parity test keeps them identical).
--   normalize_attribution()    — server-side authority, pure, testable.
--   record_signup_attribution()— immutable write at registration; the
--     legacy link_signup_attribution() becomes a thin wrapper so already-
--     shipped native builds keep working.
--   Backfill                   — re-derives all existing profiles; auth-
--     provider corruption resolves to 'unknown' (their event history holds
--     no earlier source — verified user by user), never to a guess.
--
-- signup_attribution.first_source now always holds the NORMALIZED source,
-- which upgrades the retention service's source filter for free.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Normalization registry ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attribution_channel_rules (
  id            serial PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('utm', 'host')),
  pattern       text NOT NULL,           -- case-insensitive regex, anchored by the seed
  source        text NOT NULL,           -- normalized source ('' when discard)
  channel_group text NOT NULL,           -- social · search · ai_assistant · messaging · email · store · referral · qr · internal
  medium        text,                    -- default medium when the touch has none
  discard       boolean NOT NULL DEFAULT false,
  priority      integer NOT NULL,        -- lower wins; evaluated in order
  UNIQUE (kind, pattern)
);
ALTER TABLE public.attribution_channel_rules ENABLE ROW LEVEL SECURITY;
-- Readable by clients (the TS mirror is primary, this is the authority);
-- writable by nobody but service_role/migrations.
CREATE POLICY attribution_rules_read ON public.attribution_channel_rules
  FOR SELECT TO authenticated, anon USING (true);

INSERT INTO public.attribution_channel_rules (kind, pattern, source, channel_group, medium, discard, priority) VALUES
  -- ── discard: auth providers and our own surfaces are never a touch ──
  ('host', '^accounts\.google\.',            '', 'internal', NULL, true, 10),
  ('host', '^appleid\.apple\.com$',          '', 'internal', NULL, true, 11),
  ('host', '\.supabase\.co$',                '', 'internal', NULL, true, 12),
  ('host', '(^|\.)inhockia\.com$',           '', 'internal', NULL, true, 13),
  ('host', '^localhost$',                    '', 'internal', NULL, true, 14),
  -- ── AI assistants BEFORE generic google (gemini lives on google.com) ──
  ('host', '^gemini\.google\.com$',          'gemini',     'ai_assistant', 'referral', false, 20),
  ('host', '^(chat\.openai|chatgpt)\.com$',  'chatgpt',    'ai_assistant', 'referral', false, 21),
  ('host', '(^|\.)perplexity\.ai$',          'perplexity', 'ai_assistant', 'referral', false, 22),
  ('host', '^claude\.ai$',                   'claude',     'ai_assistant', 'referral', false, 23),
  ('host', '^copilot\.microsoft\.com$',      'copilot',    'ai_assistant', 'referral', false, 24),
  ('utm',  '^(chatgpt(\.com)?|openai)$',     'chatgpt',    'ai_assistant', 'referral', false, 25),
  ('utm',  '^perplexity$',                   'perplexity', 'ai_assistant', 'referral', false, 26),
  ('utm',  '^(claude|claude\.ai)$',          'claude',     'ai_assistant', 'referral', false, 27),
  ('utm',  '^(gemini|bard)$',                'gemini',     'ai_assistant', 'referral', false, 28),
  -- ── search ──
  ('host', '^(www\.)?google\.[a-z.]+$',      'google_organic', 'search', 'organic', false, 30),
  ('host', '(^|\.)bing\.com$',               'bing',           'search', 'organic', false, 31),
  ('host', '^duckduckgo\.com$',              'duckduckgo',     'search', 'organic', false, 32),
  ('host', '(^|\.)ecosia\.org$',             'ecosia',         'search', 'organic', false, 33),
  ('host', '(^|\.)search\.yahoo\.com$',      'yahoo',          'search', 'organic', false, 34),
  ('utm',  '^(google|adwords|gads)$',        'google_organic', 'search', 'organic', false, 35),
  ('utm',  '^bing$',                         'bing',           'search', 'organic', false, 36),
  -- ── social ──
  ('host', '(^|\.)(instagram\.com)$',        'instagram', 'social', 'social', false, 40),
  ('host', '^l\.instagram\.com$',            'instagram', 'social', 'social', false, 41),
  ('host', '(^|\.)(facebook\.com|fb\.com)$', 'facebook',  'social', 'social', false, 42),
  ('utm',  '^(ig|instagram)$',               'instagram', 'social', 'social', false, 43),
  ('utm',  '^(fb|facebook|meta)$',           'facebook',  'social', 'social', false, 44),
  ('host', '(^|\.)linkedin\.com$',           'linkedin',  'social', 'social', false, 45),
  ('host', '^lnkd\.in$',                     'linkedin',  'social', 'social', false, 46),
  ('utm',  '^linkedin$',                     'linkedin',  'social', 'social', false, 47),
  ('host', '^(t\.co|twitter\.com|x\.com)$',  'x',         'social', 'social', false, 48),
  ('utm',  '^(twitter|x)$',                  'x',         'social', 'social', false, 49),
  ('host', '(^|\.)(youtube\.com)$|^youtu\.be$', 'youtube', 'social', 'social', false, 50),
  ('utm',  '^youtube$',                      'youtube',   'social', 'social', false, 51),
  -- ── messaging ──
  ('host', '^(wa\.me|(web|api)\.whatsapp\.com)$', 'whatsapp', 'messaging', 'messaging', false, 60),
  ('utm',  '^(whatsapp|wa)$',                'whatsapp', 'messaging', 'messaging', false, 61),
  ('host', '^(t\.me|telegram\.me)$',         'telegram', 'messaging', 'messaging', false, 62),
  ('utm',  '^(telegram|tg)$',                'telegram', 'messaging', 'messaging', false, 63),
  -- ── email / qr / stores ──
  ('utm',  '^(email|newsletter|resend|gmass|mailchimp)$', 'email', 'email', 'email', false, 70),
  ('utm',  '^qr$',                           'qr',          'qr',    'qr',      false, 71),
  ('host', '^play\.google\.com$',            'google_play', 'store', 'referral', false, 72),
  ('host', '^apps\.apple\.com$',             'app_store',   'store', 'referral', false, 73)
ON CONFLICT (kind, pattern) DO UPDATE
  SET source = EXCLUDED.source, channel_group = EXCLUDED.channel_group,
      medium = EXCLUDED.medium, discard = EXCLUDED.discard, priority = EXCLUDED.priority;

-- ── 2. The server-side normalizer (authority) ───────────────────────────
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
  v_utm  text := lower(btrim(coalesce(p_utm_source, '')));
  v_host text := lower(btrim(coalesce(p_referrer_host, '')));
  r RECORD;
BEGIN
  -- UTM wins over referrer (an explicitly tagged link is the stronger claim).
  IF v_utm <> '' THEN
    FOR r IN SELECT * FROM attribution_channel_rules WHERE kind = 'utm' AND v_utm ~* pattern ORDER BY priority LIMIT 1 LOOP
      RETURN QUERY SELECT r.source, r.channel_group, r.medium, 'utm'::text, r.discard; RETURN;
    END LOOP;
    -- Unknown utm slug: keep it as its own (lowercased) source, never fragmenting known channels.
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

GRANT EXECUTE ON FUNCTION public.normalize_attribution(text, text) TO authenticated;

-- ── 3. signup_attribution v2 columns ────────────────────────────────────
ALTER TABLE public.signup_attribution
  ADD COLUMN IF NOT EXISTS first_touch_source     text,
  ADD COLUMN IF NOT EXISTS first_touch_group      text,
  ADD COLUMN IF NOT EXISTS first_touch_medium     text,
  ADD COLUMN IF NOT EXISTS first_touch_campaign   text,
  ADD COLUMN IF NOT EXISTS first_touch_content    text,
  ADD COLUMN IF NOT EXISTS first_touch_term       text,
  ADD COLUMN IF NOT EXISTS first_touch_referrer   text,
  ADD COLUMN IF NOT EXISTS first_touch_domain     text,
  ADD COLUMN IF NOT EXISTS first_touch_landing    text,
  ADD COLUMN IF NOT EXISTS last_nd_source         text,
  ADD COLUMN IF NOT EXISTS last_nd_group          text,
  ADD COLUMN IF NOT EXISTS last_nd_campaign       text,
  ADD COLUMN IF NOT EXISTS last_nd_at             timestamptz,
  ADD COLUMN IF NOT EXISTS session_source         text,
  ADD COLUMN IF NOT EXISTS platform               text,
  ADD COLUMN IF NOT EXISTS device_category        text,
  ADD COLUMN IF NOT EXISTS deep_link              text,
  ADD COLUMN IF NOT EXISTS link_id                text,
  ADD COLUMN IF NOT EXISTS attribution_method     text,
  ADD COLUMN IF NOT EXISTS attribution_confidence text,
  ADD COLUMN IF NOT EXISTS raw                    jsonb;

CREATE INDEX IF NOT EXISTS signup_attribution_ft_source_idx
  ON public.signup_attribution (first_touch_source);

-- ── 4. Immutable write at registration ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_signup_attribution(p jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ft  RECORD;
  v_ln  RECORD;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  -- Server is the authority on normalization; the client's labels are advisory.
  SELECT * INTO v_ft FROM normalize_attribution(p->'first_touch'->>'utm_source', p->'first_touch'->>'referring_domain');
  SELECT * INTO v_ln FROM normalize_attribution(p->'last_nd'->>'utm_source',   p->'last_nd'->>'referring_domain');

  INSERT INTO signup_attribution (
    user_id, anonymous_id,
    first_referrer, first_source, utm, landing_path, first_seen_at,  -- legacy columns stay coherent
    first_touch_source, first_touch_group, first_touch_medium, first_touch_campaign,
    first_touch_content, first_touch_term, first_touch_referrer, first_touch_domain,
    first_touch_landing, last_nd_source, last_nd_group, last_nd_campaign, last_nd_at,
    session_source, platform, device_category, deep_link, link_id,
    attribution_method, attribution_confidence, raw
  )
  VALUES (
    v_uid,
    p->>'anonymous_id',
    p->'first_touch'->>'referrer',
    CASE WHEN v_ft.discarded THEN 'unknown' ELSE v_ft.source END,
    NULLIF(p->'first_touch'->'utm', 'null'::jsonb),
    p->'first_touch'->>'landing_page',
    NULLIF(p->'first_touch'->>'captured_at', '')::timestamptz,
    CASE WHEN v_ft.discarded THEN 'unknown' ELSE v_ft.source END,
    CASE WHEN v_ft.discarded THEN 'unknown' ELSE v_ft.channel_group END,
    COALESCE(p->'first_touch'->'utm'->>'medium', v_ft.medium),
    p->'first_touch'->'utm'->>'campaign',
    p->'first_touch'->'utm'->>'content',
    p->'first_touch'->'utm'->>'term',
    p->'first_touch'->>'referrer',
    p->'first_touch'->>'referring_domain',
    p->'first_touch'->>'landing_page',
    CASE WHEN v_ln.discarded OR v_ln.source = 'direct' THEN NULL ELSE v_ln.source END,
    CASE WHEN v_ln.discarded OR v_ln.source = 'direct' THEN NULL ELSE v_ln.channel_group END,
    p->'last_nd'->'utm'->>'campaign',
    NULLIF(p->'last_nd'->>'captured_at', '')::timestamptz,
    p->>'session_source',
    p->>'platform',
    p->>'device_category',
    p->>'deep_link',
    p->>'link_id',
    COALESCE(p->>'attribution_method', v_ft.method),
    COALESCE(p->>'attribution_confidence',
             CASE WHEN v_ft.method = 'utm' THEN 'high'
                  WHEN v_ft.method = 'referrer' THEN 'medium'
                  ELSE 'low' END),
    p
  )
  ON CONFLICT (user_id) DO NOTHING;  -- immutable: first write wins, forever

  -- Identity stitching, bounded to this browser's anonymous id.
  IF p->>'anonymous_id' IS NOT NULL THEN
    UPDATE events SET resolved_user_id = v_uid
     WHERE anonymous_id = p->>'anonymous_id'
       AND resolved_user_id IS NULL AND user_id IS NULL;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_signup_attribution(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_signup_attribution(jsonb) TO authenticated, service_role;

-- Legacy shim: already-shipped clients (native 1.16 / 1.3.15) call this.
CREATE OR REPLACE FUNCTION public.link_signup_attribution(
  p_anonymous_id text,
  p_first_referrer text DEFAULT NULL,
  p_first_source text DEFAULT NULL,
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
      'referring_domain', CASE
        WHEN p_first_referrer ~* '^https?://' THEN split_part(split_part(p_first_referrer, '//', 2), '/', 1)
        ELSE p_first_referrer END,
      'landing_page', p_landing_path,
      'captured_at', p_first_seen_at
    )
  ));
$$;

-- ── 5. Backfill every existing profile ──────────────────────────────────
-- Evidence order: stored utm → stored/meta referrer → earliest stitched
-- event channel → direct/unknown. Auth-provider values discard to 'unknown'.
DO $$
DECLARE
  prof RECORD;
  v_sa RECORD;
  v_utm_src text; v_ref text; v_host text; v_landing text; v_seen timestamptz;
  v_meta jsonb; v_ev_channel text; v_n RECORD;
  v_source text; v_group text; v_method text; v_conf text;
  v_done int := 0;
BEGIN
  FOR prof IN SELECT p.id, p.created_at, p.acquisition_source, p.acquisition_meta, p.last_platform
              FROM profiles p LOOP
    SELECT * INTO v_sa FROM signup_attribution s WHERE s.user_id = prof.id;
    IF v_sa.user_id IS NOT NULL AND v_sa.first_touch_source IS NOT NULL THEN CONTINUE; END IF;

    v_meta := prof.acquisition_meta;
    -- utm evidence: sa.utm.source, else meta.source when meta carried a medium (i.e. real utm capture)
    v_utm_src := COALESCE(v_sa.utm->>'source', CASE WHEN v_meta ? 'medium' THEN v_meta->>'source' END);
    -- referrer evidence
    v_ref  := COALESCE(v_sa.first_referrer, v_meta->>'referrer',
                       CASE WHEN prof.acquisition_source LIKE '%.%' THEN prof.acquisition_source END);
    v_host := CASE WHEN v_ref ~* '^https?://' THEN split_part(split_part(v_ref, '//', 2), '/', 1) ELSE v_ref END;
    v_landing := COALESCE(v_sa.landing_path, v_meta->>'landing_path');
    v_seen := COALESCE(v_sa.first_seen_at, NULLIF(v_meta->>'captured_at', '')::timestamptz, prof.created_at);

    SELECT * INTO v_n FROM normalize_attribution(v_utm_src, v_host);
    v_source := v_n.source; v_group := v_n.channel_group; v_method := 'backfilled';
    v_conf := CASE WHEN v_n.method = 'utm' THEN 'high' WHEN v_n.method = 'referrer' THEN 'medium' ELSE 'low' END;

    IF v_n.discarded OR v_source = 'direct' THEN
      -- fall back to the earliest stitched event channel
      SELECT e.referrer_source INTO v_ev_channel
      FROM events e
      WHERE (e.user_id = prof.id OR e.resolved_user_id = prof.id)
        AND e.referrer_source IS NOT NULL
        AND e.referrer_source NOT IN ('direct', 'internal')
      ORDER BY e.created_at LIMIT 1;

      IF v_ev_channel IS NOT NULL THEN
        v_source := CASE v_ev_channel
          WHEN 'google' THEN 'google_organic'
          WHEN 'meta' THEN 'meta'          -- event channel cannot split ig/fb
          WHEN 'twitter' THEN 'x'
          WHEN 'chatgpt.com' THEN 'chatgpt'
          ELSE v_ev_channel END;
        v_group := CASE v_source
          WHEN 'google_organic' THEN 'search' WHEN 'bing' THEN 'search' WHEN 'duckduckgo' THEN 'search'
          WHEN 'meta' THEN 'social' WHEN 'linkedin' THEN 'social' WHEN 'x' THEN 'social' WHEN 'youtube' THEN 'social'
          WHEN 'chatgpt' THEN 'ai_assistant'
          ELSE 'referral' END;
        v_conf := 'low';
      ELSIF v_n.discarded THEN
        v_source := 'unknown'; v_group := 'unknown'; v_conf := 'low';
      END IF; -- plain 'direct' with no event signal stays 'direct'
    END IF;

    INSERT INTO signup_attribution (
      user_id, anonymous_id, first_referrer, first_source, utm, landing_path, first_seen_at,
      first_touch_source, first_touch_group, first_touch_medium, first_touch_campaign,
      first_touch_referrer, first_touch_domain, first_touch_landing,
      platform, attribution_method, attribution_confidence, raw, signup_at
    ) VALUES (
      prof.id, v_sa.anonymous_id, v_ref,
      v_source, v_sa.utm, v_landing, v_seen,
      v_source, v_group, COALESCE(v_sa.utm->>'medium', v_meta->>'medium'), v_sa.utm->>'campaign',
      v_ref, v_host, v_landing,
      prof.last_platform, v_method, v_conf,
      jsonb_build_object('backfill', true, 'legacy_acquisition_source', prof.acquisition_source,
                         'legacy_acquisition_meta', v_meta, 'legacy_first_source', v_sa.first_source),
      COALESCE(v_sa.signup_at, prof.created_at)
    )
    ON CONFLICT (user_id) DO UPDATE SET
      first_source           = EXCLUDED.first_source,
      first_touch_source     = EXCLUDED.first_touch_source,
      first_touch_group      = EXCLUDED.first_touch_group,
      first_touch_medium     = EXCLUDED.first_touch_medium,
      first_touch_campaign   = EXCLUDED.first_touch_campaign,
      first_touch_referrer   = EXCLUDED.first_touch_referrer,
      first_touch_domain     = EXCLUDED.first_touch_domain,
      first_touch_landing    = EXCLUDED.first_touch_landing,
      platform               = COALESCE(signup_attribution.platform, EXCLUDED.platform),
      attribution_method     = EXCLUDED.attribution_method,
      attribution_confidence = EXCLUDED.attribution_confidence,
      raw                    = COALESCE(signup_attribution.raw, '{}'::jsonb) || EXCLUDED.raw
    WHERE signup_attribution.first_touch_source IS NULL;  -- backfill never overwrites a live v2 write

    v_done := v_done + 1;
  END LOOP;
  RAISE NOTICE 'attribution backfill processed % profiles', v_done;
END $$;

-- D8: the legacy column stops being written by clients; align it one final
-- time so any remaining reader shows normalized values.
UPDATE profiles p
   SET acquisition_source = sa.first_touch_source
  FROM signup_attribution sa
 WHERE sa.user_id = p.id
   AND sa.first_touch_source IS NOT NULL
   AND p.acquisition_source IS DISTINCT FROM sa.first_touch_source;

-- ── 6. Admin acquisition report ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_acquisition_report(p_days integer DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from timestamptz := now() - make_interval(days => p_days);
  v_prev_from timestamptz := now() - make_interval(days => p_days * 2);
  v_result jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  WITH base AS (
    SELECT sa.*, p.created_at AS joined_at, p.onboarding_completed
    FROM signup_attribution sa
    JOIN profiles p ON p.id = sa.user_id
    WHERE COALESCE(p.is_test_account, false) = false
  ),
  cur AS (SELECT * FROM base WHERE joined_at >= v_from),
  prev AS (SELECT * FROM base WHERE joined_at >= v_prev_from AND joined_at < v_from),
  prev_agg AS (
    SELECT COALESCE(first_touch_source, 'unknown') AS source, COUNT(*)::int AS prev_signups
    FROM prev GROUP BY 1
  ),
  by_channel AS (
    SELECT
      COALESCE(c.first_touch_source, 'unknown') AS source,
      MAX(COALESCE(c.first_touch_group, 'unknown')) AS channel_group,
      COUNT(*)::int AS signups,
      COUNT(*) FILTER (WHERE c.onboarding_completed)::int AS activated,
      COALESCE(MAX(pa.prev_signups), 0) AS prev_signups
    FROM cur c
    LEFT JOIN prev_agg pa ON pa.source = COALESCE(c.first_touch_source, 'unknown')
    GROUP BY COALESCE(c.first_touch_source, 'unknown')
  )
  SELECT jsonb_build_object(
    'period_days', p_days,
    'generated_at', now(),
    'total_signups', (SELECT COUNT(*) FROM cur),
    'channels', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'source', source, 'group', channel_group, 'signups', signups,
        'activated', activated, 'prev_signups', prev_signups
      ) ORDER BY signups DESC) FROM by_channel), '[]'::jsonb),
    'methods', COALESCE((SELECT jsonb_object_agg(m, n) FROM (
        SELECT COALESCE(attribution_method, 'unknown') m, COUNT(*)::int n FROM cur GROUP BY 1) x), '{}'::jsonb),
    'confidence', COALESCE((SELECT jsonb_object_agg(m, n) FROM (
        SELECT COALESCE(attribution_confidence, 'unknown') m, COUNT(*)::int n FROM cur GROUP BY 1) x), '{}'::jsonb),
    'platforms', COALESCE((SELECT jsonb_object_agg(m, n) FROM (
        SELECT COALESCE(platform, 'unknown') m, COUNT(*)::int n FROM cur GROUP BY 1) x), '{}'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_acquisition_report(integer) TO authenticated;
