-- Brand offers: logged-out visitors can read live offers (fix for 20261023160000).
--
-- The read policy checked the brand's profile with profile_is_hidden(
-- p.is_blocked, p.frozen_minor_at), but anon holds no column grant on those
-- profiles columns (column-level grants since 20260707180000), so a visitor's
-- read failed with "permission denied for table profiles" (found by
-- supabase/tests/security/brand_offers.probe.sql on staging, before release).
-- A SECURITY DEFINER helper answers "is this brand visible?" without exposing
-- the columns, and the policy uses it for members and visitors alike.
--
-- Rollback: supabase/rollbacks/20261023170000_brand_offers_visible_brand.down.sql

CREATE OR REPLACE FUNCTION public.brand_is_visible(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.brands b JOIN public.profiles p ON p.id = b.profile_id
     WHERE b.id = p_brand_id AND b.deleted_at IS NULL
       AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
  );
$$;
REVOKE ALL ON FUNCTION public.brand_is_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.brand_is_visible(uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS brand_offers_read_live ON public.brand_offers;
CREATE POLICY brand_offers_read_live ON public.brand_offers FOR SELECT TO anon, authenticated
USING (
  status = 'live'
  AND (starts_at IS NULL OR starts_at <= now())
  AND (ends_at IS NULL OR ends_at > now())
  AND public.brand_is_visible(brand_id)
);
