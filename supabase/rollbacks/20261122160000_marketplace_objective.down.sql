-- Rollback of 20261122160000_marketplace_objective.sql: get_marketplace
-- without the objective column, as in 20261107150000_brand_offer_perk_code.sql.
-- A client that reads objective gets none and shows the plain "Offer" pill.

DROP FUNCTION IF EXISTS public.get_marketplace(integer);
CREATE OR REPLACE FUNCTION public.get_marketplace(p_country_id integer DEFAULT NULL)
RETURNS TABLE (
  kind text, id uuid, brand_id uuid, brand_name text, brand_slug text, brand_logo_url text,
  brand_profile_id uuid, brand_category text, title text, body text, image_url text, link_url text,
  need text, created_at timestamptz, country_id integer, base_country_id integer, perk text
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
  IF public.profile_is_hidden(m.is_blocked, m.frozen_minor_at)
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
           coalesce(o.need, public.brand_need_default(b.category)) AS nd, coalesce(o.live_at, o.created_at) AS at, o.perk AS pk, 0 AS grp
      FROM live_offers o JOIN visible_brands b ON b.id = o.brand_id
     WHERE public.brand_offer_reaches(o.everywhere, o.country_ids, o.regions, v_country)
       AND m.role = ANY (o.roles)
       AND (nullif(btrim(o.area), '') IS NULL OR v_country IS DISTINCT FROM m.base_country_id
            OR position(lower(btrim(o.area)) IN lower(coalesce((SELECT p.base_city FROM public.profiles p WHERE p.id = v_me), '') || ' ' || coalesce((SELECT p.base_location FROM public.profiles p WHERE p.id = v_me), ''))) > 0)
       AND NOT EXISTS (SELECT 1 FROM public.brand_offer_dismissals d WHERE d.user_id = v_me AND d.offer_id = o.id)
  ),
  products AS (
    SELECT 'product'::text, bp.id, b.id, b.name, b.slug, b.logo_url, b.profile_id, b.category,
           bp.name, bp.description,
           (SELECT x->>'url' FROM jsonb_array_elements(coalesce(bp.images, '[]'::jsonb)) x ORDER BY (x->>'order')::int NULLS LAST LIMIT 1),
           bp.external_url, coalesce(bp.need, public.brand_need_default(b.category)), bp.created_at, NULL::text, 1
      FROM public.brand_products bp JOIN visible_brands b ON b.id = bp.brand_id
     WHERE bp.deleted_at IS NULL
       AND ((v_country IS NOT NULL AND b.country_id = ANY (public.country_family_ids(v_country)))
            OR EXISTS (SELECT 1 FROM live_offers lo WHERE lo.brand_id = b.id AND public.brand_offer_reaches(lo.everywhere, lo.country_ids, lo.regions, v_country)))
  )
  SELECT u.k, u.oid, u.bid, u.name, u.slug, u.logo_url, u.profile_id, u.category, u.t, u.bd, u.img, u.lnk, u.nd, u.at, v_country, m.base_country_id, u.pk
    FROM (SELECT * FROM offers UNION ALL SELECT * FROM products) u
   ORDER BY u.grp, u.at DESC
   LIMIT 200;
END;
$$;
REVOKE ALL ON FUNCTION public.get_marketplace(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_marketplace(integer) TO authenticated;
