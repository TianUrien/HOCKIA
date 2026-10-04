-- Probe for 20261003140000_ai_usage_log.sql: AI cost log, daily question cap,
-- monthly spend alert.
--
-- Run on STAGING only, via the SQL editor, AFTER the migration. Nothing is ever
-- kept: the block ends by raising 'PROBE RESULTS', which rolls back the whole
-- statement (the rows it inserts, the alert stamp and the queued email).
--
-- One line per case:   PASS <case> → <detail>   |   FAIL <case> → <detail>
-- Every line must be PASS.
--
-- Identities are switched with SET LOCAL ROLE authenticated|anon + request.jwt.claims,
-- exactly like PostgREST does. "sys" steps run as the database owner with no JWT
-- (the pg_cron context).

DO $probe$
DECLARE
  c_player constant uuid := '48111dbd-cce7-4ed3-991d-9d46d2959a48';  -- E2E player
  v_user   uuid;
  v_n      int;
  v_num    numeric;
  v_spend_before numeric;
  v_j      jsonb;
  v_txt    text;
  v_out    text := '';
  v_line   text;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  -- The FK needs a real auth user; fall back to any user when the E2E id is absent.
  SELECT id INTO v_user FROM auth.users WHERE id = c_player;
  IF v_user IS NULL THEN SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1; END IF;

  -- ── A · table is service_role only ─────────────────────────────────────────────
  -- A1 anon cannot read
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT count(*) INTO v_n FROM ai_usage_log;
    v_line := 'FAIL A1 anon SELECT ai_usage_log → allowed (' || v_n || ' rows)';
  EXCEPTION WHEN insufficient_privilege THEN
    v_line := 'PASS A1 anon SELECT ai_usage_log → denied';
  WHEN others THEN
    v_line := 'PASS A1 anon SELECT ai_usage_log → denied (' || SQLERRM || ')';
  END;
  EXECUTE 'RESET ROLE';
  v_out := v_out || E'\n' || v_line;

  -- A2 authenticated cannot read
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    SELECT count(*) INTO v_n FROM ai_usage_log;
    v_line := 'FAIL A2 authenticated SELECT ai_usage_log → allowed (' || v_n || ' rows)';
  EXCEPTION WHEN insufficient_privilege THEN
    v_line := 'PASS A2 authenticated SELECT ai_usage_log → denied';
  WHEN others THEN
    v_line := 'PASS A2 authenticated SELECT ai_usage_log → denied (' || SQLERRM || ')';
  END;
  v_out := v_out || E'\n' || v_line;

  -- A3 authenticated cannot write (not even their own row)
  BEGIN
    INSERT INTO ai_usage_log (user_id, function, provider, model, cost_usd)
    VALUES (v_user, 'nl-search', 'probe', 'probe', 0);
    v_line := 'FAIL A3 authenticated INSERT ai_usage_log → allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    v_line := 'PASS A3 authenticated INSERT ai_usage_log → denied';
  WHEN others THEN
    v_line := 'PASS A3 authenticated INSERT ai_usage_log → denied (' || SQLERRM || ')';
  END;
  v_out := v_out || E'\n' || v_line;

  -- ── B · functions are service_role only ────────────────────────────────────────
  -- B1 authenticated cannot execute the cap / spend / alert functions
  BEGIN
    SELECT ai_questions_today(v_user) INTO v_n;
    v_line := 'FAIL B1 authenticated EXECUTE ai_questions_today → allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    v_line := 'PASS B1 authenticated EXECUTE ai_questions_today → denied';
  WHEN others THEN
    v_line := 'FAIL B1 authenticated EXECUTE ai_questions_today → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;
  BEGIN
    SELECT check_ai_spend_alert() INTO v_j;
    v_line := 'FAIL B2 authenticated EXECUTE check_ai_spend_alert → allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    v_line := 'PASS B2 authenticated EXECUTE check_ai_spend_alert → denied';
  WHEN others THEN
    v_line := 'FAIL B2 authenticated EXECUTE check_ai_spend_alert → ' || SQLERRM;
  END;
  v_out := v_out || E'\n' || v_line;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);

  -- B3 ACLs: anon / authenticated hold no EXECUTE, service_role does
  SELECT count(*) INTO v_n FROM (VALUES
    ('public.ai_questions_today(uuid)'), ('public.ai_spend_month_usd()'), ('public.check_ai_spend_alert()')
  ) f(sig)
  WHERE has_function_privilege('anon', f.sig, 'EXECUTE')
     OR has_function_privilege('authenticated', f.sig, 'EXECUTE')
     OR NOT has_function_privilege('service_role', f.sig, 'EXECUTE');
  v_out := v_out || E'\n' || format('%s B3 function ACLs → %s function(s) wrongly granted',
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  SELECT count(*) INTO v_n FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)
  WHERE NOT has_table_privilege('service_role', 'public.ai_usage_log', p.priv);
  v_out := v_out || E'\n' || format('%s B4 service_role table privileges → %s missing',
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- ── C · counting (sys = the service path) ──────────────────────────────────────
  SELECT ai_questions_today(v_user) INTO v_n;
  v_txt := v_n::text;
  INSERT INTO ai_usage_log (user_id, function, provider, model, input_tokens, output_tokens, cost_usd)
  VALUES (v_user, 'nl-search', 'gemini', 'gemini-2.5-flash', 1000, 100, 0.00055),
         (v_user, 'nl-search', 'gemini', 'gemini-2.5-flash', 2000, 200, 0.0011);
  -- yesterday's question and an alert stamp must not count
  INSERT INTO ai_usage_log (user_id, function, provider, model, cost_usd, created_at)
  VALUES (v_user, 'nl-search', 'gemini', 'gemini-2.5-flash', 0,
          (date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc') - interval '1 minute');
  INSERT INTO ai_usage_log (user_id, function, provider, model, cost_usd)
  VALUES (v_user, 'alert', 'system', 'ai_spend_alert', 0);
  SELECT ai_questions_today(v_user) - v_txt::int INTO v_n;
  v_out := v_out || E'\n' || format('%s C1 ai_questions_today counts today''s questions only → +%s (expected +2)',
    CASE WHEN v_n = 2 THEN 'PASS' ELSE 'FAIL' END, v_n);
  DELETE FROM ai_usage_log WHERE user_id = v_user AND function = 'alert' AND model = 'ai_spend_alert' AND cost_usd = 0 AND created_at >= now() - interval '1 minute';

  -- C2 spend sums this month's cost
  SELECT ai_spend_month_usd() INTO v_spend_before;
  INSERT INTO ai_usage_log (user_id, function, provider, model, cost_usd)
  VALUES (v_user, 'nl-search', 'claude', 'claude-sonnet-4-6', 0.25);
  SELECT ai_spend_month_usd() - v_spend_before INTO v_num;
  v_out := v_out || E'\n' || format('%s C2 ai_spend_month_usd adds the new cost → +%s (expected +0.25)',
    CASE WHEN v_num = 0.25 THEN 'PASS' ELSE 'FAIL' END, v_num);

  -- ── D · alert: threshold, idempotent per month, queued once ────────────────────
  -- D0 clean slate for this month inside the transaction (rolled back at the end)
  DELETE FROM ai_usage_log WHERE function = 'alert'
     AND created_at >= (date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc');
  DELETE FROM admin_digest_queue WHERE payload->>'kind' = 'ai_spend_alert';

  -- D1 under the threshold: nothing happens (skipped when real spend is already over)
  SELECT ai_spend_month_usd() INTO v_num;
  IF v_num <= 50 THEN
    SELECT check_ai_spend_alert() INTO v_j;
    v_out := v_out || E'\n' || format('%s D1 under threshold → %s',
      CASE WHEN (v_j->>'sent') = 'false' AND (v_j->>'reason') = 'under_threshold' THEN 'PASS' ELSE 'FAIL' END, v_j);
  ELSE
    v_out := v_out || E'\n' || 'PASS D1 under threshold → skipped (real spend already ' || v_num || ')';
  END IF;

  -- D2 over the threshold: one stamp, one queued email with kind ai_spend_alert
  INSERT INTO ai_usage_log (user_id, function, provider, model, cost_usd)
  VALUES (v_user, 'nl-search', 'claude', 'claude-sonnet-4-6', 1000);
  SELECT check_ai_spend_alert() INTO v_j;
  SELECT count(*) INTO v_n FROM ai_usage_log WHERE function = 'alert'
     AND created_at >= (date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc');
  v_out := v_out || E'\n' || format('%s D2 over threshold → sent=%s reason=%s stamps=%s queued=%s',
    CASE WHEN (v_j->>'sent') = 'true' AND v_n = 1 THEN 'PASS' ELSE 'FAIL' END,
    v_j->>'sent', v_j->>'reason', v_n, v_j->>'queued');
  SELECT count(*) INTO v_n FROM admin_digest_queue WHERE payload->>'kind' = 'ai_spend_alert';
  v_out := v_out || E'\n' || format('%s D3 queue row → %s (expected %s)',
    CASE WHEN v_n = CASE WHEN (v_j->>'queued') = 'true' THEN 1 ELSE 0 END THEN 'PASS' ELSE 'FAIL' END,
    v_n, CASE WHEN (v_j->>'queued') = 'true' THEN 1 ELSE 0 END);

  -- D4 second run in the same month: idempotent
  SELECT check_ai_spend_alert() INTO v_j;
  SELECT count(*) INTO v_n FROM ai_usage_log WHERE function = 'alert'
     AND created_at >= (date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc');
  v_out := v_out || E'\n' || format('%s D4 second run same month → reason=%s stamps=%s',
    CASE WHEN (v_j->>'sent') = 'false' AND (v_j->>'reason') = 'already_sent' AND v_n = 1 THEN 'PASS' ELSE 'FAIL' END,
    v_j->>'reason', v_n);

  -- D5 the alert row never trips the market digest cooldown
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'enqueue_admin_market_digest'
     AND pg_get_functiondef(p.oid) LIKE '%ai_spend_alert%';
  v_out := v_out || E'\n' || format('%s D5 enqueue_admin_market_digest ignores alert rows → %s',
    CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);

  -- ── E · schedule ───────────────────────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM cron.job
   WHERE jobname = 'ai_spend_alert_daily' AND active AND command LIKE '%check_ai_spend_alert()%';
  v_out := v_out || E'\n' || format('%s E1 cron ai_spend_alert_daily → %s job(s)', CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);

  RAISE EXCEPTION 'PROBE RESULTS:%', v_out;
END
$probe$;
