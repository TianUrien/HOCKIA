-- Rollback for 20261025170000_marketplace_by_need_and_place.sql (brand suggestions and needs are lost).
DROP FUNCTION IF EXISTS public.admin_list_brand_suggestions(integer);
DROP FUNCTION IF EXISTS public.suggest_brand(text, text, integer, text);
DROP TABLE IF EXISTS public.brand_suggestions;
DROP FUNCTION IF EXISTS public.get_marketplace(integer);
DROP FUNCTION IF EXISTS public.set_brand_product_need(uuid, text);
DROP FUNCTION IF EXISTS public.set_brand_offer_need(uuid, text);
DROP FUNCTION IF EXISTS public.brand_need_default(text);
ALTER TABLE public.brand_products DROP COLUMN IF EXISTS need;
ALTER TABLE public.brand_offers DROP COLUMN IF EXISTS need;
