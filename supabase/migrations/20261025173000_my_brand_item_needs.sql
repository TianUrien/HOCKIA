-- Marketplace (20261025170000): the brand's editors read back the need of
-- their own offers and products. Read-only, the signed-in brand's own items
-- only. A separate function so get_my_brand_offers / get_brand_products keep
-- their shapes for installed apps.
--
-- Rollback: supabase/rollbacks/20261025173000_my_brand_item_needs.down.sql

CREATE OR REPLACE FUNCTION public.get_my_brand_item_needs()
RETURNS TABLE (kind text, id uuid, need text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH mine AS (
    SELECT b.id, b.category FROM public.brands b
     WHERE b.profile_id = (SELECT auth.uid()) AND b.deleted_at IS NULL
  )
  SELECT 'offer'::text, o.id, coalesce(o.need, public.brand_need_default(m.category))
    FROM public.brand_offers o JOIN mine m ON m.id = o.brand_id
  UNION ALL
  SELECT 'product'::text, p.id, coalesce(p.need, public.brand_need_default(m.category))
    FROM public.brand_products p JOIN mine m ON m.id = p.brand_id
   WHERE p.deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.get_my_brand_item_needs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_brand_item_needs() TO authenticated;
