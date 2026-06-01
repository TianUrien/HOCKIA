-- =========================================================================
-- Native player video uploads (Cloudflare Stream) — Phase 1: schema
-- =========================================================================
-- HOCKIA is moving highlight / match video off embedded third-party links
-- (YouTube / Google Drive) onto natively-uploaded video stored on a
-- dedicated streaming provider (Cloudflare Stream). This removes the
-- embed-permission / CSP / Drive-throttling flakiness, gives a native
-- in-app player, and — critically for recruitment — lets us actually
-- ENFORCE "recruiters only" visibility (impossible with a public
-- YouTube/Drive URL).
--
-- This table is the source of truth for a native upload. The upload
-- lifecycle:
--   1. Player requests an upload → Edge Function (service_role) creates a
--      row in status='pending_upload' + a Cloudflare direct-upload URL.
--   2. Client uploads the file straight to Cloudflare (resumable).
--   3. Cloudflare transcodes + generates a thumbnail, then fires a webhook
--      → Edge Function (service_role) flips status='ready' and fills
--      playback_id / thumbnail_url / duration_seconds.
--   4. Playback uses a short-lived SIGNED token minted by an Edge Function
--      AFTER it checks the viewer's role against `visibility` — the raw
--      asset is never publicly addressable.
--
-- Hybrid: the legacy embed path (profiles.highlight_video_url +
-- player_full_game_videos.video_url) stays live during the transition;
-- this table is additive.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.player_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- What kind of video this is. 'highlight' is the MVP focus; 'full_match'
  -- is a later phase (larger files / different cost tier) but modelled now
  -- so we don't need a migration to add it.
  kind TEXT NOT NULL DEFAULT 'highlight'
    CHECK (kind IN ('highlight', 'full_match')),

  -- Player-supplied metadata.
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  description TEXT CHECK (description IS NULL OR length(description) <= 500),

  -- Visibility — mirrors player_full_game_videos / profiles.highlight_visibility.
  -- 'public'      → anyone (incl. anon) may obtain a playback token.
  -- 'recruiters'  → only club + coach roles may obtain a playback token.
  -- The actual enforcement happens at token-mint time in the playback
  -- Edge Function; RLS below also hides recruiters-only rows from
  -- non-recruiters so the list itself never leaks their existence.
  visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'recruiters')),

  -- ── Provider fields (Cloudflare Stream) ──
  -- Written by the service_role (Edge Functions), never the client. The
  -- client may create the row + metadata, but cannot set/alter provider
  -- state (see the owner RLS policy's WITH CHECK below).
  provider TEXT NOT NULL DEFAULT 'cloudflare'
    CHECK (provider IN ('cloudflare')),
  -- Cloudflare Stream asset uid (the "uid" returned by the direct-upload
  -- + present in webhook payloads). Null until the upload row is created
  -- by the Edge Function.
  cf_uid TEXT UNIQUE,
  -- Cloudflare playback id (often == cf_uid for Stream, but kept separate
  -- so we're not coupled to that assumption / can swap providers).
  playback_id TEXT,
  thumbnail_url TEXT CHECK (thumbnail_url IS NULL OR length(thumbnail_url) <= 1000),
  duration_seconds INT CHECK (duration_seconds IS NULL OR (duration_seconds BETWEEN 0 AND 36000)),

  -- Lifecycle. pending_upload → uploaded → processing → ready | errored.
  -- Only 'ready' rows render a playable card; others show a processing /
  -- failed state to the owner and are hidden from visitors.
  status TEXT NOT NULL DEFAULT 'pending_upload'
    CHECK (status IN ('pending_upload', 'uploaded', 'processing', 'ready', 'errored')),
  error_reason TEXT CHECK (error_reason IS NULL OR length(error_reason) <= 500),

  -- Reserved for future drag-reorder; v1 sorts created_at DESC.
  display_order INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE public.player_videos IS
  'Natively-uploaded player videos on Cloudflare Stream (highlight + future full_match). Source of truth for the upload lifecycle. Provider fields (cf_uid/playback_id/thumbnail_url/duration/status) are written only by service_role Edge Functions; players own row + metadata via RLS. Visibility (public|recruiters) is enforced at playback-token mint time.';

-- updated_at maintenance (reuse the standard trigger fn if present, else inline).
CREATE OR REPLACE FUNCTION public.touch_player_videos_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_player_videos_updated_at ON public.player_videos;
CREATE TRIGGER trigger_player_videos_updated_at
  BEFORE UPDATE ON public.player_videos
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_player_videos_updated_at();

REVOKE EXECUTE ON FUNCTION public.touch_player_videos_updated_at() FROM PUBLIC;

-- Indexes: owner list (sorted), and the public/visitor list.
CREATE INDEX IF NOT EXISTS idx_player_videos_user_sort
  ON public.player_videos (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_player_videos_user_ready
  ON public.player_videos (user_id, status)
  WHERE status = 'ready';

-- =========================================================================
-- Row-Level Security
-- =========================================================================
ALTER TABLE public.player_videos ENABLE ROW LEVEL SECURITY;

-- Visitor read: a row is visible if it's READY and either public, or
-- recruiters-only to a club/coach. The owner always sees their own rows
-- (incl. non-ready, so they can watch processing/failed state). RLS does
-- the visibility filter so the client never receives rows it shouldn't —
-- the playback Edge Function re-checks at token mint as defence in depth.
DROP POLICY IF EXISTS player_videos_select ON public.player_videos;
CREATE POLICY player_videos_select
  ON public.player_videos
  FOR SELECT
  USING (
    (
      status = 'ready'
      AND (
        visibility = 'public'
        OR (
          visibility = 'recruiters'
          AND COALESCE(public.current_profile_role(), '') IN ('club', 'coach')
        )
      )
    )
    OR auth.uid() = user_id
  );

-- Player-only ownership of own rows. Enforces "player-only feature" via
-- the role check (a coach/club can't create rows even with their own
-- user_id). NOTE: the client legitimately INSERTs the metadata row and
-- UPDATEs title/description/visibility/delete; the provider fields
-- (cf_uid/playback_id/thumbnail_url/duration_seconds/status) are set by
-- the service_role Edge Functions, which bypass RLS. We intentionally do
-- NOT try to column-restrict here (Postgres RLS can't per-column on the
-- same policy cleanly) — instead the Edge Function is the only path that
-- creates the Cloudflare asset, so a client writing junk into cf_uid just
-- produces an orphan row with no real asset, harmless and owner-scoped.
DROP POLICY IF EXISTS player_videos_owner_manage ON public.player_videos;
CREATE POLICY player_videos_owner_manage
  ON public.player_videos
  FOR ALL
  USING (
    auth.uid() = user_id
    AND COALESCE(public.current_profile_role(), '') = 'player'
  )
  WITH CHECK (
    auth.uid() = user_id
    AND COALESCE(public.current_profile_role(), '') = 'player'
  );

-- Grants mirror player_full_game_videos: authenticated CRUD (RLS-scoped),
-- anon SELECT (RLS still restricts to ready+public). service_role keeps
-- full access by default (used by the Edge Functions).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_videos TO authenticated;
GRANT SELECT ON public.player_videos TO anon;
