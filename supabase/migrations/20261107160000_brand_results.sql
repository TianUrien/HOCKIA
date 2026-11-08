-- Brand Results (Figma 08 · Brands P3 / R1; brand evaluation 2026-11-07, P1).
-- One owner-only read for the Results screen and the brand Home summary:
--   totals and the previous period (shown, opened, store visits, codes copied,
--   contacted, not useful), per offer, who saw the offers (country, role,
--   surface), the members who contacted the brand from an offer (they chose to
--   be seen), people waiting for a reply, the market the brand can reach,
--   products, and ambassadors and followers.
-- Fences on every count and list: never the brand itself, no test accounts, no
-- automated browsers, no hidden profiles, no blocked pairs. Breakdowns and the
-- market show a number only for groups of 5 or more ("Fewer than 5" otherwise;
-- founder threshold 2026-10-23); nobody is identified except people who wrote.
-- Rollback: supabase/rollbacks/20261107160000_brand_results.down.sql

CREATE OR REPLACE FUNCTION public.get_my_brand_results(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand uuid := public.my_brand_id_or_raise();
  v_owner uuid := (SELECT auth.uid());
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_from timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
  v_prev timestamptz := now() - make_interval(days => 2 * least(greatest(coalesce(p_days, 30), 1), 365));
  v_brand_country integer;
  v_out jsonb;
BEGIN
  SELECT b.country_id INTO v_brand_country FROM public.brands b WHERE b.id = v_brand;

  WITH offers AS (
    SELECT o.* FROM public.brand_offers o WHERE o.brand_id = v_brand AND o.status <> 'draft' AND o.live_at IS NOT NULL
  ),
  ev AS (
    SELECT e.event_name, e.entity_id, e.user_id, e.created_at, e.properties ->> 'surface' AS surface, p.role, p.base_country_id
      FROM public.events e
      JOIN public.profiles p ON p.id = e.user_id
     WHERE e.entity_type = 'brand_offer'
       AND e.entity_id IN (SELECT id FROM offers)
       AND e.created_at >= v_prev
       AND e.user_id <> v_owner
       AND (e.properties ->> 'is_automated') IS NULL
       AND coalesce(p.is_test_account, false) = false
       AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
       AND NOT public.is_blocked_pair(v_owner, e.user_id)
  ),
  cur AS (SELECT * FROM ev WHERE created_at >= v_from),
  prev AS (SELECT * FROM ev WHERE created_at < v_from),
  seen AS (SELECT DISTINCT user_id, role, base_country_id, surface FROM cur WHERE event_name = 'brand_offer_impression'),
  members AS (
    SELECT m.id, m.role, m.base_country_id
      FROM public.profiles m
     WHERE m.onboarding_completed
       AND m.role IN ('player', 'coach', 'club', 'umpire')
       AND m.id <> v_owner
       AND coalesce(m.is_test_account, false) = false
       AND NOT public.profile_is_hidden(m.is_blocked, m.frozen_minor_at)
       AND (m.role = 'club' OR public.profile_is_adult(m.date_of_birth))
       AND NOT public.is_blocked_pair(m.id, v_owner)
  ),
  live AS (SELECT * FROM offers WHERE status = 'live'),
  market_countries AS (
    -- Where the brand sells: its own country, every country and region its offers
    -- name; with an Everywhere offer, wherever members are.
    SELECT DISTINCT c.id FROM public.countries c
     WHERE c.id = ANY (public.country_family_ids(v_brand_country))
        OR EXISTS (SELECT 1 FROM offers o WHERE o.everywhere OR c.id = ANY (o.country_ids) OR c.region = ANY (o.regions))
  ),
  market AS (
    SELECT m.base_country_id AS country_id, count(*)::integer AS n,
           bool_or(EXISTS (SELECT 1 FROM live l WHERE public.brand_offer_reaches(l.everywhere, l.country_ids, l.regions, m.base_country_id) AND m.role = ANY (l.roles))) AS covered
      FROM members m
     WHERE m.base_country_id IN (SELECT id FROM market_countries)
     GROUP BY m.base_country_id
  ),
  contacts AS (
    SELECT DISTINCT ON (c.user_id) c.user_id, c.entity_id AS offer_id, c.created_at
      FROM cur c WHERE c.event_name = 'brand_offer_contact'
     ORDER BY c.user_id, c.created_at DESC
  ),
  convs AS (
    SELECT cv.id,
           CASE WHEN cv.participant_one_id = v_owner THEN cv.participant_two_id ELSE cv.participant_one_id END AS other_id,
           (SELECT ms.sender_id FROM public.messages ms WHERE ms.conversation_id = cv.id AND ms.deleted_at IS NULL ORDER BY ms.sent_at DESC LIMIT 1) AS last_sender,
           (SELECT max(ms.sent_at) FROM public.messages ms WHERE ms.conversation_id = cv.id AND ms.deleted_at IS NULL) AS last_at
      FROM public.conversations cv
     WHERE v_owner IN (cv.participant_one_id, cv.participant_two_id)
  ),
  waiting AS (
    SELECT cv.* FROM convs cv JOIN public.profiles p ON p.id = cv.other_id
     WHERE cv.last_sender = cv.other_id
       AND coalesce(p.is_test_account, false) = false
       AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
       AND NOT public.is_blocked_pair(v_owner, cv.other_id)
  ),
  prod_ev AS (
    SELECT e.event_name, e.entity_id, e.user_id
      FROM public.events e
      JOIN public.profiles p ON p.id = e.user_id
     WHERE e.entity_type = 'brand_product'
       AND e.entity_id IN (SELECT bp.id FROM public.brand_products bp WHERE bp.brand_id = v_brand)
       AND e.created_at >= v_from
       AND e.user_id <> v_owner
       AND (e.properties ->> 'is_automated') IS NULL
       AND coalesce(p.is_test_account, false) = false
       AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
  )
  SELECT jsonb_build_object(
    'days', v_days,
    'totals', (SELECT jsonb_build_object(
        'shown', count(DISTINCT user_id) FILTER (WHERE event_name = 'brand_offer_impression'),
        'opened', count(DISTINCT user_id) FILTER (WHERE event_name = 'brand_offer_open'),
        'store_visits', count(DISTINCT user_id) FILTER (WHERE event_name = 'brand_offer_store_tap'),
        'code_copies', count(DISTINCT user_id) FILTER (WHERE event_name = 'brand_offer_code_copy'),
        'contacted', count(DISTINCT user_id) FILTER (WHERE event_name = 'brand_offer_contact'),
        'not_useful', count(DISTINCT user_id) FILTER (WHERE event_name = 'brand_offer_dismiss')) FROM cur),
    'previous', (SELECT jsonb_build_object(
        'shown', count(DISTINCT user_id) FILTER (WHERE event_name = 'brand_offer_impression'),
        'contacted', count(DISTINCT user_id) FILTER (WHERE event_name = 'brand_offer_contact'),
        'store_visits', count(DISTINCT user_id) FILTER (WHERE event_name = 'brand_offer_store_tap')) FROM prev),
    'offers', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'title', o.title, 'status', o.status, 'image_url', o.image_url, 'live_at', o.live_at,
        'shown', (SELECT count(DISTINCT user_id) FROM cur WHERE entity_id = o.id AND event_name = 'brand_offer_impression'),
        'opened', (SELECT count(DISTINCT user_id) FROM cur WHERE entity_id = o.id AND event_name = 'brand_offer_open'),
        'store_visits', (SELECT count(DISTINCT user_id) FROM cur WHERE entity_id = o.id AND event_name = 'brand_offer_store_tap'),
        'code_copies', (SELECT count(DISTINCT user_id) FROM cur WHERE entity_id = o.id AND event_name = 'brand_offer_code_copy'),
        'contacted', (SELECT count(DISTINCT user_id) FROM cur WHERE entity_id = o.id AND event_name = 'brand_offer_contact'),
        'not_useful', (SELECT count(DISTINCT user_id) FROM cur WHERE entity_id = o.id AND event_name = 'brand_offer_dismiss'))
        ORDER BY (o.status = 'live') DESC, o.live_at DESC), '[]') FROM offers o),
    'by_country', (SELECT coalesce(jsonb_agg(jsonb_build_object('country_id', x.k, 'n', x.n) ORDER BY x.n DESC), '[]')
        FROM (SELECT base_country_id AS k, count(DISTINCT user_id)::integer n FROM seen WHERE base_country_id IS NOT NULL GROUP BY 1 HAVING count(DISTINCT user_id) >= 5) x),
    'by_role', (SELECT coalesce(jsonb_agg(jsonb_build_object('role', x.k, 'n', x.n) ORDER BY x.n DESC), '[]')
        FROM (SELECT role AS k, count(DISTINCT user_id)::integer n FROM seen GROUP BY 1 HAVING count(DISTINCT user_id) >= 5) x),
    'by_surface', (SELECT coalesce(jsonb_agg(jsonb_build_object('surface', x.k, 'n', x.n) ORDER BY x.n DESC), '[]')
        FROM (SELECT coalesce(surface, 'other') AS k, count(DISTINCT user_id)::integer n FROM seen GROUP BY 1 HAVING count(DISTINCT user_id) >= 5) x),
    'seen_total', (SELECT count(DISTINCT user_id) FROM seen),
    'contacts', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'profile_id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url, 'role', p.role,
        'offer_title', o.title, 'at', c.created_at,
        'conversation_id', (SELECT cv.id FROM convs cv WHERE cv.other_id = p.id LIMIT 1)) ORDER BY c.created_at DESC), '[]')
        FROM (SELECT * FROM contacts ORDER BY created_at DESC LIMIT 20) c
        JOIN public.profiles p ON p.id = c.user_id
        LEFT JOIN offers o ON o.id = c.offer_id),
    'waiting', (SELECT jsonb_build_object('count', count(*), 'oldest_at', min(last_at)) FROM waiting),
    'market', (SELECT coalesce(jsonb_agg(jsonb_build_object('country_id', m.country_id, 'n', CASE WHEN m.n >= 5 THEN m.n END, 'covered', m.covered) ORDER BY m.n DESC), '[]')
        FROM (SELECT * FROM market ORDER BY n DESC LIMIT 8) m),
    'market_total', (SELECT CASE WHEN sum(n) >= 5 THEN sum(n)::integer END FROM market),
    'products', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', bp.id, 'name', bp.name,
        'seen', (SELECT count(DISTINCT user_id) FROM prod_ev WHERE entity_id = bp.id AND event_name IN ('brand_product_impression', 'product_view')),
        'store_taps', (SELECT count(DISTINCT user_id) FROM prod_ev WHERE entity_id = bp.id AND event_name = 'brand_product_click')) ORDER BY bp.sort_order NULLS LAST, bp.created_at), '[]')
        FROM public.brand_products bp WHERE bp.brand_id = v_brand AND bp.deleted_at IS NULL),
    'community', jsonb_build_object(
        'ambassadors', (SELECT count(*) FROM public.brand_ambassadors a WHERE a.brand_id = v_brand AND a.status = 'accepted'),
        'invites_sent', (SELECT count(*) FROM public.brand_ambassadors a WHERE a.brand_id = v_brand AND a.created_at >= v_from),
        'invites_accepted', (SELECT count(*) FROM public.brand_ambassadors a WHERE a.brand_id = v_brand AND a.created_at >= v_from AND a.status = 'accepted'),
        'new_followers', (SELECT count(*) FROM public.brand_followers f WHERE f.brand_id = v_brand AND f.created_at >= v_from))
  ) INTO v_out;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_brand_results(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_brand_results(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
