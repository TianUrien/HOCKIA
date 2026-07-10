-- Gallery goes NEWEST-FIRST (client change) — preserve manually-curated
-- arrangements under the new ordering.
--
-- Until now the client displayed galleries ascending by order value and its
-- reorder wrote "top of grid = 0". The new client displays DESCENDING (higher
-- value = higher in the grid) so that new uploads (max+1) land on top and
-- never-arranged galleries — whose backfilled indexes follow created_at —
-- flip to newest-first, which is the requested product behavior.
--
-- That flip would INVERT any gallery an owner deliberately drag-arranged.
-- This migration detects exactly those owners and reverses their stored
-- indexes (new = owner_max - old), which renders IDENTICALLY under the new
-- descending display. Detection is strict: only a manual reorder can produce
-- two rows with strictly increasing order value but strictly decreasing
-- created_at (the backfill ordered by created_at, and appends only grow both).
-- Tie-only divergence (duplicate indexes from the pre-metadata era) does NOT
-- match — those galleries already tie-break by recency on both clients.
--
-- Sized on production 2026-07-10: 3 curated photo owners (17 photos),
-- 0 curated clubs, 0 gallery videos. Staging: 0 curated owners (no-op).
--
-- ⚠ NOT re-runnable: applying it twice un-flips the curated owners. The
-- migration history is the guard; never replay it manually.

DO $$
DECLARE
  v_owner uuid;
  v_max int;
  v_count int := 0;
BEGIN
  -- Profile galleries (photos + gallery videos share one order space).
  FOR v_owner IN
    SELECT DISTINCT a.user_id
    FROM public.gallery_photos a
    JOIN public.gallery_photos b
      ON a.user_id = b.user_id
     AND a.order_index < b.order_index
     AND a.created_at > b.created_at
  LOOP
    SELECT GREATEST(
      COALESCE((SELECT max(order_index) FROM public.gallery_photos WHERE user_id = v_owner), 0),
      COALESCE((SELECT max(display_order) FROM public.player_videos WHERE user_id = v_owner AND kind = 'reel'), 0)
    ) INTO v_max;

    UPDATE public.gallery_photos
       SET order_index = v_max - order_index
     WHERE user_id = v_owner;
    UPDATE public.player_videos
       SET display_order = v_max - display_order
     WHERE user_id = v_owner AND kind = 'reel';

    v_count := v_count + 1;
    RAISE NOTICE 'gallery-order-flip: profile owner % flipped (max %)', v_owner, v_max;
  END LOOP;

  -- Club galleries (photo-only).
  FOR v_owner IN
    SELECT DISTINCT a.club_id
    FROM public.club_media a
    JOIN public.club_media b
      ON a.club_id = b.club_id
     AND a.order_index < b.order_index
     AND a.created_at > b.created_at
  LOOP
    SELECT COALESCE(max(order_index), 0) INTO v_max
    FROM public.club_media WHERE club_id = v_owner;

    UPDATE public.club_media
       SET order_index = v_max - order_index
     WHERE club_id = v_owner;

    v_count := v_count + 1;
    RAISE NOTICE 'gallery-order-flip: club % flipped (max %)', v_owner, v_max;
  END LOOP;

  RAISE NOTICE 'gallery-order-flip: % curated galleries preserved', v_count;
END $$;
