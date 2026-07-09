-- P5 Phase 1 — surface 4 of the Phase-0 event types into the live Home feed.
--
-- get_home_feed returns each row as (metadata || {feed_item_id, item_type,
-- created_at}) — the generator's metadata keys ARE the client card's fields, so
-- surfacing a type needs NOTHING but removing it from the NOT IN exclusion.
--
-- Surface: club_responded, media_added, video_added, open_to_play_confirmed.
-- Keep EXCLUDED:
--   • member_joined       — deliberately removed from the feed earlier
--                           (202603130200_remove_member_joined_from_feed).
--   • career_move         — signings/transfers already render as rich live
--                           user_post announcement cards; surfacing career_move
--                           would double-card them with less detail. It stays a
--                           data-layer signal (future "Who's Moving"/ranking).
--
-- Self-splice both get_home_feed (3 sites) and get_home_feed_new_count (1 site);
-- guard that the surfaced types are gone from the exclusion.
DO $$
DECLARE r RECORD; v_def text; v_new text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('get_home_feed', 'get_home_feed_new_count')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def,
      'NOT IN (''member_joined'', ''career_move'', ''club_responded'', ''media_added'', ''video_added'', ''open_to_play_confirmed'')',
      'NOT IN (''member_joined'', ''career_move'')');
    IF v_new = v_def OR position('club_responded' in v_new) > 0 THEN
      RAISE EXCEPTION 'surface-4 not applied to %() (anchor missing or type still excluded)', r.proname;
    END IF;
    EXECUTE v_new;
  END LOOP;
END $$;
