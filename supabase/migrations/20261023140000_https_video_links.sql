-- Video links must be https web addresses (founder go-ahead 2026-10-23,
-- after the CodeQL triage in PR 421).
--
-- profiles.highlight_video_url and player_full_game_videos.video_url hold
-- text members write. The app now only opens or embeds safe links, but the
-- database accepted anything, so a `javascript:` / `data:` value written
-- straight to the API would sit there for any other client to trip on. Both
-- columns now accept only "https://" followed by no whitespace (NULL stays
-- allowed for the optional highlight).
--
-- Every writer already produces https:// (AddVideoLinkModal and
-- validateFullMatchUrl canonicalise to https, Hockia AI's link step and the
-- profile builder force https), including the versions in installed apps,
-- so nothing that saves today is refused. Checked before writing: production
-- 36 highlight + 9 full-match links, staging 2 + 3, all pass.
--
-- Rollback: supabase/rollbacks/20261023140000_https_video_links.down.sql

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_highlight_video_url_https;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_highlight_video_url_https
  CHECK (highlight_video_url IS NULL OR highlight_video_url ~ '^https://[^[:space:]]+$');

ALTER TABLE public.player_full_game_videos
  DROP CONSTRAINT IF EXISTS player_full_game_videos_video_url_https;
ALTER TABLE public.player_full_game_videos
  ADD CONSTRAINT player_full_game_videos_video_url_https
  CHECK (video_url ~ '^https://[^[:space:]]+$');
