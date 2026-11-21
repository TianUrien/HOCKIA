-- Rollback for 20261121120000_brand_campaigns.sql: restores the bodies from
-- 20261107150000_brand_offer_perk_code.sql, the previous "complete offer"
-- constraint, and drops brand_offers.objective. Campaigns published without a
-- link (objective ask / ambassador) go back to draft first, because the old
-- constraint needs a link on anything past a draft.

DROP FUNCTION IF EXISTS public.save_brand_offer(uuid, text, text, text, text, integer[], text, text[], timestamptz, timestamptz, boolean, boolean, text[], text, text, text);
DROP FUNCTION IF EXISTS public.get_my_brand_offers();

UPDATE public.brand_offers SET status = 'draft' WHERE status <> 'draft' AND link_url IS NULL;
ALTER TABLE public.brand_offers DROP CONSTRAINT IF EXISTS brand_offers_complete;
ALTER TABLE public.brand_offers ADD CONSTRAINT brand_offers_complete CHECK (
  status = 'draft' OR (title IS NOT NULL AND body IS NOT NULL AND link_url IS NOT NULL
    AND (everywhere OR cardinality(country_ids) + cardinality(regions) >= 1) AND cardinality(roles) >= 1));

CREATE OR REPLACE FUNCTION public.brand_offer_problem(p jsonb)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_countries integer[];
  v_roles text[];
  v_regions text[];
  v_everywhere boolean := coalesce((p->>'everywhere')::boolean, false);
BEGIN
  IF coalesce(char_length(btrim(p->>'title')), 0) NOT BETWEEN 1 AND 60 THEN RETURN 'title'; END IF;
  IF coalesce(char_length(btrim(p->>'body')), 0) NOT BETWEEN 1 AND 140 THEN RETURN 'body'; END IF;
  IF coalesce(p->>'link_url', '') !~ '^https://[^[:space:]]+$' OR char_length(p->>'link_url') > 500 THEN RETURN 'link_url'; END IF;
  IF p->>'image_url' IS NOT NULL AND (p->>'image_url' !~ '^https://[^[:space:]]+$' OR char_length(p->>'image_url') > 500) THEN RETURN 'image_url'; END IF;
  SELECT coalesce(array_agg(x::integer), '{}') INTO v_countries FROM jsonb_array_elements_text(coalesce(p->'country_ids', '[]')) x;
  SELECT coalesce(array_agg(x), '{}') INTO v_regions FROM jsonb_array_elements_text(coalesce(p->'regions', '[]')) x;
  IF cardinality(v_countries) > 30 THEN RETURN 'country_ids'; END IF;
  IF NOT v_everywhere AND cardinality(v_countries) + cardinality(v_regions) < 1 THEN RETURN 'country_ids'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_regions) r WHERE r NOT IN (SELECT DISTINCT c.region FROM public.countries c WHERE c.region IS NOT NULL)) THEN RETURN 'regions'; END IF;
  IF (SELECT count(*) FROM public.countries c WHERE c.id = ANY (v_countries)) <> cardinality(v_countries) THEN RETURN 'country_ids'; END IF;
  SELECT coalesce(array_agg(x), '{}') INTO v_roles FROM jsonb_array_elements_text(coalesce(p->'roles', '[]')) x;
  IF cardinality(v_roles) < 1 OR NOT (v_roles <@ ARRAY['player', 'coach', 'club', 'umpire']::text[]) THEN RETURN 'roles'; END IF;
  IF p->>'perk' IS NOT NULL AND char_length(btrim(p->>'perk')) NOT BETWEEN 1 AND 24 THEN RETURN 'perk'; END IF;
  IF p->>'promo_code' IS NOT NULL AND btrim(p->>'promo_code') !~ '^[A-Za-z0-9_-]{2,30}$' THEN RETURN 'promo_code'; END IF;
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
  p_submit boolean DEFAULT false,
  p_everywhere boolean DEFAULT NULL,
  p_regions text[] DEFAULT NULL,
  p_perk text DEFAULT NULL,
  p_promo_code text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand uuid := public.my_brand_id_or_raise();
  v_offer public.brand_offers;
  v_everywhere boolean;
  v_regions text[];
  v_perk text;
  v_code text;
  v_now timestamptz := timezone('utc', now());
  v_fields jsonb := jsonb_build_object(
    'title', nullif(btrim(p_title), ''), 'body', nullif(btrim(p_body), ''),
    'image_url', nullif(btrim(p_image_url), ''), 'link_url', nullif(btrim(p_link_url), ''),
    'country_ids', to_jsonb(coalesce(p_country_ids, '{}')), 'area', nullif(btrim(p_area), ''),
    'roles', to_jsonb(coalesce(p_roles, '{}')), 'starts_at', p_starts_at, 'ends_at', p_ends_at);
  v_problem text;
BEGIN
  -- Reach (2026-11-07): NULL keeps what the offer has, so a client that doesn't
  -- know about Everywhere/regions never resets them on edit.
  IF p_offer_id IS NOT NULL THEN
    SELECT o.everywhere, o.regions, o.perk, o.promo_code INTO v_everywhere, v_regions, v_perk, v_code FROM public.brand_offers o
     WHERE o.id = p_offer_id AND o.brand_id = v_brand;
  END IF;
  v_everywhere := coalesce(p_everywhere, v_everywhere, false);
  v_regions := coalesce(p_regions, v_regions, '{}');
  -- Perk and code (2026-11-07): NULL keeps the offer's value; '' clears it.
  v_perk := CASE WHEN p_perk IS NULL THEN v_perk ELSE nullif(btrim(p_perk), '') END;
  v_code := CASE WHEN p_promo_code IS NULL THEN v_code ELSE nullif(btrim(p_promo_code), '') END;
  v_fields := v_fields || jsonb_build_object('everywhere', v_everywhere, 'regions', to_jsonb(v_regions), 'perk', v_perk, 'promo_code', v_code);
  IF p_submit THEN
    v_problem := public.brand_offer_problem(v_fields);
    IF v_problem IS NOT NULL THEN RAISE EXCEPTION 'invalid_offer: %', v_problem USING ERRCODE = 'check_violation'; END IF;
    IF p_ends_at IS NOT NULL AND p_ends_at <= v_now THEN RAISE EXCEPTION 'offer_expired' USING ERRCODE = 'check_violation'; END IF;
  END IF;

  IF p_offer_id IS NULL THEN
    IF (SELECT count(*) FROM public.brand_offers WHERE brand_id = v_brand AND status <> 'ended') >= 50 THEN
      RAISE EXCEPTION 'too_many_offers' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.brand_offers (brand_id, status, title, body, image_url, link_url, country_ids, area, roles, starts_at, ends_at, submitted_at, live_at, everywhere, regions, perk, promo_code)
    VALUES (v_brand, CASE WHEN p_submit THEN 'live' ELSE 'draft' END,
            v_fields->>'title', v_fields->>'body', v_fields->>'image_url', v_fields->>'link_url',
            coalesce(p_country_ids, '{}'), v_fields->>'area', coalesce(p_roles, '{}'), p_starts_at, p_ends_at,
            CASE WHEN p_submit THEN v_now END, CASE WHEN p_submit THEN v_now END, v_everywhere, v_regions, v_perk, v_code)
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
      everywhere = v_everywhere, regions = v_regions, perk = v_perk, promo_code = v_code,
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
      everywhere = v_everywhere, regions = v_regions, perk = v_perk, promo_code = v_code,
      pending = NULL, pending_status = NULL, review_note = NULL, submitted_at = v_now
    WHERE id = v_offer.id;
  ELSE
    RAISE EXCEPTION 'offer_ended' USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_offer.id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_brand_offer(uuid, text, text, text, text, integer[], text, text[], timestamptz, timestamptz, boolean, boolean, text[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_brand_offer(uuid, text, text, text, text, integer[], text, text[], timestamptz, timestamptz, boolean, boolean, text[], text, text) TO authenticated;

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
  INSERT INTO public.brand_offers (brand_id, status, title, body, image_url, link_url, country_ids, area, roles, everywhere, regions, perk, promo_code)
  SELECT brand_id, 'draft', title, body, image_url, link_url, country_ids, area, roles, everywhere, regions, perk, promo_code
    FROM public.brand_offers WHERE id = p_offer_id AND brand_id = v_brand
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'no_data_found'; END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.duplicate_brand_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duplicate_brand_offer(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_brand_offers()
RETURNS TABLE (
  id uuid, status text, title text, body text, image_url text, link_url text, country_ids integer[],
  area text, roles text[], starts_at timestamptz, ends_at timestamptz, pending jsonb, pending_status text,
  review_note text, submitted_at timestamptz, live_at timestamptz, ended_at timestamptz,
  created_at timestamptz, updated_at timestamptz, shown integer, opened integer, contacted integer, not_useful integer,
  store_visits integer, everywhere boolean, regions text[], perk text, promo_code text, code_copies integer
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
           count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'brand_offer_store_tap')::integer AS store_visits,
           count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'brand_offer_code_copy')::integer AS code_copies
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
         coalesce(c.store_visits, 0), o.everywhere, o.regions, o.perk, o.promo_code, coalesce(c.code_copies, 0)
    FROM public.brand_offers o
    LEFT JOIN counts c ON c.offer_id = o.id
   WHERE o.brand_id = v_brand
   ORDER BY o.updated_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_brand_offers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_brand_offers() TO authenticated;

ALTER TABLE public.brand_offers DROP COLUMN IF EXISTS objective;

NOTIFY pgrst, 'reload schema';
