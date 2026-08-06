-- Feed hygiene: media_added / video_added cards must not outlive their media.
--
-- INCIDENT (prod, 2026-08-07): a media_added rollup card showed 3 broken
-- image tiles on Home. The user uploaded 3 photos on Aug 5 and deleted them
-- shortly after — rows and storage files were correctly removed, but the
-- daily-rollup feed card kept its count + sample_urls forever. The milestone
-- family already handles this (handle_gallery_photo_delete_milestone repoints
-- or retires the card); the media_added rollup and video_added cards simply
-- had no delete handler at all. Not a regression — the gap existed since the
-- cards were introduced.
--
-- Design: on every gallery_photos DELETE, RECOMPUTE the same-day rollup from
-- the surviving rows (count + up to 4 sample_urls, chronological like the
-- insert trigger's appends) rather than decrementing — idempotent and
-- self-healing if a card ever drifts again. Zero survivors → soft-delete the
-- card. The rollup is addressed by its deterministic source_id
-- (md5(user|day|photo)::uuid), exactly as generate_media_added_feed_item
-- builds it. video_added cards are per-video → soft-delete on video delete.
--
-- Both handlers swallow their own errors via _log_feed_gen_failure: feed
-- cosmetics must never block a user's delete.

CREATE OR REPLACE FUNCTION public.handle_gallery_photo_delete_media_added()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_day date;
  v_source_id uuid;
  v_count integer;
  v_samples jsonb;
BEGIN
  v_day := (timezone('utc', OLD.created_at))::date;
  v_source_id := md5(OLD.user_id::text || '|' || v_day::text || '|photo')::uuid;

  -- Recompute the rollup from the photos that still exist for that day.
  SELECT COUNT(*),
         COALESCE(jsonb_agg(photo_url ORDER BY created_at) FILTER (WHERE rn <= 4), '[]'::jsonb)
    INTO v_count, v_samples
  FROM (
    SELECT gp.photo_url, gp.created_at,
           row_number() OVER (ORDER BY gp.created_at) AS rn
    FROM gallery_photos gp
    WHERE gp.user_id = OLD.user_id
      AND (timezone('utc', gp.created_at))::date = v_day
      AND gp.id != OLD.id  -- BEFORE DELETE: exclude the row being removed
  ) survivors;

  IF v_count = 0 THEN
    UPDATE home_feed_items
    SET deleted_at = now()
    WHERE item_type = 'media_added'
      AND source_id = v_source_id
      AND deleted_at IS NULL;
  ELSE
    UPDATE home_feed_items
    SET metadata = metadata
      || jsonb_build_object('count', v_count)
      || jsonb_build_object('sample_urls', v_samples)
    WHERE item_type = 'media_added'
      AND source_id = v_source_id
      AND deleted_at IS NULL;
  END IF;

  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_feed_gen_failure('handle_gallery_photo_delete_media_added', SQLSTATE, SQLERRM,
    jsonb_build_object('gallery_photo_id', OLD.id, 'user_id', OLD.user_id));
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_gallery_photo_delete_media_added ON public.gallery_photos;
CREATE TRIGGER trg_gallery_photo_delete_media_added
  BEFORE DELETE ON public.gallery_photos
  FOR EACH ROW EXECUTE FUNCTION public.handle_gallery_photo_delete_media_added();

-- video_added cards are one-per-video: retire the card with its video.
CREATE OR REPLACE FUNCTION public.handle_player_video_delete_feed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE home_feed_items
  SET deleted_at = now()
  WHERE item_type = 'video_added'
    AND metadata->>'video_id' = OLD.id::text
    AND deleted_at IS NULL;

  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_feed_gen_failure('handle_player_video_delete_feed', SQLSTATE, SQLERRM,
    jsonb_build_object('video_id', OLD.id, 'user_id', OLD.user_id));
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_player_video_delete_feed ON public.player_videos;
CREATE TRIGGER trg_player_video_delete_feed
  BEFORE DELETE ON public.player_videos
  FOR EACH ROW EXECUTE FUNCTION public.handle_player_video_delete_feed();

-- ── One-time repair of existing drift ────────────────────────────────────
-- Recompute every live media_added card from the surviving photos of its
-- day. Cards whose photos are all gone are soft-deleted (this retires the
-- incident card); partially-drifted cards get truthful count + samples.
WITH truth AS (
  SELECT hfi.id AS feed_id,
         (SELECT COUNT(*) FROM gallery_photos gp
           WHERE gp.user_id::text = hfi.metadata->>'uploader_id'
             AND (timezone('utc', gp.created_at))::date = (hfi.metadata->>'day')::date) AS live_count,
         (SELECT COALESCE(jsonb_agg(photo_url ORDER BY created_at) FILTER (WHERE rn <= 4), '[]'::jsonb)
            FROM (SELECT gp.photo_url, gp.created_at,
                         row_number() OVER (ORDER BY gp.created_at) AS rn
                    FROM gallery_photos gp
                   WHERE gp.user_id::text = hfi.metadata->>'uploader_id'
                     AND (timezone('utc', gp.created_at))::date = (hfi.metadata->>'day')::date) s) AS live_samples
  FROM home_feed_items hfi
  WHERE hfi.item_type = 'media_added' AND hfi.deleted_at IS NULL
)
UPDATE home_feed_items hfi
SET deleted_at = CASE WHEN t.live_count = 0 THEN now() ELSE hfi.deleted_at END,
    metadata = CASE WHEN t.live_count = 0 THEN hfi.metadata
                    ELSE hfi.metadata
                      || jsonb_build_object('count', t.live_count)
                      || jsonb_build_object('sample_urls', t.live_samples)
               END
FROM truth t
WHERE hfi.id = t.feed_id
  AND (t.live_count = 0
       OR (hfi.metadata->>'count')::int IS DISTINCT FROM t.live_count
       OR hfi.metadata->'sample_urls' IS DISTINCT FROM t.live_samples);

-- Retire video_added cards whose video row no longer exists.
UPDATE home_feed_items hfi
SET deleted_at = now()
WHERE hfi.item_type = 'video_added'
  AND hfi.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM player_videos pv WHERE pv.id::text = hfi.metadata->>'video_id');
