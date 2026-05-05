-- =========================================================================
-- Player Full Game Videos — multi-row table for unedited match footage
-- =========================================================================
-- Players have one `highlight_video_url` (a curated reel for first
-- impressions). This table adds full, unedited match videos with
-- structured context (competition, opponent, position, minutes, etc.)
-- so clubs and coaches can evaluate players in real game conditions
-- — not just highlight-reel curation.
--
-- Player-only feature. The "Players can manage" RLS policy checks
-- current_profile_role() = 'player' so a user who flips to a different
-- role can still SELECT historical rows but cannot INSERT new ones.
--
-- Per-row visibility ('public' | 'recruiters') mirrors the existing
-- profiles.highlight_visibility shape so users learn one mental model.
-- 'recruiters' resolves to clubs + coaches only (not brand or umpire).
--
-- URLs only — no file uploads. Same posture as highlight_video_url.
-- =========================================================================

SET search_path = public;

-- =========================================================================
-- 1. Table
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.player_full_game_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Required: the link itself + a human title.
  video_url TEXT NOT NULL CHECK (length(video_url) BETWEEN 10 AND 500),
  match_title TEXT NOT NULL CHECK (length(match_title) BETWEEN 1 AND 120),

  -- Optional structured context. Players add what they have.
  match_date DATE,
  competition TEXT CHECK (competition IS NULL OR length(competition) <= 120),
  player_team TEXT CHECK (player_team IS NULL OR length(player_team) <= 120),
  opponent_team TEXT CHECK (opponent_team IS NULL OR length(opponent_team) <= 120),
  position_played TEXT CHECK (position_played IS NULL OR length(position_played) <= 60),
  shirt_number SMALLINT CHECK (shirt_number IS NULL OR (shirt_number BETWEEN 0 AND 99)),
  minutes_played SMALLINT CHECK (minutes_played IS NULL OR (minutes_played BETWEEN 0 AND 200)),

  -- Visibility — mirrors profiles.highlight_visibility.
  visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'recruiters')),

  -- Optional player notes (e.g. "Tournament final, captained the team").
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 500),

  -- Reserved for future drag-reorder UI; v1 sorts by match_date DESC.
  display_order INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE public.player_full_game_videos IS
  'Per-player full match footage with structured context. Player-only feature. Owner CRUD via RLS; visibility scoped to public OR recruiters (clubs + coaches).';

-- =========================================================================
-- 2. Indexes
-- =========================================================================
-- Owner list query: WHERE user_id = ? ORDER BY match_date DESC NULLS LAST, created_at DESC
CREATE INDEX IF NOT EXISTS idx_player_full_game_videos_user_sort
  ON public.player_full_game_videos (user_id, match_date DESC NULLS LAST, created_at DESC);

-- Public visitor query: WHERE user_id = ? AND visibility = 'public'
CREATE INDEX IF NOT EXISTS idx_player_full_game_videos_user_public
  ON public.player_full_game_videos (user_id, match_date DESC NULLS LAST)
  WHERE visibility = 'public';

-- =========================================================================
-- 3. updated_at maintenance trigger
-- =========================================================================
CREATE OR REPLACE FUNCTION public.touch_player_full_game_videos_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_player_full_game_videos_touch ON public.player_full_game_videos;
CREATE TRIGGER trigger_player_full_game_videos_touch
  BEFORE UPDATE ON public.player_full_game_videos
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_player_full_game_videos_updated_at();

-- =========================================================================
-- 4. Denormalized count column on profiles
-- =========================================================================
-- Mirrors career_entry_count so future Snapshot signals / activity
-- triggers can read a single int instead of running COUNT() per render.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_game_video_count INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.full_game_video_count IS
  'Denormalized count of public.player_full_game_videos rows for this user. Maintained by trigger; do not write directly.';

CREATE OR REPLACE FUNCTION public.maintain_full_game_video_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.profiles
       SET full_game_video_count = full_game_video_count + 1
     WHERE id = NEW.user_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.profiles
       SET full_game_video_count = GREATEST(full_game_video_count - 1, 0)
     WHERE id = OLD.user_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trigger_player_full_game_videos_count ON public.player_full_game_videos;
CREATE TRIGGER trigger_player_full_game_videos_count
  AFTER INSERT OR DELETE ON public.player_full_game_videos
  FOR EACH ROW
  EXECUTE FUNCTION public.maintain_full_game_video_count();

REVOKE EXECUTE ON FUNCTION public.maintain_full_game_video_count() FROM PUBLIC;

-- =========================================================================
-- 5. Row-Level Security
-- =========================================================================
ALTER TABLE public.player_full_game_videos ENABLE ROW LEVEL SECURITY;

-- Visitor read: public rows for everyone, recruiters rows for clubs +
-- coaches, plus all rows for the owner. RLS does the visibility filter
-- so the client never sees rows it shouldn't.
DROP POLICY IF EXISTS player_full_game_videos_select ON public.player_full_game_videos;
CREATE POLICY player_full_game_videos_select
  ON public.player_full_game_videos
  FOR SELECT
  USING (
    visibility = 'public'
    OR (
      visibility = 'recruiters'
      AND COALESCE(public.current_profile_role(), '') IN ('club', 'coach')
    )
    OR auth.uid() = user_id
  );

-- Player-only CRUD on own rows. The role check enforces "player-only
-- feature" — a coach/club/brand/umpire cannot insert into this table
-- even if they crafted a row with their own user_id.
DROP POLICY IF EXISTS player_full_game_videos_owner_manage ON public.player_full_game_videos;
CREATE POLICY player_full_game_videos_owner_manage
  ON public.player_full_game_videos
  FOR ALL
  USING (
    auth.uid() = user_id
    AND COALESCE(public.current_profile_role(), '') = 'player'
  )
  WITH CHECK (
    auth.uid() = user_id
    AND COALESCE(public.current_profile_role(), '') = 'player'
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_full_game_videos TO authenticated;
GRANT SELECT ON public.player_full_game_videos TO anon;
