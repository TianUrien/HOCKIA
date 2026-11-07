-- Rollback for 20261107130000_brand_offer_reach.sql: restores the previous
-- function bodies and constraint. Offers saved as Everywhere or by region keep
-- those columns until they are dropped below; check them first:
--   SELECT id, status FROM public.brand_offers WHERE everywhere OR cardinality(regions) > 0;
-- (live ones must get countries or be ended before the constraint is restored).

DROP FUNCTION IF EXISTS public.get_brand_offer_reach(boolean, integer[], text[], text[], text);
DROP FUNCTION IF EXISTS public.save_brand_offer(uuid, text, text, text, text, integer[], text, text[], timestamptz, timestamptz, boolean, boolean, text[]);
DROP FUNCTION IF EXISTS public.get_brand_offers_for_me(integer);
DROP FUNCTION IF EXISTS public.get_brand_offer_detail(uuid);
DROP FUNCTION IF EXISTS public.get_my_brand_offers();

CREATE OR REPLACE FUNCTION public.brand_offer_problem(p jsonb)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_countries integer[];
  v_roles text[];
BEGIN
  IF coalesce(char_length(btrim(p->>'title')), 0) NOT BETWEEN 1 AND 60 THEN RETURN 'title'; END IF;
  IF coalesce(char_length(btrim(p->>'body')), 0) NOT BETWEEN 1 AND 140 THEN RETURN 'body'; END IF;
  IF coalesce(p->>'link_url', '') !~ '^https://[^[:space:]]+$' OR char_length(p->>'link_url') > 500 THEN RETURN 'link_url'; END IF;
  IF p->>'image_url' IS NOT NULL AND (p->>'image_url' !~ '^https://[^[:space:]]+$' OR char_length(p->>'image_url') > 500) THEN RETURN 'image_url'; END IF;
  SELECT coalesce(array_agg(x::integer), '{}') INTO v_countries FROM jsonb_array_elements_text(coalesce(p->'country_ids', '[]')) x;
  IF cardinality(v_countries) NOT BETWEEN 1 AND 30 THEN RETURN 'country_ids'; END IF;
  IF (SELECT count(*) FROM public.countries c WHERE c.id = ANY (v_countries)) <> cardinality(v_countries) THEN RETURN 'country_ids'; END IF;
  SELECT coalesce(array_agg(x), '{}') INTO v_roles FROM jsonb_array_elements_text(coalesce(p->'roles', '[]')) x;
  IF cardinality(v_roles) < 1 OR NOT (v_roles <@ ARRAY['player', 'coach', 'club', 'umpire']::text[]) THEN RETURN 'roles'; END IF;
  IF p->>'area' IS NOT NULL AND char_length(btrim(p->>'area')) NOT BETWEEN 1 AND 80 THEN RETURN 'area'; END IF;
  IF p->>'ends_at' IS NOT NULL AND (p->>'ends_at')::timestamptz <= now() THEN RETURN 'ends_at'; END IF;
  IF p->>'ends_at' IS NOT NULL AND p->>'starts_at' IS NOT NULL AND (p->>'ends_at')::timestamptz <= (p->>'starts_at')::timestamptz THEN RETURN 'ends_at'; END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.brand_offer_problem(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_offer_problem(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_brand_offer(
  p_offer_id uuid,
  p_title text,
  p_body text,
  p_image_url text,
  p_link_url text,
  p_country_ids integer[],
  p_area text,
  p_roles text[],
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_submit boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand uuid := public.my_brand_id_or_raise();
  v_offer public.brand_offers;
  v_now timestamptz := timezone('utc', now());
  v_fields jsonb := jsonb_build_object(
    'title', nullif(btrim(p_title), ''), 'body', nullif(btrim(p_body), ''),
    'image_url', nullif(btrim(p_image_url), ''), 'link_url', nullif(btrim(p_link_url), ''),
    'country_ids', to_jsonb(coalesce(p_country_ids, '{}')), 'area', nullif(btrim(p_area), ''),
    'roles', to_jsonb(coalesce(p_roles, '{}')), 'starts_at', p_starts_at, 'ends_at', p_ends_at);
  v_problem text;
BEGIN
  IF p_submit THEN
    v_problem := public.brand_offer_problem(v_fields);
    IF v_problem IS NOT NULL THEN RAISE EXCEPTION 'invalid_offer: %', v_problem USING ERRCODE = 'check_violation'; END IF;
    IF p_ends_at IS NOT NULL AND p_ends_at <= v_now THEN RAISE EXCEPTION 'offer_expired' USING ERRCODE = 'check_violation'; END IF;
  END IF;

  IF p_offer_id IS NULL THEN
    IF (SELECT count(*) FROM public.brand_offers WHERE brand_id = v_brand AND status <> 'ended') >= 50 THEN
      RAISE EXCEPTION 'too_many_offers' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.brand_offers (brand_id, status, title, body, image_url, link_url, country_ids, area, roles, starts_at, ends_at, submitted_at, live_at)
    VALUES (v_brand, CASE WHEN p_submit THEN 'live' ELSE 'draft' END,
            v_fields->>'title', v_fields->>'body', v_fields->>'image_url', v_fields->>'link_url',
            coalesce(p_country_ids, '{}'), v_fields->>'area', coalesce(p_roles, '{}'), p_starts_at, p_ends_at,
            CASE WHEN p_submit THEN v_now END, CASE WHEN p_submit THEN v_now END)
    RETURNING * INTO v_offer; -- the trigger holds the 5-live limit
    RETURN v_offer.id;
  END IF;

  SELECT * INTO v_offer FROM public.brand_offers WHERE id = p_offer_id AND brand_id = v_brand FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'no_data_found'; END IF;

  IF v_offer.status IN ('draft', 'in_review', 'not_approved') THEN
    UPDATE public.brand_offers SET
      title = v_fields->>'title', body = v_fields->>'body', image_url = v_fields->>'image_url',
      link_url = v_fields->>'link_url', country_ids = coalesce(p_country_ids, '{}'), area = v_fields->>'area',
      roles = coalesce(p_roles, '{}'), starts_at = p_starts_at, ends_at = p_ends_at,
      status = CASE WHEN p_submit THEN 'live' ELSE 'draft' END,
      submitted_at = CASE WHEN p_submit THEN v_now ELSE submitted_at END,
      live_at = CASE WHEN p_submit THEN coalesce(live_at, v_now) ELSE live_at END,
      review_note = CASE WHEN p_submit THEN NULL ELSE review_note END,
      pending = NULL, pending_status = NULL
    WHERE id = v_offer.id; -- the trigger holds the 5-live limit
  ELSIF v_offer.status IN ('live', 'paused') THEN
    IF NOT p_submit THEN RAISE EXCEPTION 'live_edits_publish' USING ERRCODE = 'check_violation'; END IF;
    UPDATE public.brand_offers SET
      title = v_fields->>'title', body = v_fields->>'body', image_url = v_fields->>'image_url',
      link_url = v_fields->>'link_url', country_ids = coalesce(p_country_ids, '{}'), area = v_fields->>'area',
      roles = coalesce(p_roles, '{}'), starts_at = p_starts_at, ends_at = p_ends_at,
      pending = NULL, pending_status = NULL, review_note = NULL, submitted_at = v_now
    WHERE id = v_offer.id;
  ELSE
    RAISE EXCEPTION 'offer_ended' USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_offer.id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_brand_offer(uuid, text, text, text, text, integer[], text, text[], timestamptz, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_brand_offer(uuid, text, text, text, text, integer[], text, text[], timestamptz, timestamptz, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.duplicate_brand_offer(p_offer_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand uuid := public.my_brand_id_or_raise();
  v_id uuid;
BEGIN
  IF (SELECT count(*) FROM public.brand_offers WHERE brand_id = v_brand AND status <> 'ended') >= 50 THEN
    RAISE EXCEPTION 'too_many_offers' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.brand_offers (brand_id, status, title, body, image_url, link_url, country_ids, area, roles)
  SELECT brand_id, 'draft', title, body, image_url, link_url, country_ids, area, roles
    FROM public.brand_offers WHERE id = p_offer_id AND brand_id = v_brand
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'no_data_found'; END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.duplicate_brand_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duplicate_brand_offer(uuid) TO authenticated;

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

CREATE OR REPLACE FUNCTION public.get_home_gear_rail(p_limit integer DEFAULT 6)
RETURNS TABLE (
  kind text, id uuid, brand_id uuid, brand_name text, brand_slug text, brand_logo_url text,
  brand_profile_id uuid, title text, image_url text, link_url text, member_country_id integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := (SELECT auth.uid());
  m record;
  v_limit integer := least(greatest(coalesce(p_limit, 6), 1), 12);
BEGIN
  IF v_me IS NULL THEN RETURN; END IF;
  SELECT p.id, p.role, p.base_country_id, p.is_blocked, p.frozen_minor_at, p.date_of_birth INTO m FROM public.profiles p WHERE p.id = v_me;
  -- Same member fences as offers: never hidden members, never minors (club accounts are organisations).
  IF m.base_country_id IS NULL OR public.profile_is_hidden(m.is_blocked, m.frozen_minor_at)
     OR NOT (m.role = 'club' OR public.profile_is_adult(m.date_of_birth)) OR m.role = 'brand' THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH offers AS (
    SELECT 'offer'::text AS kind, o.id, o.brand_id, o.brand_name, o.brand_slug, o.brand_logo_url, o.brand_profile_id,
           o.title, o.image_url, o.link_url, o.member_country_id, 0 AS grp, o.last_shown_at AS shown, NULL::timestamptz AS created
      FROM public.get_brand_offers_for_me(v_limit) o
  ),
  selling AS (
    SELECT DISTINCT bo.brand_id
      FROM public.brand_offers bo
     WHERE bo.status = 'live'
       AND (bo.starts_at IS NULL OR bo.starts_at <= now())
       AND (bo.ends_at IS NULL OR bo.ends_at > now())
       AND m.base_country_id = ANY (bo.country_ids)
  ),
  products AS (
    SELECT 'product'::text, bp.id, b.id, b.name, b.slug, b.logo_url, b.profile_id,
           bp.name, (SELECT x->>'url' FROM jsonb_array_elements(coalesce(bp.images, '[]'::jsonb)) x ORDER BY (x->>'order')::int NULLS LAST LIMIT 1),
           bp.external_url, m.base_country_id, 1, NULL::timestamptz, bp.created_at
      FROM public.brand_products bp
      JOIN public.brands b ON b.id = bp.brand_id
     WHERE bp.deleted_at IS NULL
       AND b.id IN (SELECT s.brand_id FROM selling s)
       AND public.brand_is_visible(b.id)
       AND b.profile_id <> v_me
       AND NOT public.is_blocked_pair(v_me, b.profile_id)
       AND NOT EXISTS (SELECT 1 FROM public.brand_hides h WHERE h.user_id = v_me AND h.brand_id = b.id)
  )
  SELECT t.kind, t.id, t.brand_id, t.brand_name, t.brand_slug, t.brand_logo_url, t.brand_profile_id,
         t.title, t.image_url, t.link_url, t.member_country_id
    FROM (SELECT * FROM offers UNION ALL SELECT * FROM products) t
   ORDER BY t.grp, t.shown ASC NULLS FIRST, t.created DESC NULLS LAST
   LIMIT v_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.get_home_gear_rail(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_home_gear_rail(integer) TO authenticated;

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

CREATE OR REPLACE FUNCTION public.get_my_brand_offers()
RETURNS TABLE (
  id uuid, status text, title text, body text, image_url text, link_url text, country_ids integer[],
  area text, roles text[], starts_at timestamptz, ends_at timestamptz, pending jsonb, pending_status text,
  review_note text, submitted_at timestamptz, live_at timestamptz, ended_at timestamptz,
  created_at timestamptz, updated_at timestamptz, shown integer, opened integer, contacted integer, not_useful integer,
  store_visits integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand uuid := public.my_brand_id_or_raise();
  v_owner uuid := (SELECT auth.uid());
BEGIN
  RETURN QUERY
  WITH counts AS (
    SELECT e.entity_id AS offer_id,
           count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'brand_offer_impression')::integer AS shown,
           count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'brand_offer_open')::integer AS opened,
           count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'brand_offer_contact')::integer AS contacted,
           count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'brand_offer_dismiss')::integer AS not_useful,
           count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'brand_offer_store_tap')::integer AS store_visits
      FROM public.events e
      JOIN public.profiles p ON p.id = e.user_id
     WHERE e.entity_type = 'brand_offer'
       AND e.entity_id IN (SELECT o.id FROM public.brand_offers o WHERE o.brand_id = v_brand)
       AND e.user_id <> v_owner
       AND (e.properties ->> 'is_automated') IS NULL
       AND coalesce(p.is_test_account, false) = false
       AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
       AND NOT public.is_blocked_pair(v_owner, e.user_id)
     GROUP BY e.entity_id
  )
  SELECT o.id, o.status, o.title, o.body, o.image_url, o.link_url, o.country_ids, o.area, o.roles,
         o.starts_at, o.ends_at, o.pending, o.pending_status, o.review_note, o.submitted_at, o.live_at,
         o.ended_at, o.created_at, o.updated_at,
         coalesce(c.shown, 0), coalesce(c.opened, 0), coalesce(c.contacted, 0), coalesce(c.not_useful, 0),
         coalesce(c.store_visits, 0)
    FROM public.brand_offers o
    LEFT JOIN counts c ON c.offer_id = o.id
   WHERE o.brand_id = v_brand
   ORDER BY o.updated_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_brand_offers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_brand_offers() TO authenticated;

DROP FUNCTION IF EXISTS public.brand_offer_reaches(boolean, integer[], text[], integer);
DROP FUNCTION IF EXISTS public.country_family_ids(integer);

ALTER TABLE public.brand_offers DROP CONSTRAINT IF EXISTS brand_offers_complete;
ALTER TABLE public.brand_offers ADD CONSTRAINT brand_offers_complete CHECK (
  status = 'draft' OR (title IS NOT NULL AND body IS NOT NULL AND link_url IS NOT NULL
    AND cardinality(country_ids) >= 1 AND cardinality(roles) >= 1));
ALTER TABLE public.brand_offers DROP COLUMN IF EXISTS regions, DROP COLUMN IF EXISTS everywhere;

NOTIFY pgrst, 'reload schema';
