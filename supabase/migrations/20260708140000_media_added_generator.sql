-- P4 Phase 0 — media_added / "New media" feed generator (Home redesign).
--
-- SCOPE (v1): gallery PHOTO uploads only. Videos are deliberately deferred —
-- they're evidence-significant (the brief wants them to also notify
-- saved/network, a notif exception we haven't approved) AND player_videos
-- has an async upload lifecycle (status pending_upload → ready) so the event
-- must fire on ready, not insert. Videos get their own card + handling in a
-- follow-up.
--
-- Shape: an AGGREGATE, one home_feed_items row per (uploader, UTC day) —
-- "Santi added 6 match photos" — so a bulk upload is one card, not six
-- (same health principle as club_responded). Keeps up to 4 sample thumbnail
-- URLs for the card.
--
-- Guardrails: FEED-ONLY (no push/email); hidden-predicate fence (no card for
-- a banned/frozen uploader); silent-accumulate (excluded from today's
-- get_home_feed); resilient + observable (failures logged to error_logs via
-- the shared helper).

-- 1. Whitelists: allow the new type + source.
ALTER TABLE public.home_feed_items DROP CONSTRAINT IF EXISTS home_feed_items_item_type_check;
ALTER TABLE public.home_feed_items ADD CONSTRAINT home_feed_items_item_type_check
  CHECK (item_type = ANY (ARRAY[
    'member_joined','opportunity_posted','milestone_achieved','reference_received',
    'brand_post','brand_product','career_move','club_responded','media_added'
  ]::text[]));
ALTER TABLE public.home_feed_items DROP CONSTRAINT IF EXISTS home_feed_items_source_type_check;
ALTER TABLE public.home_feed_items ADD CONSTRAINT home_feed_items_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'profile','vacancy','profile_reference','brand_post','brand_product',
    'milestone','user_post','application_response','media'
  ]::text[]));

-- 2. Generator: upsert the per-uploader daily photo aggregate.
CREATE OR REPLACE FUNCTION public.generate_media_added_feed_item()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_up RECORD;
  v_day date;
  v_source_id uuid;
BEGIN
  SELECT p.id, p.full_name, p.avatar_url, p.role, p.nationality_country_id,
         p.is_blocked, p.frozen_minor_at, COALESCE(p.is_test_account, false) AS is_test
    INTO v_up
  FROM public.profiles p WHERE p.id = NEW.user_id;

  IF v_up.id IS NULL
     OR public.profile_is_hidden(v_up.is_blocked, v_up.frozen_minor_at) THEN
    RETURN NEW;
  END IF;

  v_day := (timezone('utc', NEW.created_at))::date;
  v_source_id := md5(v_up.id::text || '|' || v_day::text || '|photo')::uuid;

  INSERT INTO public.home_feed_items (
    item_type, source_id, source_type, is_test_account,
    author_profile_id, author_role, author_country_id, metadata, created_at)
  VALUES (
    'media_added', v_source_id, 'media', v_up.is_test,
    v_up.id, v_up.role, v_up.nationality_country_id,
    jsonb_build_object(
      'uploader_id', v_up.id, 'uploader_name', v_up.full_name,
      'uploader_role', v_up.role, 'uploader_avatar_url', v_up.avatar_url,
      'media_kind', 'photo', 'day', v_day, 'count', 1,
      'sample_urls', jsonb_build_array(NEW.photo_url),
      'last_added_at', NEW.created_at),
    NEW.created_at)
  ON CONFLICT (item_type, source_id) DO UPDATE SET
    metadata = jsonb_set(
                 public.home_feed_items.metadata, '{count}',
                 to_jsonb(COALESCE((public.home_feed_items.metadata->>'count')::int, 0) + 1))
               -- keep up to 4 sample thumbnails for the card
               || jsonb_build_object('last_added_at', NEW.created_at)
               || CASE
                    WHEN jsonb_array_length(COALESCE(public.home_feed_items.metadata->'sample_urls','[]'::jsonb)) < 4
                    THEN jsonb_build_object('sample_urls',
                           COALESCE(public.home_feed_items.metadata->'sample_urls','[]'::jsonb) || to_jsonb(NEW.photo_url))
                    ELSE '{}'::jsonb
                  END,
    created_at = NEW.created_at,   -- bump freshness
    deleted_at = NULL,
    is_test_account = EXCLUDED.is_test_account;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_feed_gen_failure('generate_media_added_feed_item', SQLSTATE, SQLERRM,
    jsonb_build_object('gallery_photo_id', NEW.id, 'user_id', NEW.user_id));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_media_added_feed ON public.gallery_photos;
CREATE TRIGGER trigger_media_added_feed
  AFTER INSERT ON public.gallery_photos
  FOR EACH ROW EXECUTE FUNCTION public.generate_media_added_feed_item();

-- 3. Silent accumulation: exclude 'media_added' from today's feed.
DO $$
DECLARE r RECORD; v_def text; v_new text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('get_home_feed', 'get_home_feed_new_count')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def,
      'NOT IN (''member_joined'', ''career_move'', ''club_responded'')',
      'NOT IN (''member_joined'', ''career_move'', ''club_responded'', ''media_added'')');
    IF v_new = v_def OR position('media_added' in v_new) = 0 THEN
      RAISE EXCEPTION 'media_added exclusion not applied to %()', r.proname;
    END IF;
    EXECUTE v_new;
  END LOOP;
END $$;
