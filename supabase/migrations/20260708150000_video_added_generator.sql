-- P4 Phase 0 — video_added / "New video" feed generator (Home redesign).
--
-- Sibling to the photo generator (media_added, 20260708140000), but PER-VIDEO
-- (one home_feed_items row per video), not aggregated — a highlight or full
-- match is a meaningful recruiting artifact and must not be buried in a count.
--
-- ARCHITECTURE (confirmed via code): all first-party video lives on Cloudflare
-- Stream in public.player_videos; Supabase holds only metadata/refs/ownership/
-- visibility/status. The row INSERTs at status='pending_upload' and is flipped
-- to 'ready' by exactly ONE writer — the Cloudflare webhook
-- (supabase/functions/video-webhook/index.ts) — in the same atomic UPDATE that
-- populates playback_id/thumbnail_url/duration_seconds. So the card fires when
-- the video becomes watchable (status→ready), NEVER on insert.
--
-- DECISIONS (Tian, 2026-07-09):
--  • player_videos ONLY. Legacy YouTube-link player_full_game_videos is
--    deprecated and deliberately EXCLUDED — the feed targets the future
--    (Cloudflare) architecture, not the surface we're retiring.
--  • Native full-match (player_videos.kind='full_match') IS included; the card
--    labels by kind ('full_match' → "Full match", else "New highlight").
--  • v1 generates cards for visibility='public' ONLY. Recruiter-only videos get
--    NO card yet — proper audience gating is a READ-PATH concern and ships with
--    the Pulse (avoids a leak landmine of invisible-but-present recruiter rows).
--  • Reels stay kind='highlight' for now. This generator carries NEW.kind
--    through VERBATIM (no label/branch hardcoded in SQL), so adding
--    kind='reel'/'short_clip' later is a pure upload-side change — zero rework
--    here; the card renders whatever kind exists.
--  • Card stores video_id (NOT thumbnail_url — that Cloudflare URL is unsigned
--    and 401s on these signed-playback assets). The client mints the signed
--    poster + playback token at render, which also self-heals: a deleted/
--    errored/now-private video's mint returns 409 → card fails safe.
--  • Feed-only (no push/email). No backfill (future transitions only).
--
-- Guardrails (same contract as the other generators): hidden-predicate fence on
-- the uploader; ON CONFLICT (item_type, source_id) DO NOTHING → idempotent, so a
-- Cloudflare ready→processing→ready flip-flop can never create a duplicate card;
-- silent-accumulate (excluded from today's get_home_feed + new_count); resilient
-- + observable (a feed-gen failure never blocks the webhook's ready write, and
-- logs to error_logs via _log_feed_gen_failure).

-- 1. Whitelist the new item_type. (source_type 'media' is already allowed —
--    added with media_added in 20260708140000 — so no source_type change.)
ALTER TABLE public.home_feed_items DROP CONSTRAINT IF EXISTS home_feed_items_item_type_check;
ALTER TABLE public.home_feed_items ADD CONSTRAINT home_feed_items_item_type_check
  CHECK (item_type = ANY (ARRAY[
    'member_joined','opportunity_posted','milestone_achieved','reference_received',
    'brand_post','brand_product','career_move','club_responded','media_added','video_added'
  ]::text[]));

-- 2. Generator: one card per player_videos row that becomes ready + public.
CREATE OR REPLACE FUNCTION public.generate_video_added_feed_item()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_up RECORD;
BEGIN
  SELECT p.id, p.full_name, p.avatar_url, p.role, p.nationality_country_id,
         p.is_blocked, p.frozen_minor_at, COALESCE(p.is_test_account, false) AS is_test
    INTO v_up
  FROM public.profiles p WHERE p.id = NEW.user_id;

  -- Hidden (banned/frozen) uploader → no card.
  IF v_up.id IS NULL
     OR public.profile_is_hidden(v_up.is_blocked, v_up.frozen_minor_at) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.home_feed_items (
    item_type, source_id, source_type, is_test_account,
    author_profile_id, author_role, author_country_id, metadata, created_at)
  VALUES (
    'video_added', NEW.id, 'media', v_up.is_test,
    v_up.id, v_up.role, v_up.nationality_country_id,
    jsonb_build_object(
      'media_kind', 'video',
      'video_source', 'native',            -- Cloudflare Stream (vs deprecated full_game)
      'video_id', NEW.id,                  -- token-mint anchor + deep-link; NOT thumbnail_url
      'kind', NEW.kind,                    -- carried through verbatim: highlight | full_match | (future) reel
      'title', NEW.title,
      'duration_seconds', NEW.duration_seconds,
      'visibility', NEW.visibility,        -- always 'public' in v1 (WHEN clause); stored for the future audience filter
      'uploader_id', v_up.id,
      'uploader_name', v_up.full_name,
      'uploader_role', v_up.role,
      'uploader_avatar_url', v_up.avatar_url),
    timezone('utc', now()))                -- dated at ready-time; no day bucket → no cross-midnight split
  ON CONFLICT (item_type, source_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_feed_gen_failure('generate_video_added_feed_item', SQLSTATE, SQLERRM,
    jsonb_build_object('player_video_id', NEW.id, 'user_id', NEW.user_id));
  RETURN NEW;
END;
$$;

-- 3. Triggers. Primary = the ready transition (webhook UPDATE). The WHEN fires
--    when the row ENTERS the (ready AND public) state via a status flip OR a
--    recruiters→public visibility flip — but never on a title edit of an
--    already-ready-public row, and never on public→recruiters. Idempotent
--    upsert makes any duplicate fire (flip-flop) a no-op.
DROP TRIGGER IF EXISTS trigger_video_added_feed_update ON public.player_videos;
CREATE TRIGGER trigger_video_added_feed_update
  AFTER UPDATE ON public.player_videos
  FOR EACH ROW
  WHEN (
    NEW.status = 'ready' AND NEW.visibility = 'public'
    AND (OLD.status IS DISTINCT FROM 'ready' OR OLD.visibility IS DISTINCT FROM 'public')
  )
  EXECUTE FUNCTION public.generate_video_added_feed_item();

-- Defensive: a future write path (admin import / data migration) that INSERTs a
-- row already at status='ready' would otherwise never fire the UPDATE trigger.
-- Today no path does this (rows insert at pending_upload), so this is dormant;
-- the idempotent upsert keeps it safe if that ever changes.
DROP TRIGGER IF EXISTS trigger_video_added_feed_insert ON public.player_videos;
CREATE TRIGGER trigger_video_added_feed_insert
  AFTER INSERT ON public.player_videos
  FOR EACH ROW
  WHEN (NEW.status = 'ready' AND NEW.visibility = 'public')
  EXECUTE FUNCTION public.generate_video_added_feed_item();

-- 4. Silent accumulation: exclude 'video_added' from today's feed reads.
DO $$
DECLARE r RECORD; v_def text; v_new text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('get_home_feed', 'get_home_feed_new_count')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def,
      'NOT IN (''member_joined'', ''career_move'', ''club_responded'', ''media_added'')',
      'NOT IN (''member_joined'', ''career_move'', ''club_responded'', ''media_added'', ''video_added'')');
    IF v_new = v_def OR position('video_added' in v_new) = 0 THEN
      RAISE EXCEPTION 'video_added exclusion not applied to %()', r.proname;
    END IF;
    EXECUTE v_new;
  END LOOP;
END $$;
