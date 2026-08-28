-- Attribution v2 — Phase 2: short links (app.inhockia.com/l/<code>).
--
-- A short link is a founder-minted code that expands to a destination plus a
-- fixed utm set. The client route /l/:code resolves it here (anon-callable),
-- the resolver logs the click, and the in-app redirect lands the visitor on
-- destination?utm_*&hk_link=<code> so the Phase 1 engine records the touch
-- with link_id — which is how a link's clicks become attributable signups.
--
-- Rules:
-- * codes are immutable identifiers (attribution rows point at them); a link
--   is deactivated, never deleted.
-- * utm_source is stored RAW; the channel it maps to is decided by the same
--   normalize_attribution() registry as everything else (shown to the admin
--   at mint time so a typo can't create a new channel by accident).
-- * clicks carry no PII: code, time, platform, referrer host, device class.

CREATE TABLE IF NOT EXISTS public.short_links (
  code            text PRIMARY KEY CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,31}$'),
  label           text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  -- '/path' inside the app, an absolute https URL, or the keyword 'store'
  -- (iOS → App Store, otherwise Play with the utm set in the install referrer).
  destination     text NOT NULL DEFAULT '/'
                  CHECK (destination = 'store' OR destination ~ '^/' OR destination ~ '^https://'),
  utm_source      text NOT NULL CHECK (length(utm_source) BETWEEN 1 AND 64),
  utm_medium      text CHECK (utm_medium IS NULL OR length(utm_medium) <= 64),
  utm_campaign    text CHECK (utm_campaign IS NULL OR length(utm_campaign) <= 64),
  utm_content     text CHECK (utm_content IS NULL OR length(utm_content) <= 64),
  utm_term        text CHECK (utm_term IS NULL OR length(utm_term) <= 64),
  is_active       boolean NOT NULL DEFAULT true,
  click_count     integer NOT NULL DEFAULT 0,
  last_clicked_at timestamptz,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.short_link_clicks (
  id              bigserial PRIMARY KEY,
  code            text NOT NULL REFERENCES public.short_links(code) ON DELETE CASCADE,
  clicked_at      timestamptz NOT NULL DEFAULT now(),
  platform        text,
  referrer_host   text,
  device_category text
);
CREATE INDEX IF NOT EXISTS short_link_clicks_code_time_idx ON public.short_link_clicks (code, clicked_at DESC);

-- Admin surfaces only: no member policies. The functions below are
-- SECURITY DEFINER and enforce their own access rules.
ALTER TABLE public.short_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.short_link_clicks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.short_links FROM anon, authenticated;
REVOKE ALL ON public.short_link_clicks FROM anon, authenticated;

-- ── resolve (public) ─────────────────────────────────────────────────────

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

  INSERT INTO public.short_link_clicks (code, platform, referrer_host, device_category)
  VALUES (v_link.code, left(p_platform, 16), left(p_referrer_host, 128), left(p_device, 16));
  UPDATE public.short_links
     SET click_count = click_count + 1, last_clicked_at = now()
   WHERE code = v_link.code;

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
REVOKE ALL ON FUNCTION public.resolve_short_link(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_short_link(text, text, text, text) TO anon, authenticated, service_role;

-- ── admin ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_list_short_links()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'code', l.code,
      'label', l.label,
      'destination', l.destination,
      'utm_source', l.utm_source,
      'utm_medium', l.utm_medium,
      'utm_campaign', l.utm_campaign,
      'utm_content', l.utm_content,
      'utm_term', l.utm_term,
      'is_active', l.is_active,
      'click_count', l.click_count,
      'last_clicked_at', l.last_clicked_at,
      'created_at', l.created_at,
      'clicks_30d', (SELECT COUNT(*) FROM public.short_link_clicks c
                      WHERE c.code = l.code AND c.clicked_at >= now() - interval '30 days'),
      'signups', (SELECT COUNT(*) FROM public.signup_attribution sa
                   LEFT JOIN public.profiles p ON p.id = sa.user_id
                   WHERE sa.link_id = l.code AND COALESCE(p.is_test_account, false) = false),
      'normalized_source', (SELECT n.source FROM public.normalize_attribution(l.utm_source, NULL) n)
    ) ORDER BY l.is_active DESC, l.created_at)
    FROM public.short_links l
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_short_links() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_short_links() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_upsert_short_link(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text := lower(trim(p->>'code'));
  v_row public.short_links%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;
  IF v_code !~ '^[a-z0-9][a-z0-9-]{1,31}$' THEN
    RAISE EXCEPTION 'Code must be 2–32 characters: lowercase letters, digits, hyphens' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.short_links (code, label, destination, utm_source, utm_medium, utm_campaign, utm_content, utm_term, is_active, created_by)
  VALUES (
    v_code,
    trim(p->>'label'),
    COALESCE(NULLIF(trim(p->>'destination'), ''), '/'),
    lower(trim(p->>'utm_source')),
    NULLIF(lower(trim(p->>'utm_medium')), ''),
    NULLIF(trim(p->>'utm_campaign'), ''),
    NULLIF(trim(p->>'utm_content'), ''),
    NULLIF(trim(p->>'utm_term'), ''),
    COALESCE((p->>'is_active')::boolean, true),
    auth.uid()
  )
  ON CONFLICT (code) DO UPDATE SET
    label        = EXCLUDED.label,
    destination  = EXCLUDED.destination,
    utm_source   = EXCLUDED.utm_source,
    utm_medium   = EXCLUDED.utm_medium,
    utm_campaign = EXCLUDED.utm_campaign,
    utm_content  = EXCLUDED.utm_content,
    utm_term     = EXCLUDED.utm_term,
    is_active    = EXCLUDED.is_active,
    updated_at   = now()
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_short_link(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_short_link(jsonb) TO authenticated;

-- ── the founder's starter pack ───────────────────────────────────────────
-- Idempotent: existing codes are left exactly as the admin last saved them.

INSERT INTO public.short_links (code, label, destination, utm_source, utm_medium, utm_campaign) VALUES
  ('ig',     'Instagram bio',          '/',     'instagram', 'social',    'bio'),
  ('li',     'LinkedIn profile',       '/',     'linkedin',  'social',    'profile'),
  ('wa',     'WhatsApp groups',        '/',     'whatsapp',  'messaging', 'groups'),
  ('em',     'Email signature',        '/',     'email',     'email',     'signature'),
  ('qr',     'Printed QR code',        '/',     'qr',        'offline',   'print'),
  ('ig-app', 'Instagram → app stores', 'store', 'instagram', 'social',    'bio_app')
ON CONFLICT (code) DO NOTHING;
