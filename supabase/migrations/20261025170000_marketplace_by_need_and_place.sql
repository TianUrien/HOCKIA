-- Marketplace by need and place (founder 2026-10-25; Figma page 08, P6:
-- MK1–MK4). Community › Brands is the hub: offers and products grouped by the
-- member's need and by where they live (or are moving to). No checkout:
-- purchases stay on the brand's own site.
--
--   1. A `need` on offers and products: gear / moving_abroad /
--      training_recovery / for_clubs. Until a brand picks one, the brand's
--      category gives the default (brand_need_default). Set through
--      set_brand_offer_need / set_brand_product_need (the existing save RPCs
--      keep their signatures, so installed apps keep working).
--   2. get_marketplace(country): the items for a country, offers first. Offers
--      use the Phase 2 rules with the chosen country in place of the base
--      country (role targeted, adults only, not hidden, no blocked pair, not
--      dismissed, brand not hidden, never the brand itself; never
--      nationality). Products come from brands that sell in that country: the
--      brand's own country, or a live offer targeting it.
--   3. brand_suggestions: "Suggest a brand" (MK3), read by admins only.
--
-- Rollback: supabase/rollbacks/20261025170000_marketplace_by_need_and_place.down.sql

-- ------------------------------------------------------------ need
ALTER TABLE public.brand_offers ADD COLUMN need text
  CHECK (need IS NULL OR need IN ('gear', 'moving_abroad', 'training_recovery', 'for_clubs'));
ALTER TABLE public.brand_products ADD COLUMN need text
  CHECK (need IS NULL OR need IN ('gear', 'moving_abroad', 'training_recovery', 'for_clubs'));
-- brand_offers uses column-level SELECT grants (public columns only).
GRANT SELECT (need) ON public.brand_offers TO anon, authenticated;

-- The default need for a brand category (Equipment and Apparel → Gear,
-- Services → Training and recovery; the rest follow the closest fit).
CREATE OR REPLACE FUNCTION public.brand_need_default(p_category text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_category
    WHEN 'services' THEN 'training_recovery'
    WHEN 'coaching' THEN 'training_recovery'
    WHEN 'nutrition' THEN 'training_recovery'
    ELSE 'gear'
  END;
$$;
REVOKE ALL ON FUNCTION public.brand_need_default(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.brand_need_default(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_brand_offer_need(p_offer_id uuid, p_need text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_need IS NOT NULL AND p_need NOT IN ('gear', 'moving_abroad', 'training_recovery', 'for_clubs') THEN
    RAISE EXCEPTION 'invalid_need' USING ERRCODE = 'check_violation';
  END IF;
  -- The brand for its own offers; admins for any (they can change it).
  UPDATE public.brand_offers SET need = p_need
   WHERE id = p_offer_id
     AND (brand_id = (SELECT b.id FROM public.brands b WHERE b.profile_id = (SELECT auth.uid()) AND b.deleted_at IS NULL)
          OR public.is_platform_admin());
  IF NOT FOUND THEN RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'no_data_found'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_brand_offer_need(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_brand_offer_need(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_brand_product_need(p_product_id uuid, p_need text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_need IS NOT NULL AND p_need NOT IN ('gear', 'moving_abroad', 'training_recovery', 'for_clubs') THEN
    RAISE EXCEPTION 'invalid_need' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.brand_products SET need = p_need
   WHERE id = p_product_id AND deleted_at IS NULL
     AND (brand_id = (SELECT b.id FROM public.brands b WHERE b.profile_id = (SELECT auth.uid()) AND b.deleted_at IS NULL)
          OR public.is_platform_admin());
  IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'no_data_found'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_brand_product_need(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_brand_product_need(uuid, text) TO authenticated;

-- ------------------------------------------------------------ the hub
CREATE OR REPLACE FUNCTION public.get_marketplace(p_country_id integer DEFAULT NULL)
RETURNS TABLE (
  kind text, id uuid, brand_id uuid, brand_name text, brand_slug text, brand_logo_url text,
  brand_profile_id uuid, brand_category text, title text, body text, image_url text, link_url text,
  need text, created_at timestamptz, country_id integer, base_country_id integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := (SELECT auth.uid());
  m record;
  v_country integer;
BEGIN
  IF v_me IS NULL THEN RETURN; END IF;
  SELECT p.id, p.role, p.base_country_id, p.is_blocked, p.frozen_minor_at, p.date_of_birth INTO m FROM public.profiles p WHERE p.id = v_me;
  v_country := coalesce(p_country_id, m.base_country_id);
  -- Member fences, as for offers: adults only (club accounts are
  -- organisations), never hidden members, never brands.
  IF v_country IS NULL OR public.profile_is_hidden(m.is_blocked, m.frozen_minor_at)
     OR NOT (m.role = 'club' OR public.profile_is_adult(m.date_of_birth)) OR m.role = 'brand' THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH visible_brands AS (
    SELECT b.* FROM public.brands b
     WHERE public.brand_is_visible(b.id)
       AND b.profile_id <> v_me
       AND NOT public.is_blocked_pair(v_me, b.profile_id)
       AND NOT EXISTS (SELECT 1 FROM public.brand_hides h WHERE h.user_id = v_me AND h.brand_id = b.id)
  ),
  live_offers AS (
    SELECT o.* FROM public.brand_offers o
     WHERE o.status = 'live'
       AND (o.starts_at IS NULL OR o.starts_at <= now())
       AND (o.ends_at IS NULL OR o.ends_at > now())
  ),
  offers AS (
    SELECT 'offer'::text AS k, o.id AS oid, b.id AS bid, b.name, b.slug, b.logo_url, b.profile_id, b.category,
           o.title AS t, o.body AS bd, o.image_url AS img, o.link_url AS lnk,
           coalesce(o.need, public.brand_need_default(b.category)) AS nd, coalesce(o.live_at, o.created_at) AS at, 0 AS grp
      FROM live_offers o JOIN visible_brands b ON b.id = o.brand_id
     WHERE v_country = ANY (o.country_ids)
       AND m.role = ANY (o.roles)
       AND (nullif(btrim(o.area), '') IS NULL OR v_country <> m.base_country_id
            OR position(lower(btrim(o.area)) IN lower(coalesce((SELECT p.base_city FROM public.profiles p WHERE p.id = v_me), '') || ' ' || coalesce((SELECT p.base_location FROM public.profiles p WHERE p.id = v_me), ''))) > 0)
       AND NOT EXISTS (SELECT 1 FROM public.brand_offer_dismissals d WHERE d.user_id = v_me AND d.offer_id = o.id)
  ),
  products AS (
    SELECT 'product'::text, bp.id, b.id, b.name, b.slug, b.logo_url, b.profile_id, b.category,
           bp.name, bp.description,
           (SELECT x->>'url' FROM jsonb_array_elements(coalesce(bp.images, '[]'::jsonb)) x ORDER BY (x->>'order')::int NULLS LAST LIMIT 1),
           bp.external_url, coalesce(bp.need, public.brand_need_default(b.category)), bp.created_at, 1
      FROM public.brand_products bp JOIN visible_brands b ON b.id = bp.brand_id
     WHERE bp.deleted_at IS NULL
       AND (b.country_id = v_country OR EXISTS (SELECT 1 FROM live_offers lo WHERE lo.brand_id = b.id AND v_country = ANY (lo.country_ids)))
  )
  SELECT u.k, u.oid, u.bid, u.name, u.slug, u.logo_url, u.profile_id, u.category, u.t, u.bd, u.img, u.lnk, u.nd, u.at, v_country, m.base_country_id
    FROM (SELECT * FROM offers UNION ALL SELECT * FROM products) u
   ORDER BY u.grp, u.at DESC
   LIMIT 200;
END;
$$;
REVOKE ALL ON FUNCTION public.get_marketplace(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_marketplace(integer) TO authenticated;

-- ------------------------------------------------------------ suggest a brand
CREATE TABLE public.brand_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  brand_name text NOT NULL CHECK (char_length(btrim(brand_name)) BETWEEN 1 AND 80),
  link text CHECK (link IS NULL OR char_length(link) <= 300),
  country_id integer REFERENCES public.countries(id),
  note text CHECK (note IS NULL OR char_length(note) <= 300),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.brand_suggestions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_suggestions FROM anon, authenticated;
CREATE INDEX brand_suggestions_created_idx ON public.brand_suggestions (created_at DESC);

CREATE OR REPLACE FUNCTION public.suggest_brand(p_brand_name text, p_link text DEFAULT NULL, p_country_id integer DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := (SELECT auth.uid());
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_signed_in' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF nullif(btrim(p_brand_name), '') IS NULL THEN RAISE EXCEPTION 'name_required' USING ERRCODE = 'check_violation'; END IF;
  -- At most 10 suggestions a day per member.
  IF (SELECT count(*) FROM public.brand_suggestions s WHERE s.user_id = v_me AND s.created_at > now() - interval '1 day') >= 10 THEN
    RAISE EXCEPTION 'too_many_suggestions' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.brand_suggestions (user_id, brand_name, link, country_id, note)
  VALUES (v_me, btrim(p_brand_name), nullif(btrim(p_link), ''), p_country_id, nullif(btrim(p_note), ''));
END;
$$;
REVOKE ALL ON FUNCTION public.suggest_brand(text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_brand(text, text, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_brand_suggestions(p_limit integer DEFAULT 100)
RETURNS TABLE (id uuid, brand_name text, link text, country_id integer, note text, created_at timestamptz, suggested_by uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Unauthorized: admin access required'; END IF;
  RETURN QUERY
  SELECT s.id, s.brand_name, s.link, s.country_id, s.note, s.created_at, s.user_id
    FROM public.brand_suggestions s
   ORDER BY s.created_at DESC
   LIMIT least(greatest(coalesce(p_limit, 100), 1), 500);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_brand_suggestions(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_brand_suggestions(integer) TO authenticated;
