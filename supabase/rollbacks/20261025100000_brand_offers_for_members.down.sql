-- Rollback for 20261025100000_brand_offers_for_members.sql
DROP FUNCTION IF EXISTS public.hide_brand_offers(uuid);
DROP FUNCTION IF EXISTS public.undo_dismiss_brand_offer(uuid);
DROP FUNCTION IF EXISTS public.dismiss_brand_offer(uuid, text);
DROP FUNCTION IF EXISTS public.get_brand_offer_detail(uuid);
DROP FUNCTION IF EXISTS public.get_brand_offers_for_me(integer);
DROP FUNCTION IF EXISTS public.brand_offer_eligible_for(public.brand_offers, uuid);
DROP INDEX IF EXISTS public.events_brand_offer_user_idx;
DROP TABLE IF EXISTS public.brand_hides;
DROP TABLE IF EXISTS public.brand_offer_dismissals;
