-- Home redesign Phase 1 — surface role_filled into the live Home feed.
--
-- Phase 0 (20260711130000) shipped the role_filled generator SILENT: rows
-- accumulate but both read fns exclude the type, "until the market-moves
-- module surfaces it". The Pulse "Happening now" module + the RoleFilledCard
-- feed card ship in this client build — this migration is that surfacing.
--
-- Exact reverse of the Phase-0 splice: the live exclusion reads
--   item_type NOT IN ('member_joined', 'role_filled', 'career_move')
-- and becomes
--   item_type NOT IN ('member_joined', 'career_move')
-- in BOTH get_home_feed and get_home_feed_new_count (the count must never
-- disagree with the list). member_joined and career_move stay excluded for
-- their original reasons (removed-from-feed / double-cards with user_post
-- transfer announcements).
--
-- Old clients: HomeFeedItemCard drops unknown item types gracefully (one
-- Sentry warning per session), so surfacing a new type is not a breaking
-- change for pinned native bundles.
DO $$
DECLARE r RECORD; v_def text; v_new text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('get_home_feed', 'get_home_feed_new_count')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, $o$'member_joined', 'role_filled'$o$, $o$'member_joined'$o$);
    IF v_new = v_def OR position('role_filled' in v_new) > 0 THEN
      RAISE EXCEPTION 'surface-role_filled not applied to %() (anchor missing or type still excluded)', r.proname;
    END IF;
    EXECUTE v_new;
  END LOOP;
END $$;
