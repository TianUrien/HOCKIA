-- Brand offers, Phase 2: members see offers (Figma 08 · Brands P2; founder
-- go-ahead 2026-10-25). Home card, Hockia AI card, Community › Brands rail and
-- the offer detail all read through these RPCs; nothing is exposed by table.
--
-- Who can see an offer (server side, never nationality):
--   live and inside its dates, brand visible (brand_is_visible);
--   the member's base country is a target country, and the offer's optional
--   area (region or city) appears in the member's base city / location;
--   the member's role is a target role;
--   the member is not hidden, not the brand itself, not in a blocked pair with
--   the brand's profile, and an adult: players, coaches and umpires need a date
--   of birth showing 18+ (no date = not shown); club accounts are
--   organisations and need none (same split as profile_is_uncontactable);
--   the member hasn't dismissed the offer nor hidden the brand.
--
-- Order: offers this member has never been shown first, then the least
-- recently shown, then random. No paid ranking (free period).
--
-- Rollback: supabase/rollbacks/20261025100000_brand_offers_for_members.down.sql

-- ------------------------------------------------------------ member choices
CREATE TABLE public.brand_offer_dismissals (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  offer_id uuid NOT NULL REFERENCES public.brand_offers(id) ON DELETE CASCADE,
  reason text CHECK (reason IN ('not_for_me', 'already_have', 'wrong_country', 'too_many', 'hide_brand')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, offer_id)
);
CREATE TABLE public.brand_hides (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, brand_id)
);
-- Only through the RPCs below.
ALTER TABLE public.brand_offer_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_hides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_offer_dismissals FROM anon, authenticated;
REVOKE ALL ON TABLE public.brand_hides FROM anon, authenticated;
CREATE INDEX brand_offer_dismissals_offer_idx ON public.brand_offer_dismissals (offer_id);
CREATE INDEX brand_hides_brand_idx ON public.brand_hides (brand_id);
-- "When was this offer last shown to me": impressions by user.
CREATE INDEX IF NOT EXISTS events_brand_offer_user_idx
  ON public.events (user_id, entity_id, created_at)
  WHERE entity_type = 'brand_offer' AND event_name = 'brand_offer_impression';

-- ------------------------------------------------------------ eligibility
CREATE OR REPLACE FUNCTION public.brand_offer_eligible_for(p_offer public.brand_offers, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles m
      JOIN public.brands b ON b.id = p_offer.brand_id
     WHERE m.id = p_user
       AND p_offer.status = 'live'
       AND (p_offer.starts_at IS NULL OR p_offer.starts_at <= now())
       AND (p_offer.ends_at IS NULL OR p_offer.ends_at > now())
       AND public.brand_is_visible(p_offer.brand_id)
       AND m.base_country_id = ANY (p_offer.country_ids)
       AND (nullif(btrim(p_offer.area), '') IS NULL
            OR position(lower(btrim(p_offer.area)) IN lower(coalesce(m.base_city, '') || ' ' || coalesce(m.base_location, ''))) > 0)
       AND m.role = ANY (p_offer.roles)
       AND NOT public.profile_is_hidden(m.is_blocked, m.frozen_minor_at)
       AND (m.role = 'club' OR public.profile_is_adult(m.date_of_birth))
       AND b.profile_id <> m.id
       AND NOT public.is_blocked_pair(m.id, b.profile_id)
       AND NOT EXISTS (SELECT 1 FROM public.brand_offer_dismissals d WHERE d.user_id = m.id AND d.offer_id = p_offer.id)
       AND NOT EXISTS (SELECT 1 FROM public.brand_hides h WHERE h.user_id = m.id AND h.brand_id = p_offer.brand_id)
  );
$$;
REVOKE ALL ON FUNCTION public.brand_offer_eligible_for(public.brand_offers, uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------ member reads
-- Offers for the signed-in member, best first. p_limit 1 for Home and Hockia
-- AI; larger for the Brands rail.
CREATE OR REPLACE FUNCTION public.get_brand_offers_for_me(p_limit integer DEFAULT 1)
RETURNS TABLE (
  id uuid, brand_id uuid, title text, body text, image_url text, link_url text,
  country_ids integer[], area text, roles text[], ends_at timestamptz,
  brand_name text, brand_slug text, brand_logo_url text, brand_category text,
  brand_country_id integer, brand_profile_id uuid, brand_open_to_partners boolean,
  member_country_id integer, last_shown_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := (SELECT auth.uid());
BEGIN
  IF v_me IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT o.id, o.brand_id, o.title, o.body, o.image_url, o.link_url,
         o.country_ids, o.area, o.roles, o.ends_at,
         b.name, b.slug, b.logo_url, b.category, b.country_id, b.profile_id, coalesce(b.open_to_partners, false),
         (SELECT m.base_country_id FROM public.profiles m WHERE m.id = v_me),
         (SELECT max(e.created_at) FROM public.events e
           WHERE e.user_id = v_me AND e.entity_type = 'brand_offer' AND e.entity_id = o.id
             AND e.event_name = 'brand_offer_impression')
    FROM public.brand_offers o
    JOIN public.brands b ON b.id = o.brand_id
   WHERE o.status = 'live'
     AND public.brand_offer_eligible_for(o, v_me)
   ORDER BY 19 ASC NULLS FIRST, random()
   LIMIT least(greatest(coalesce(p_limit, 1), 1), 50);
END;
$$;
REVOKE ALL ON FUNCTION public.get_brand_offers_for_me(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_brand_offers_for_me(integer) TO authenticated;

-- One offer for the detail screen (OD1 / OD2). Any live offer of a visible
-- brand can be opened by a member (live offers are already readable); eligible
-- says whether the reason line applies to this member.
CREATE OR REPLACE FUNCTION public.get_brand_offer_detail(p_offer_id uuid)
RETURNS TABLE (
  id uuid, brand_id uuid, title text, body text, image_url text, link_url text,
  country_ids integer[], area text, roles text[], ends_at timestamptz,
  brand_name text, brand_slug text, brand_logo_url text, brand_category text,
  brand_country_id integer, brand_profile_id uuid, brand_open_to_partners boolean,
  member_country_id integer, eligible boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := (SELECT auth.uid());
BEGIN
  RETURN QUERY
  SELECT o.id, o.brand_id, o.title, o.body, o.image_url, o.link_url,
         o.country_ids, o.area, o.roles, o.ends_at,
         b.name, b.slug, b.logo_url, b.category, b.country_id, b.profile_id, coalesce(b.open_to_partners, false),
         (SELECT m.base_country_id FROM public.profiles m WHERE m.id = v_me),
         (v_me IS NOT NULL AND public.brand_offer_eligible_for(o, v_me))
    FROM public.brand_offers o
    JOIN public.brands b ON b.id = o.brand_id
   WHERE o.id = p_offer_id
     AND o.status = 'live'
     AND (o.starts_at IS NULL OR o.starts_at <= now())
     AND (o.ends_at IS NULL OR o.ends_at > now())
     AND public.brand_is_visible(o.brand_id)
     AND (v_me IS NULL OR NOT public.is_blocked_pair(v_me, b.profile_id));
END;
$$;
REVOKE ALL ON FUNCTION public.get_brand_offer_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_brand_offer_detail(uuid) TO authenticated;

-- ------------------------------------------------------------ member writes
-- "Not useful": records the dismissal (reason optional, can be added after);
-- 'hide_brand' also hides every offer from that brand for this member.
CREATE OR REPLACE FUNCTION public.dismiss_brand_offer(p_offer_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := (SELECT auth.uid());
  v_brand uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_reason IS NOT NULL AND p_reason NOT IN ('not_for_me', 'already_have', 'wrong_country', 'too_many', 'hide_brand') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = 'check_violation';
  END IF;
  SELECT o.brand_id INTO v_brand FROM public.brand_offers o WHERE o.id = p_offer_id AND o.status IN ('live', 'paused', 'ended');
  IF v_brand IS NULL THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO public.brand_offer_dismissals (user_id, offer_id, reason)
  VALUES (v_me, p_offer_id, p_reason)
  ON CONFLICT (user_id, offer_id) DO UPDATE SET reason = coalesce(EXCLUDED.reason, brand_offer_dismissals.reason);
  IF p_reason = 'hide_brand' THEN
    INSERT INTO public.brand_hides (user_id, brand_id) VALUES (v_me, v_brand) ON CONFLICT DO NOTHING;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.dismiss_brand_offer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_brand_offer(uuid, text) TO authenticated;

-- Undo (H2): removes this member's dismissal and, if it hid the brand, the hide.
CREATE OR REPLACE FUNCTION public.undo_dismiss_brand_offer(p_offer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := (SELECT auth.uid());
  v_reason text;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM public.brand_offer_dismissals d WHERE d.user_id = v_me AND d.offer_id = p_offer_id RETURNING d.reason INTO v_reason;
  IF v_reason = 'hide_brand' THEN
    DELETE FROM public.brand_hides h
     WHERE h.user_id = v_me AND h.brand_id = (SELECT o.brand_id FROM public.brand_offers o WHERE o.id = p_offer_id);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.undo_dismiss_brand_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_dismiss_brand_offer(uuid) TO authenticated;

-- "Hide this brand" from the offer detail's ••• menu (no single offer dismissed).
CREATE OR REPLACE FUNCTION public.hide_brand_offers(p_brand_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := (SELECT auth.uid());
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.brand_hides (user_id, brand_id)
  SELECT v_me, b.id FROM public.brands b WHERE b.id = p_brand_id
  ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.hide_brand_offers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hide_brand_offers(uuid) TO authenticated;
