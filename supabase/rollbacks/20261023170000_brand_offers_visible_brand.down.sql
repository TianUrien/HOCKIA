-- Rollback for 20261023170000_brand_offers_visible_brand.sql: the original
-- read policy from 20261023160000 (visitors' reads fail again).
DROP POLICY IF EXISTS brand_offers_read_live ON public.brand_offers;
CREATE POLICY brand_offers_read_live ON public.brand_offers FOR SELECT TO anon, authenticated
USING (
  status = 'live'
  AND (starts_at IS NULL OR starts_at <= now())
  AND (ends_at IS NULL OR ends_at > now())
  AND EXISTS (
    SELECT 1 FROM public.brands b JOIN public.profiles p ON p.id = b.profile_id
     WHERE b.id = brand_offers.brand_id AND b.deleted_at IS NULL
       AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
  )
);
DROP FUNCTION IF EXISTS public.brand_is_visible(uuid);
