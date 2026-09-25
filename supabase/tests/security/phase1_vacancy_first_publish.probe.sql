-- Probe for migration 20260926140000_vacancy_announce_first_publish_only (founder ruling E:
-- a role is announced ONCE, on its first publish; reopen / renewal never re-announces).
-- Run on STAGING only (fixture ids are the E2E accounts there) via the SQL editor or MCP
-- execute_sql, AFTER the migration.
--
-- Nothing is kept: every case runs in a sub-transaction that is always undone, and the block
-- ends by raising 'PROBE RESULTS', which rolls back the whole statement. That also drops the
-- pg_net webhook requests queued by the test publishes (net.http_request_queue is
-- transactional), so notify-vacancy / notify-test-vacancy are never called. The E2E club is a
-- test account anyway, which notify-vacancy ignores.
--
--   LEGIT   … → OK / BROKEN     must be OK
--   EXPLOIT … → OPEN / CLOSED   must be CLOSED

DO $probe$
DECLARE
  c_club   constant uuid := '38965930-2a53-47bf-85af-a0e9852c257b';  -- clubplayr8 (club)
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- playrplayer93 (player)
  v_opp uuid;
  v_n int;
  v_b boolean;
  v_out text := '';
  v_line text;
BEGIN
  -- ── B1 backfill: every already-published role counts as announced ──
  SELECT count(*) INTO v_n
    FROM opportunities o
    LEFT JOIN opportunity_first_publications f ON f.opportunity_id = o.id
   WHERE (o.status <> 'draft' OR o.published_at IS NOT NULL)
     AND (f.opportunity_id IS NULL OR f.email_claimed_at IS NULL);
  v_out := v_out || E'\n' || format('LEGIT   B1 every published role is marked announced → %s',
    CASE WHEN v_n = 0 THEN 'OK' ELSE 'BROKEN (' || v_n || ' unmarked)' END);

  SELECT count(*) INTO v_n
    FROM opportunities o JOIN opportunity_first_publications f ON f.opportunity_id = o.id
   WHERE o.status = 'draft' AND o.published_at IS NULL;
  v_out := v_out || E'\n' || format('LEGIT   B2 never-published drafts are NOT marked → %s',
    CASE WHEN v_n = 0 THEN 'OK' ELSE 'BROKEN (' || v_n || ')' END);

  -- ── L1 draft → open (first publish) announces; close → reopen does not ──
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status)
    VALUES (c_club, 'player', '[QA probe] first-publish', 'Amsterdam', 'Netherlands', 'draft')
    RETURNING id INTO v_opp;
    UPDATE opportunities SET status = 'open' WHERE id = v_opp;          -- first publish (club, via RLS)
    EXECUTE 'RESET ROLE';

    SELECT count(*) INTO v_n FROM profile_notifications
     WHERE kind = 'opportunity_published' AND source_entity_id = v_opp AND recipient_profile_id = c_player;
    v_out := v_out || E'\n' || format('LEGIT   L1a draft→open sends the in-app notification → %s',
      CASE WHEN v_n = 1 THEN 'OK' ELSE 'BROKEN (' || v_n || ')' END);

    v_b := claim_opportunity_announcement_email(v_opp);
    v_out := v_out || E'\n' || format('LEGIT   L1b first claim wins (email goes out) → %s',
      CASE WHEN v_b THEN 'OK' ELSE 'BROKEN' END);
    v_b := claim_opportunity_announcement_email(v_opp);
    v_out := v_out || E'\n' || format('EXPLOIT E1 webhook re-delivery re-claims → %s',
      CASE WHEN v_b THEN 'OPEN' ELSE 'CLOSED' END);

    -- Player cleared the notification (or it was pruned after 90 days), then the club
    -- closes and reopens the role.
    DELETE FROM profile_notifications WHERE kind = 'opportunity_published' AND source_entity_id = v_opp;
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE opportunities SET status = 'closed' WHERE id = v_opp;
    UPDATE opportunities SET status = 'open'   WHERE id = v_opp;          -- reopen / renewal
    EXECUTE 'RESET ROLE';

    SELECT count(*) INTO v_n FROM profile_notifications
     WHERE kind = 'opportunity_published' AND source_entity_id = v_opp;
    v_out := v_out || E'\n' || format('EXPLOIT E2 closed→open re-sends in-app notifications → %s',
      CASE WHEN v_n = 0 THEN 'CLOSED' ELSE 'OPEN (' || v_n || ')' END);
    v_b := claim_opportunity_announcement_email(v_opp);
    v_out := v_out || E'\n' || format('EXPLOIT E3 closed→open re-claims the email → %s',
      CASE WHEN v_b THEN 'OPEN' ELSE 'CLOSED' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_out := v_out || E'\n' || 'LEGIT   L1 → BROKEN (' || SQLERRM || ')'; END IF;
  END;

  -- ── L2 INSERT directly as open announces ──
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    INSERT INTO opportunities (club_id, opportunity_type, title, location_city, location_country, status)
    VALUES (c_club, 'player', '[QA probe] insert-open', 'Amsterdam', 'Netherlands', 'open')
    RETURNING id INTO v_opp;
    EXECUTE 'RESET ROLE';
    SELECT count(*) INTO v_n FROM profile_notifications
     WHERE kind = 'opportunity_published' AND source_entity_id = v_opp AND recipient_profile_id = c_player;
    v_b := claim_opportunity_announcement_email(v_opp);
    v_out := v_out || E'\n' || format('LEGIT   L2 INSERT-as-open notifies + claims → %s',
      CASE WHEN v_n = 1 AND v_b THEN 'OK' ELSE 'BROKEN (n=' || v_n || ', claim=' || v_b || ')' END);
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_out := v_out || E'\n' || 'LEGIT   L2 → BROKEN (' || SQLERRM || ')'; END IF;
  END;

  -- ── E4 a signed-in user cannot read / write / reset the marker table ──
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    DELETE FROM opportunity_first_publications;
    v_line := 'EXPLOIT E4 club deletes markers to re-announce → OPEN';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'EXPLOIT E4 club deletes markers to re-announce → CLOSED (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE opportunity_first_publications SET email_claimed_at = NULL;
    v_line := 'EXPLOIT E5 club resets email_claimed_at → OPEN';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'EXPLOIT E5 club resets email_claimed_at → CLOSED (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c_club, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM claim_opportunity_announcement_email(gen_random_uuid());
    v_line := 'EXPLOIT E6 signed-in user calls the claim RPC → OPEN';
    RAISE EXCEPTION 'probe_undo';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'probe_undo' THEN v_line := 'EXPLOIT E6 signed-in user calls the claim RPC → CLOSED (' || SQLERRM || ')'; END IF;
    v_out := v_out || E'\n' || v_line;
  END;

  RAISE EXCEPTION 'PROBE RESULTS%', v_out;
END
$probe$;
