-- P4 Phase 0 — two post-audit follow-ups (staging only; prod untouched).
--
-- FOLLOW-UP 1 — get_home_feed_new_count list/count parity.
--   get_home_feed (the LIST) fences the home_feed_items arm on BOTH a hidden
--   author (profile_is_hidden) and a viewer block (user_blocks). But
--   get_home_feed_new_count (the "N new" banner COUNT) applies NEITHER on its
--   home_feed_items arm — so the banner can count a hidden/blocked author's
--   item that the list then hides → a count>list mismatch. This is a
--   PRE-EXISTING gap affecting today's counted types (opportunity_posted,
--   milestone_achieved, reference_received, brand_post, brand_product) and
--   would also hit the Phase-0 types the moment the Pulse surfaces them.
--   Fix: add the same two fences to the count's home_feed_items arm, mirroring
--   the list. (The count's user_posts arm already has the user_blocks fence.)
--   Self-splice so the live body isn't transcribed; guard that it applied.
--
-- FOLLOW-UP 2 — verify (and self-heal) the open_to_play aging cron.
--   20260708160000 scheduled expire_stale_open_to_play_cards, but cron.job is
--   not enumerable via REST/pg_dump, so scheduling was only inferred from the
--   absence of a failure NOTICE. This block reads cron.job directly, re-schedules
--   if missing, and RAISEs a NOTICE with the definitive state.

-- ────────────────────────────────────────────────────────────────────
-- 1. Add hidden-author + user-block fences to get_home_feed_new_count
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.get_home_feed_new_count(timestamp with time zone)'::regprocedure)
    INTO v_def;

  v_new := replace(
    v_def,
    '(v_is_test OR is_test_account = false)',
    '(v_is_test OR is_test_account = false)'
    || ' AND NOT EXISTS (SELECT 1 FROM public.profiles hp'
    || ' WHERE hp.id = home_feed_items.author_profile_id'
    || ' AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at))'
    || ' AND NOT EXISTS (SELECT 1 FROM public.user_blocks ub'
    || ' WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = home_feed_items.author_profile_id)'
    || ' OR (ub.blocker_id = home_feed_items.author_profile_id AND ub.blocked_id = v_user_id))'
  );

  IF v_new = v_def OR position('profile_is_hidden' in v_new) = 0 THEN
    RAISE EXCEPTION 'get_home_feed_new_count fence not applied (anchor not found)';
  END IF;

  EXECUTE v_new;
  RAISE NOTICE 'FENCE-CHECK: get_home_feed_new_count now fences hidden + blocked authors on the home_feed_items arm';
END $$;

-- ────────────────────────────────────────────────────────────────────
-- 2. Definitively verify + self-heal the aging cron
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_sched text;
BEGIN
  SELECT schedule INTO v_sched FROM cron.job WHERE jobname = 'expire_stale_open_to_play_cards';
  IF v_sched IS NULL THEN
    PERFORM cron.schedule('expire_stale_open_to_play_cards', '15 5 * * *',
      $cron$SELECT public.expire_stale_open_to_play_cards();$cron$);
    RAISE NOTICE 'CRON-CHECK: was NOT scheduled -> re-scheduled now (15 5 * * *)';
  ELSE
    RAISE NOTICE 'CRON-CHECK: scheduled OK (schedule=%)', v_sched;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'CRON-CHECK: cannot read cron.job (insufficient privilege) — verify in dashboard';
  WHEN undefined_table THEN
    RAISE NOTICE 'CRON-CHECK: cron.job absent (pg_cron unavailable)';
END $$;
