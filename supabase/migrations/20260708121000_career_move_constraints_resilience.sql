-- career_move follow-up: allow the new type/source + make the generator
-- resilient. Caught by functional probing on staging (schema-verify alone
-- would have missed it): the generator's INSERT hit two whitelist CHECK
-- constraints on home_feed_items —
--   • item_type had no 'career_move'
--   • source_type had no 'user_post' (materialized feed items had never
--     originated from a post before; posts were always read live)
-- and because the generator is an AFTER INSERT trigger that RAISED, the
-- failure rolled back the whole user_posts insert — i.e. in prod, creating
-- a signing/transfer post would have failed outright.
--
-- Fixes: extend both whitelists, and wrap the generator so a feed-gen
-- failure can NEVER block the user's primary action (the post). The feed
-- card is a secondary, derived artifact; if it ever fails it should warn
-- and let the post succeed.

-- 1. Extend the whitelists (idempotent).
ALTER TABLE public.home_feed_items DROP CONSTRAINT IF EXISTS home_feed_items_item_type_check;
ALTER TABLE public.home_feed_items ADD CONSTRAINT home_feed_items_item_type_check
  CHECK (item_type = ANY (ARRAY[
    'member_joined','opportunity_posted','milestone_achieved',
    'reference_received','brand_post','brand_product','career_move'
  ]::text[]));

ALTER TABLE public.home_feed_items DROP CONSTRAINT IF EXISTS home_feed_items_source_type_check;
ALTER TABLE public.home_feed_items ADD CONSTRAINT home_feed_items_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'profile','vacancy','profile_reference','brand_post','brand_product',
    'milestone','user_post'
  ]::text[]));

-- 2. Resilient generator (same logic as 20260708120000, wrapped so a
--    failure warns and returns instead of aborting the post).
CREATE OR REPLACE FUNCTION public.generate_career_move_feed_item()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_mover_id uuid;
  v_mover RECORD;
  v_club_name text := NEW.metadata->>'club_name';
  v_club_profile_id uuid := NULLIF(NEW.metadata->>'club_profile_id', '')::uuid;
  v_club_avatar text := NEW.metadata->>'club_avatar_url';
  v_meta_world_club uuid := NULLIF(NEW.metadata->>'world_club_id', '')::uuid;
  v_club_country_id integer := NULLIF(NEW.metadata->>'club_country_id', '')::integer;
  v_world_club_id uuid;
  v_author_is_test boolean;
BEGIN
  IF NEW.post_type = 'transfer' THEN
    v_mover_id := NEW.author_id;
  ELSE  -- 'signing'
    v_mover_id := NULLIF(NEW.metadata->>'person_profile_id', '')::uuid;
  END IF;

  IF v_mover_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.id, p.full_name, p.avatar_url, p.role, p.nationality_country_id,
         p.is_blocked, p.frozen_minor_at, COALESCE(p.is_test_account, false) AS is_test
    INTO v_mover
  FROM public.profiles p
  WHERE p.id = v_mover_id;

  IF v_mover.id IS NULL
     OR public.profile_is_hidden(v_mover.is_blocked, v_mover.frozen_minor_at) THEN
    RETURN NEW;
  END IF;

  IF v_club_profile_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.profiles cp
       WHERE cp.id = v_club_profile_id
         AND public.profile_is_hidden(cp.is_blocked, cp.frozen_minor_at)
     ) THEN
    RETURN NEW;
  END IF;

  v_world_club_id := COALESCE(
    v_meta_world_club,
    public.resolve_world_club_by_name(v_club_name, v_club_country_id)
  );

  SELECT COALESCE(p.is_test_account, false) INTO v_author_is_test
  FROM public.profiles p WHERE p.id = NEW.author_id;

  INSERT INTO public.home_feed_items (
    item_type, source_id, source_type, is_test_account,
    author_profile_id, author_role, author_country_id, metadata
  )
  VALUES (
    'career_move', NEW.id, 'user_post',
    v_mover.is_test OR COALESCE(v_author_is_test, false),
    v_mover.id, v_mover.role, v_mover.nationality_country_id,
    jsonb_build_object(
      'post_id', NEW.id,
      'direction', NEW.post_type,
      'mover_profile_id', v_mover.id,
      'mover_name', v_mover.full_name,
      'mover_role', v_mover.role,
      'mover_avatar_url', v_mover.avatar_url,
      'club_name', v_club_name,
      'club_world_club_id', v_world_club_id,
      'club_avatar_url', v_club_avatar,
      'club_profile_id', v_club_profile_id
    )
  )
  ON CONFLICT (item_type, source_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a feed-gen failure roll back the user's post.
  RAISE WARNING 'career_move feed-gen failed for post %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
