-- Probe for 20261023140000: only https video links can be saved.
-- Run on STAGING only (E2E player) via execute_sql; one transaction, rolled
-- back by the final RAISE.
DO $probe$
DECLARE
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';
  v_out text := '';
  v_bad text;
  v_ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_player, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- A: the owner can still save normal links and clear the highlight
  BEGIN
    UPDATE profiles SET highlight_video_url = 'https://www.youtube.com/watch?v=abc123' WHERE id = c_player;
    UPDATE profiles SET highlight_video_url = NULL WHERE id = c_player;
    INSERT INTO player_full_game_videos (user_id, video_url, match_title) VALUES (c_player, 'https://www.hockeytv.com/watch/1', '[PROBE] ok');
    v_out := v_out || E'\nPASS A owner saves https links and clears the highlight';
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || E'\nFAIL A ' || left(sqlerrm, 120);
  END;

  -- B: dangerous or non-https values are refused on both columns
  FOREACH v_bad IN ARRAY ARRAY['javascript:alert(1)', 'data:text/html,x', 'http://site.com/x', ' https://site.com/x', 'https://site.com/a b', 'JAVASCRIPT:alert(1)'] LOOP
    v_ok := false;
    BEGIN
      UPDATE profiles SET highlight_video_url = v_bad WHERE id = c_player;
    EXCEPTION WHEN check_violation THEN v_ok := true;
    END;
    v_out := v_out || E'\n' || format('%s B1 highlight refuses %L', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END, v_bad);
    v_ok := false;
    BEGIN
      INSERT INTO player_full_game_videos (user_id, video_url, match_title) VALUES (c_player, v_bad || '/padding', '[PROBE] bad');
    EXCEPTION WHEN check_violation THEN v_ok := true;
    END;
    v_out := v_out || E'\n' || format('%s B2 full match refuses %L', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END, v_bad);
  END LOOP;

  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION 'PROBE RESULT (rolled back):%', v_out;
END
$probe$;
