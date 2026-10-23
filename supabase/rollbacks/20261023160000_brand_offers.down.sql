-- Rollback for 20261023160000_brand_offers.sql.
-- DATA LOSS: every brand offer is dropped. Dump first if any exist:
--   psql "$DB_URL" -c "\copy (SELECT * FROM public.brand_offers) TO 'brand_offers.csv' CSV HEADER"
-- Offer events stay in public.events. The two notification enum values stay
-- (Postgres can't drop enum values; nothing uses them once the RPCs are gone).
DO $$ BEGIN PERFORM cron.unschedule('end_expired_brand_offers_hourly'); EXCEPTION WHEN others THEN NULL; END $$;
DROP FUNCTION IF EXISTS public.end_expired_brand_offers();
DROP FUNCTION IF EXISTS public.admin_review_brand_offer(uuid, text, text);
DROP FUNCTION IF EXISTS public.admin_list_brand_offers(text);
DROP FUNCTION IF EXISTS public.get_my_brand_offers();
DROP FUNCTION IF EXISTS public.duplicate_brand_offer(uuid);
DROP FUNCTION IF EXISTS public.set_brand_offer_state(uuid, text);
DROP FUNCTION IF EXISTS public.save_brand_offer(uuid, text, text, text, text, integer[], text, text[], timestamptz, timestamptz, boolean);
DROP FUNCTION IF EXISTS public.my_brand_id_or_raise();
DROP FUNCTION IF EXISTS public.brand_offer_problem(jsonb);
DROP INDEX IF EXISTS public.events_brand_offer_idx;
DROP TABLE IF EXISTS public.brand_offers;
DROP FUNCTION IF EXISTS public.brand_offers_live_limit();
