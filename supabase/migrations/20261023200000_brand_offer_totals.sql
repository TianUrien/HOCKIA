-- Brand dashboard (Figma 08 · Brands B0b): the last-30-days tiles on the
-- Offers card, "Shown to · Opened · Contacted", across all of a brand's offers.
--
-- Distinct members over the window (a member who saw two offers counts once),
-- with the same fences as get_my_brand_offers: never the owner, no test
-- accounts, no hidden profiles (blocked or frozen minors), no blocked pair.
-- Read-only; the owner only (my_brand_id_or_raise).
--
-- Rollback: supabase/rollbacks/20261023200000_brand_offer_totals.down.sql

CREATE OR REPLACE FUNCTION public.get_my_brand_offer_totals(p_days integer DEFAULT 30)
RETURNS TABLE (shown integer, opened integer, contacted integer)
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
         count(DISTINCT e.user_id) FILTER (WHERE e.event_name = 'brand_offer_contact')::integer
    FROM public.events e
    JOIN public.profiles p ON p.id = e.user_id
   WHERE e.entity_type = 'brand_offer'
     AND e.entity_id IN (SELECT o.id FROM public.brand_offers o WHERE o.brand_id = v_brand)
     AND e.created_at >= now() - make_interval(days => v_days)
     AND e.user_id <> v_owner
     AND coalesce(p.is_test_account, false) = false
     AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
     AND NOT public.is_blocked_pair(v_owner, e.user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_brand_offer_totals(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_brand_offer_totals(integer) TO authenticated;
