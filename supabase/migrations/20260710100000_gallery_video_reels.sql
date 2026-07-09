-- Gallery videos (kind='reel') — backend fences.
--
-- The Gallery is a USER MEDIA surface: photos (gallery_photos, Supabase Storage)
-- + videos (player_videos kind='reel', Cloudflare Stream). It is NOT the Home
-- feed and NOT the recruitment evidence section. See 20260709150000 for the
-- full five-concept taxonomy.
--
-- Two real defects block a correct Gallery today:
--
--  1) `player_videos_owner_manage` is FOR ALL ... AND current_profile_role()='player'.
--     The Gallery is rendered for player, coach AND umpire (MediaTab ->
--     GalleryManager mode='profile'), and gallery_photos RLS has allowed
--     player/coach/umpire/brand since 20260422190000. So a coach's reel would
--     INSERT fine (video-create-upload writes as service_role, bypassing RLS)
--     but their reorder/caption UPDATE and their DELETE would be SILENTLY
--     rejected — PostgREST reports 0 rows changed, not an error.
--
--  2) The policy also gates SELECT-for-owner behind role='player'. Harmless
--     only because `player_videos_select` already carries an owner branch.
--
-- Fix: owner-scoped UPDATE/DELETE where RECRUITMENT kinds stay player-only and
-- SOCIAL kinds (post/reel) are open to every role — exactly mirroring the
-- video-create-upload role clamp. There is deliberately NO INSERT policy: no
-- client code inserts into player_videos (verified repo-wide), every row is
-- born in video-create-upload under service_role, and denying client INSERT
-- keeps a user from forging a `ready` row that points at someone else's asset.

DROP POLICY IF EXISTS player_videos_owner_manage ON public.player_videos;
DROP POLICY IF EXISTS player_videos_owner_update ON public.player_videos;
DROP POLICY IF EXISTS player_videos_owner_delete ON public.player_videos;

-- Recruitment kinds (highlight/full_match) are evidence on a PLAYER profile.
-- Social kinds (post/reel) belong to every role.
CREATE POLICY player_videos_owner_update ON public.player_videos
  FOR UPDATE TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    AND (
      kind IN ('post', 'reel')
      OR COALESCE(public.current_profile_role(), '') = 'player'
    )
  )
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (
      kind IN ('post', 'reel')
      OR COALESCE(public.current_profile_role(), '') = 'player'
    )
  );

CREATE POLICY player_videos_owner_delete ON public.player_videos
  FOR DELETE TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    AND (
      kind IN ('post', 'reel')
      OR COALESCE(public.current_profile_role(), '') = 'player'
    )
  );

-- `kind` is the product-surface discriminator. Nothing in the product ever
-- reclassifies a video after creation, and letting a user do so would let them
-- hop surfaces: flip a Gallery reel to 'highlight' and it lands in the
-- recruitment evidence section; flip a post video to 'reel' and it appears in
-- the Gallery. Freeze it for end-user (auth.uid()-bearing) writes. service_role
-- and migrations (auth.uid() IS NULL) stay free to reclassify.
CREATE OR REPLACE FUNCTION public.enforce_player_video_kind_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'player_videos.kind is immutable (% -> %)', OLD.kind, NEW.kind
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_player_videos_kind_immutable ON public.player_videos;
CREATE TRIGGER trigger_player_videos_kind_immutable
  BEFORE UPDATE ON public.player_videos
  FOR EACH ROW
  WHEN (OLD.kind IS DISTINCT FROM NEW.kind)
  EXECUTE FUNCTION public.enforce_player_video_kind_immutable();

-- The Gallery lists one owner's reels ordered by display_order. Without this the
-- planner scans user_id then filters+sorts.
CREATE INDEX IF NOT EXISTS idx_player_videos_user_kind_order
  ON public.player_videos (user_id, kind, display_order, created_at DESC);

COMMENT ON COLUMN public.player_videos.display_order IS
  'Gallery ordering for kind=''reel'' (mirrors gallery_photos.order_index; the two are merged into one grid). Unused by other kinds.';
