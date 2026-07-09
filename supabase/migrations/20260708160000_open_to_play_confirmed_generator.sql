-- P4 Phase 0 — open_to_play_confirmed / "Still open to play" feed generator.
-- The SIXTH and LAST Phase-0 sibling. Writes public.home_feed_items.
--
-- ⚠ HIGHEST-UX-RISK generator: a prior weekly check-in bug (a467f06 /
-- 20260706120000) STACKED cards — the "Still recruiting?" pulse accumulated one
-- ACTIVE card per week per user (1,375 across 194 users; Tian's coach feed had
-- 4+). That bug was in user_pulse_items (the private dashboard PROMPT system),
-- which had NO unique key and only a creation-cap that never retired the prior
-- card. This generator is a DIFFERENT system (the community feed) and is
-- STRUCTURALLY immune: exactly ONE row per player via
--   source_id = md5(player_id || '|open_to_play')  +  UNIQUE(item_type, source_id)
-- so every confirmation DO-UPDATEs the ONE row — a second live card is
-- impossible (a soft-deleted card still holds the key and is resurrected in
-- place, never duplicated). This is "collapse onto one row", stronger than the
-- pulse fix's "dismiss the old ones".
--
-- THE MEANINGFUL SIGNAL (grounded in code): the only intentional confirmation
-- is confirm_availability() (20260506200000) — the "Yes, still open" tap on the
-- weekly check-in — which is the SOLE writer of profiles.availability_confirmed_at.
-- Toggling open_to_play on/editing/onboarding writes ONLY the boolean.
--
-- THREE intentional event shapes (AFTER UPDATE on profiles, UPDATE-only so the
-- onboarding open_to_play=true default can NEVER flood the feed):
--   (A) explicit re-confirm  → availability_confirmed_at bumped, open_to_play true (player)
--   (B) deliberate re-open   → open_to_play false→true POST-onboarding (player)
--   (C) closes availability  → open_to_play true→false → SOFT-RETRACT the card (ANY role,
--       so a player→coach role change that nulls open_to_play also retracts)
--
-- Freshness is EVENT-TIME (now()), never the stored availability_confirmed_at
-- (which is stale on a toggle-on → would bury the card and get it reaped). A
-- 20h debounce stops an unthrottled confirm_availability() from bumping the one
-- card to the top repeatedly. A daily cron expires a card 60d after its last
-- affirmation (parity with the client AVAILABILITY_DECAY_DAYS=60) so an old
-- confirmation never lingers "as new" — get_home_feed has no recency window.
--
-- Guardrails: feed-only (no push/email, no user_pulse_items); hidden-fenced;
-- silent-accumulate (excluded from today's get_home_feed + new_count);
-- resilient+observable (_log_feed_gen_failure); no backfill.

-- 1. Whitelist the new item_type (source_type 'profile' already allowed).
ALTER TABLE public.home_feed_items DROP CONSTRAINT IF EXISTS home_feed_items_item_type_check;
ALTER TABLE public.home_feed_items ADD CONSTRAINT home_feed_items_item_type_check
  CHECK (item_type = ANY (ARRAY[
    'member_joined','opportunity_posted','milestone_achieved','reference_received',
    'brand_post','brand_product','career_move','club_responded','media_added',
    'video_added','open_to_play_confirmed'
  ]::text[]));

-- 2. Generator.
CREATE OR REPLACE FUNCTION public.generate_open_to_play_confirmed_feed_item()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_source_id uuid := md5(NEW.id::text || '|open_to_play')::uuid;
  v_event_ts  timestamptz := timezone('utc', now());   -- freshness = the moment of THIS signal
BEGIN
  -- (C) Retraction: player closed availability (or role change nulled it) →
  -- soft-delete their single card. Fires for ANY role (no player gate here).
  IF NEW.open_to_play IS DISTINCT FROM TRUE THEN
    UPDATE public.home_feed_items
       SET deleted_at = v_event_ts
     WHERE item_type = 'open_to_play_confirmed'
       AND source_id = v_source_id
       AND deleted_at IS NULL;
    RETURN NEW;
  END IF;

  -- (A/B) Still open → emit/refresh the ONE card, but never for a hidden player.
  IF public.profile_is_hidden(NEW.is_blocked, NEW.frozen_minor_at) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.home_feed_items (
    item_type, source_id, source_type, is_test_account,
    author_profile_id, author_role, author_country_id, metadata, created_at)
  VALUES (
    'open_to_play_confirmed', v_source_id, 'profile',
    COALESCE(NEW.is_test_account, false),
    NEW.id, NEW.role, NEW.nationality_country_id,
    jsonb_build_object(
      'player_id', NEW.id,
      'player_name', NEW.full_name,
      'player_role', NEW.role,
      'player_avatar_url', NEW.avatar_url,
      'country_id', NEW.nationality_country_id,
      'position', NEW.position,
      'playing_category', NEW.playing_category,
      'available_from', NEW.available_from,
      'open_to_opportunities', COALESCE(NEW.open_to_opportunities, false),
      'confirmed_at', v_event_ts,
      'first_confirmed_at', v_event_ts),
    v_event_ts)
  ON CONFLICT (item_type, source_id) DO UPDATE SET
    -- Refresh display fields; first_confirmed_at is preserved (not in this merge).
    metadata = public.home_feed_items.metadata || jsonb_build_object(
                 'player_name', NEW.full_name,
                 'player_role', NEW.role,
                 'player_avatar_url', NEW.avatar_url,
                 'country_id', NEW.nationality_country_id,
                 'position', NEW.position,
                 'playing_category', NEW.playing_category,
                 'available_from', NEW.available_from,
                 'open_to_opportunities', COALESCE(NEW.open_to_opportunities, false),
                 'confirmed_at', v_event_ts),
    -- Debounce the bump-to-top: re-date only on a re-open (was retracted) or
    -- after 20h — so an unthrottled re-confirm can't repeatedly float the card.
    created_at = CASE
                   WHEN public.home_feed_items.deleted_at IS NOT NULL
                     OR v_event_ts > public.home_feed_items.created_at + INTERVAL '20 hours'
                   THEN v_event_ts
                   ELSE public.home_feed_items.created_at
                 END,
    deleted_at = NULL,                       -- un-retract on re-open
    is_test_account = EXCLUDED.is_test_account;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_feed_gen_failure('generate_open_to_play_confirmed_feed_item',
    SQLSTATE, SQLERRM, jsonb_build_object('player_id', NEW.id,
      'open_to_play', NEW.open_to_play,
      'availability_confirmed_at', NEW.availability_confirmed_at));
  RETURN NEW;
END;
$$;

-- 3. Trigger: UPDATE-only. WHEN admits exactly the three intentional shapes —
--    retraction for ANY role, emit/refresh for players only.
DROP TRIGGER IF EXISTS trigger_open_to_play_confirmed_feed ON public.profiles;
CREATE TRIGGER trigger_open_to_play_confirmed_feed
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (
    -- (C) closed availability (any role) → retract
    (OLD.open_to_play IS TRUE AND NEW.open_to_play IS DISTINCT FROM TRUE)
    OR
    -- (A/B) player, currently open, via explicit re-confirm OR deliberate re-open
    (NEW.role = 'player' AND NEW.open_to_play IS TRUE AND (
        (NEW.availability_confirmed_at IS DISTINCT FROM OLD.availability_confirmed_at
          AND NEW.availability_confirmed_at IS NOT NULL)
        OR (OLD.open_to_play IS DISTINCT FROM TRUE AND OLD.onboarding_completed IS TRUE)
    ))
  )
  EXECUTE FUNCTION public.generate_open_to_play_confirmed_feed_item();

-- 4. Daily aging cron: expire a card 60d after its last affirmation so a stale
--    confirmation never reads as "new" (get_home_feed has no recency window).
CREATE OR REPLACE FUNCTION public.expire_stale_open_to_play_cards()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_n INTEGER;
BEGIN
  UPDATE public.home_feed_items
     SET deleted_at = timezone('utc', now())
   WHERE item_type = 'open_to_play_confirmed'
     AND deleted_at IS NULL
     AND created_at < timezone('utc', now()) - INTERVAL '60 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.expire_stale_open_to_play_cards() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('expire_stale_open_to_play_cards');
EXCEPTION WHEN OTHERS THEN NULL;  -- not previously scheduled
END $$;
DO $$
BEGIN
  PERFORM cron.schedule(
    'expire_stale_open_to_play_cards',
    '15 5 * * *',
    $cron$SELECT public.expire_stale_open_to_play_cards();$cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule skipped (%): configure expire_stale_open_to_play_cards manually', SQLERRM;
END $$;

-- 5. Silent accumulation: exclude 'open_to_play_confirmed' from today's feed.
DO $$
DECLARE r RECORD; v_def text; v_new text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('get_home_feed', 'get_home_feed_new_count')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def,
      'NOT IN (''member_joined'', ''career_move'', ''club_responded'', ''media_added'', ''video_added'')',
      'NOT IN (''member_joined'', ''career_move'', ''club_responded'', ''media_added'', ''video_added'', ''open_to_play_confirmed'')');
    IF v_new = v_def OR position('open_to_play_confirmed' in v_new) = 0 THEN
      RAISE EXCEPTION 'open_to_play_confirmed exclusion not applied to %()', r.proname;
    END IF;
    EXECUTE v_new;
  END LOOP;
END $$;
