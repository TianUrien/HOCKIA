-- Ambassador candidates with the player's consent (Figma 08 · Brands P4,
-- AC1–AC6; brand evaluation 2026-11-07, P1).
--   brand_partnership_prefs: a player's own "Open to brand partnerships"
--   (off by default), "Open to other brands" while they are someone's
--   ambassador (off by default, founder default 2026-10-22), and an Instagram
--   handle plus a follower count the player declares (founder 2026-11-07;
--   shown to brands marked as declared, never verified).
--   No client reads the table directly: players use get/set_my_brand_partnership,
--   brands get_ambassador_candidates. Only brands ever see it.
--   get_ambassador_candidates: players who opted in, adults, not hidden, not
--   blocked, where the brand sells (its country and every place its offers
--   name; anywhere with an Everywhere offer), not already this brand's
--   ambassador, and not another brand's unless they said so.
-- Rollback: supabase/rollbacks/20261107170000_brand_partnerships.down.sql

CREATE TABLE IF NOT EXISTS public.brand_partnership_prefs (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  open boolean NOT NULL DEFAULT false,
  open_to_other_brands boolean NOT NULL DEFAULT false,
  instagram_handle text CHECK (instagram_handle IS NULL OR instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),
  instagram_followers integer CHECK (instagram_followers IS NULL OR instagram_followers BETWEEN 0 AND 100000000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.brand_partnership_prefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_partnership_prefs FROM anon, authenticated;
GRANT ALL ON TABLE public.brand_partnership_prefs TO service_role;
CREATE INDEX IF NOT EXISTS brand_partnership_prefs_open_idx ON public.brand_partnership_prefs (profile_id) WHERE open;

CREATE OR REPLACE FUNCTION public.get_my_brand_partnership()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT jsonb_build_object('open', p.open, 'open_to_other_brands', p.open_to_other_brands,
                               'instagram_handle', p.instagram_handle, 'instagram_followers', p.instagram_followers)
       FROM public.brand_partnership_prefs p WHERE p.profile_id = (SELECT auth.uid())),
    jsonb_build_object('open', false, 'open_to_other_brands', false, 'instagram_handle', NULL, 'instagram_followers', NULL));
$$;
REVOKE ALL ON FUNCTION public.get_my_brand_partnership() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_brand_partnership() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_my_brand_partnership(p_open boolean, p_open_to_other_brands boolean, p_instagram_handle text DEFAULT NULL, p_instagram_followers integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := (SELECT auth.uid());
  v_role text;
  v_handle text := nullif(regexp_replace(btrim(coalesce(p_instagram_handle, '')), '^@', ''), '');
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_signed_in' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_me;
  IF v_role IS DISTINCT FROM 'player' THEN RAISE EXCEPTION 'players_only' USING ERRCODE = 'check_violation'; END IF;
  INSERT INTO public.brand_partnership_prefs AS b (profile_id, open, open_to_other_brands, instagram_handle, instagram_followers, updated_at)
  VALUES (v_me, coalesce(p_open, false), coalesce(p_open_to_other_brands, false), v_handle, p_instagram_followers, now())
  ON CONFLICT (profile_id) DO UPDATE
    SET open = EXCLUDED.open, open_to_other_brands = EXCLUDED.open_to_other_brands,
        instagram_handle = EXCLUDED.instagram_handle, instagram_followers = EXCLUDED.instagram_followers, updated_at = now();
  RETURN public.get_my_brand_partnership();
END;
$$;
REVOKE ALL ON FUNCTION public.set_my_brand_partnership(boolean, boolean, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_brand_partnership(boolean, boolean, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_ambassador_candidates(p_country_id integer DEFAULT NULL)
RETURNS TABLE (
  profile_id uuid, full_name text, avatar_url text, player_position text, playing_category text,
  base_country_id integer, base_city text, instagram_handle text, instagram_followers integer, invited boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand uuid := public.my_brand_id_or_raise();
  v_owner uuid := (SELECT auth.uid());
  v_brand_country integer;
  v_everywhere boolean;
  v_viewer_test boolean;
BEGIN
  SELECT b.country_id INTO v_brand_country FROM public.brands b WHERE b.id = v_brand;
  SELECT EXISTS (SELECT 1 FROM public.brand_offers o WHERE o.brand_id = v_brand AND o.status IN ('live', 'paused') AND o.everywhere) INTO v_everywhere;
  -- Test accounts only ever see test accounts (staging QA), real brands only real players.
  SELECT coalesce(p.is_test_account, false) INTO v_viewer_test FROM public.profiles p WHERE p.id = v_owner;

  RETURN QUERY
  SELECT p.id, p.full_name, p.avatar_url, p.position::text, p.playing_category::text,
         p.base_country_id, p.base_city, pr.instagram_handle, pr.instagram_followers,
         EXISTS (SELECT 1 FROM public.brand_ambassadors a WHERE a.brand_id = v_brand AND a.player_id = p.id AND a.status = 'pending')
    FROM public.brand_partnership_prefs pr
    JOIN public.profiles p ON p.id = pr.profile_id
   WHERE pr.open
     AND p.role = 'player'
     AND p.onboarding_completed
     AND coalesce(p.is_test_account, false) = v_viewer_test
     AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
     AND public.profile_is_adult(p.date_of_birth)
     AND NOT public.is_blocked_pair(p.id, v_owner)
     AND NOT EXISTS (SELECT 1 FROM public.brand_ambassadors a WHERE a.brand_id = v_brand AND a.player_id = p.id AND a.status = 'accepted')
     AND (pr.open_to_other_brands OR NOT EXISTS (SELECT 1 FROM public.brand_ambassadors a WHERE a.player_id = p.id AND a.status = 'accepted' AND a.brand_id <> v_brand))
     AND CASE
           WHEN p_country_id IS NOT NULL THEN p.base_country_id = ANY (public.country_family_ids(p_country_id))
           WHEN v_everywhere THEN true
           ELSE p.base_country_id = ANY (public.country_family_ids(v_brand_country))
             OR EXISTS (SELECT 1 FROM public.brand_offers o
                         WHERE o.brand_id = v_brand AND o.status IN ('live', 'paused')
                           AND public.brand_offer_reaches(o.everywhere, o.country_ids, o.regions, p.base_country_id))
         END
   ORDER BY pr.instagram_followers DESC NULLS LAST, pr.updated_at DESC
   LIMIT 100;
END;
$$;
REVOKE ALL ON FUNCTION public.get_ambassador_candidates(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ambassador_candidates(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
