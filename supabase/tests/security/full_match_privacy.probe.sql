-- Probe for migration 20260926120000_full_match_privacy (Phase 1 · step 3).
-- Run on STAGING only (fixture ids are the E2E accounts there) via the SQL editor or
-- MCP execute_sql, AFTER the migration.
--
-- Nothing is kept: every case runs in its own sub-transaction that is always undone, and
-- the block ends by raising 'PROBE RESULTS', which rolls back the whole statement. The
-- results are in that error message, one line per case, each ending PASS or FAIL.
--
-- Fixtures (staging, kept on purpose): the E2E player owns
--   * a ready native full match  "[QA] Full match — privacy check"      (player_videos)
--   * a legacy full-match link   "[QA] Full match link — privacy check" (player_full_game_videos)
--   * a ready recruiters-only highlight "[QA] Highlight — playback check"
-- Personas that do not exist as accounts (non-recruiting coach, hidden club) are made by
-- flipping the E2E coach / club inside the undone sub-transaction.

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- the owner P
  c_coach  constant uuid := 'aa84af5e-7c03-4202-93ff-5898ccd1fbac';
  c_other  constant uuid := 'e4d2f85a-4b1e-4734-994a-9375cb85b4d8';  -- another player
  v_out  text := '';
  v_line text;
  v_pv int; v_fg int; v_locked int; v_rec boolean;
  v_expect_visible boolean;
  v_expect_locked int;
  v_persona record;
  v_n int; v_txt text;
  v_hl uuid;
BEGIN
  -- ── Matrix: who can see P's full matches ──
  FOR v_persona IN
    SELECT * FROM (VALUES
      ('owner P',                 c_player, 'none',        true,  0),
      ('other player',            c_other,  'none',        false, 2),
      ('coach, not recruiting',   c_coach,  'coach_off',   false, 2),
      ('coach, recruiting',       c_coach,  'coach_on',    true,  0),
      ('club',                    c_club,   'none',        true,  0),
      ('anon',                    NULL,     'none',        false, 2),
      ('hidden (banned) club',    c_club,   'club_hidden', false, 2)
    ) AS t(label, uid, setup, visible, locked)
  LOOP
    BEGIN
      IF v_persona.setup = 'coach_off' THEN
        UPDATE profiles SET coach_recruits_for_team = false WHERE id = c_coach;
      ELSIF v_persona.setup = 'coach_on' THEN
        UPDATE profiles SET coach_recruits_for_team = true WHERE id = c_coach;
      ELSIF v_persona.setup = 'club_hidden' THEN
        UPDATE profiles SET is_blocked = true WHERE id = c_club;
      END IF;

      IF v_persona.uid IS NULL THEN
        PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
        EXECUTE 'SET LOCAL ROLE anon';
      ELSE
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_persona.uid, 'role', 'authenticated')::text, true);
        EXECUTE 'SET LOCAL ROLE authenticated';
      END IF;

      SELECT count(*) INTO v_pv FROM player_videos WHERE user_id = c_player AND kind = 'full_match';
      SELECT count(*) INTO v_fg FROM player_full_game_videos WHERE user_id = c_player;
      SELECT (get_video_access_summary(c_player)->>'locked_full_matches')::int INTO v_locked;
      SELECT is_recruiter(v_persona.uid) INTO v_rec;

      v_line := format('%-24s pv_full_match=%s links=%s locked=%s is_recruiter=%s → %s',
        v_persona.label, v_pv, v_fg, coalesce(v_locked::text, 'null'), v_rec,
        CASE WHEN (v_pv > 0 AND v_fg > 0) = v_persona.visible
               AND (v_pv = 0 AND v_fg = 0) = NOT v_persona.visible
               AND (v_persona.setup = 'club_hidden' OR coalesce(v_locked, -1) = v_persona.locked)
             THEN 'PASS' ELSE 'FAIL' END);
      RAISE EXCEPTION 'probe_undo';
    EXCEPTION WHEN others THEN
      IF SQLERRM <> 'probe_undo' THEN v_line := v_persona.label || ' → FAIL (' || SQLERRM || ')'; END IF;
      v_out := v_out || E'\n' || v_line;
    END;
  END LOOP;

  -- ── Master switch: P makes full matches public → cascade, others can see ──
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE profiles SET full_match_visibility = 'public' WHERE id = c_player;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_other, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO v_pv FROM player_videos WHERE user_id = c_player AND kind = 'full_match';
    SELECT count(*) INTO v_fg FROM player_full_game_videos WHERE user_id = c_player;
    SELECT (get_video_access_summary(c_player)->>'locked_full_matches')::int INTO v_locked;
    v_line := format('switch to public → other player sees pv=%s links=%s locked=%s → %s',
      v_pv, v_fg, v_locked, CASE WHEN v_pv > 0 AND v_fg > 0 AND v_locked = 0 THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'switch to public → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── Master switch back to recruiters re-locks, highlights untouched ──
  BEGIN
    UPDATE profiles SET full_match_visibility = 'public' WHERE id = c_player;
    UPDATE profiles SET full_match_visibility = 'recruiters' WHERE id = c_player;
    SELECT count(*) INTO v_n FROM (
      SELECT visibility FROM player_videos WHERE user_id = c_player AND kind = 'full_match'
      UNION ALL SELECT visibility FROM player_full_game_videos WHERE user_id = c_player) x
      WHERE visibility <> 'recruiters';
    SELECT count(*) INTO v_pv FROM player_videos WHERE user_id = c_player AND kind IN ('reel','post') AND visibility = 'recruiters';
    v_line := format('switch back → non-recruiters full-match rows=%s, reels/posts made private=%s → %s',
      v_n, v_pv, CASE WHEN v_n = 0 AND v_pv = 0 THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'switch back → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── Insert trigger: a new link asking for public inherits the switch ──
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO player_full_game_videos (user_id, match_title, video_url, visibility)
      VALUES (c_player, 'probe link', 'https://example.com/probe', 'public') RETURNING visibility INTO v_txt;
    v_line := format('insert link asking public (switch=recruiters) → stored %s → %s', v_txt, CASE WHEN v_txt = 'recruiters' THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'insert link → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── Per-video exception: owner can still make ONE full match public ──
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE player_videos SET visibility = 'public' WHERE user_id = c_player AND kind = 'full_match';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_line := format('owner makes one full match public → %s rows → %s', v_n, CASE WHEN v_n > 0 THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'per-video exception → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── Feed: a public full match never produces a live card ──
  BEGIN
    UPDATE player_videos SET visibility = 'public' WHERE user_id = c_player AND kind = 'full_match';
    SELECT count(*) INTO v_n FROM home_feed_items hfi
      JOIN player_videos v ON v.id = hfi.source_id
     WHERE hfi.item_type = 'video_added' AND v.user_id = c_player AND v.kind = 'full_match' AND hfi.deleted_at IS NULL;
    v_line := format('public full match → live feed cards=%s → %s', v_n, CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'feed full match → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── Feed guard: a hand-written full-match card is forced deleted ──
  BEGIN
    INSERT INTO home_feed_items (item_type, source_id, source_type, author_profile_id, author_role, metadata)
      VALUES ('video_added', gen_random_uuid(), 'media', c_player, 'player', jsonb_build_object('kind', 'full_match'))
      RETURNING (deleted_at IS NOT NULL)::text INTO v_txt;
    v_line := format('direct full-match card insert → deleted=%s → %s', v_txt, CASE WHEN v_txt = 'true' THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'feed guard → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── Feed: a highlight going public→recruiters loses its card; highlights still post ──
  BEGIN
    SELECT id INTO v_hl FROM player_videos WHERE user_id = c_player AND kind = 'highlight' AND status = 'ready' LIMIT 1;
    UPDATE player_videos SET visibility = 'public' WHERE id = v_hl;
    SELECT count(*) INTO v_n FROM home_feed_items WHERE item_type = 'video_added' AND source_id = v_hl AND deleted_at IS NULL;
    UPDATE player_videos SET visibility = 'recruiters' WHERE id = v_hl;
    SELECT count(*) INTO v_pv FROM home_feed_items WHERE item_type = 'video_added' AND source_id = v_hl AND deleted_at IS NULL;
    v_line := format('highlight public → live cards=%s; then recruiters → live cards=%s → %s', v_n, v_pv,
      CASE WHEN v_n = 1 AND v_pv = 0 THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'highlight feed → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── Notice: readable directly by the owner, never returned by get_my_pulse ──
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_n FROM user_pulse_items WHERE item_type = 'full_match_privacy_default';
    SELECT count(*) INTO v_pv FROM get_my_pulse(50) WHERE item_type = 'full_match_privacy_default';
    v_line := format('notice: direct select=%s, get_my_pulse=%s → %s', v_n, v_pv, CASE WHEN v_n = 1 AND v_pv = 0 THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'notice → FAIL (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  -- ── Non-owner cannot flip someone else's switch ──
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_other, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE profiles SET full_match_visibility = 'public' WHERE id = c_player;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_line := format('other player flips P''s switch → %s rows → %s', v_n, CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'other flips switch → PASS (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  RAISE EXCEPTION 'PROBE RESULTS%', v_out;
END
$probe$;
