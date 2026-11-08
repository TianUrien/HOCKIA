-- Brands see the members who went to their store from an offer ("store visits",
-- the brand_offer_store_tap event the offer page already records). Adds a
-- store_visits column to get_my_brand_offers and get_my_brand_offer_totals with
-- the same fences (owner, test accounts, automated browsers, hidden profiles,
-- blocked pairs). Source: brand evaluation 2026-11-07 (P0 "show store taps").
-- The return types change, so both functions are dropped and recreated; the
-- grants are restated. Additive for old clients (one more column).
-- Rollback: supabase/rollbacks/20261107120000_brand_store_visits.down.sql

DROP FUNCTION IF EXISTS public.get_my_brand_offer_totals(integer);
DROP FUNCTION IF EXISTS public.get_my_brand_offers();

CREATE OR REPLACE FUNCTION public.get_my_brand_offer_totals(p_days integer DEFAULT 30)
RETURNS TABLE (shown integer, opened integer, contacted integer, store_visits integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand uuid := public.my_brand_id_or_raise();
  v_owner uuid := (SELECT auth.uid());
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
BEGIN
  RETURN QUERY
  SELECT count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'brand_offer_impression')::integer,
         count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'brand_offer_open')::integer,
         count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'brand_offer_contact')::integer,
         count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'brand_offer_store_tap')::integer
    FROM public.events e
    JOIN public.profiles p ON p.id = e.user_id
   WHERE e.entity_type = 'brand_offer'
     AND e.entity_id IN (SELECT o.id FROM public.brand_offers o WHERE o.brand_id = v_brand)
     AND e.created_at >= now() - make_interval(days => v_days)
     AND (e.properties ->> 'is_automated') IS NULL
     AND e.user_id <> v_owner
     AND coalesce(p.is_test_account, false) = false
     AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
     AND NOT public.is_blocked_pair(v_owner, e.user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_brand_offer_totals(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_brand_offer_totals(integer) TO authenticated;

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

NOTIFY pgrst, 'reload schema';
