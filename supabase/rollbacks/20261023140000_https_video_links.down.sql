-- Rollback for 20261023140000_https_video_links.sql: drop the two https-only
-- rules (the app-side link checks stay). No data changes.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_highlight_video_url_https;
ALTER TABLE public.player_full_game_videos DROP CONSTRAINT IF EXISTS player_full_game_videos_video_url_https;
