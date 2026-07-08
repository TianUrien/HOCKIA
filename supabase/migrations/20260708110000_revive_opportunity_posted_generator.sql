-- P4 Phase 0 — revive the opportunity_posted feed generator (Home redesign).
--
-- Same UPDATE-only trigger bug as member_joined (fixed in 20260707220000):
-- trigger_opportunity_posted_feed fires AFTER UPDATE only (202602091100), so
-- it catches a draft→open transition — but a publish path that INSERTs a row
-- already at status='open' bypasses it (0 feed items from 9 opportunities
-- since ~May 19, per the redesign brief). Fix: fire on INSERT OR UPDATE with
-- the same once-only guard, so both entry paths emit exactly once.
--
-- Feed-only (Master Order P4 guardrail): this writes a home_feed_items row
-- and nothing else — no push, no email. And per the standing hidden-predicate
-- invariant (CLAUDE.md), a banned/frozen publisher never emits a feed item.
--
-- Like member_joined, events accumulate SILENTLY from now: the current feed's
-- read path is unchanged, and these become visible only when the new Home
-- ships. Today's feed is untouched.
CREATE OR REPLACE FUNCTION public.generate_opportunity_posted_feed_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_profile RECORD;
BEGIN
  IF NEW.status = 'open'
     AND (OLD.status IS NULL OR OLD.status::text != 'open') THEN

    SELECT p.id, p.full_name, p.avatar_url, p.is_test_account, p.role,
           p.nationality_country_id, p.is_blocked, p.frozen_minor_at
    INTO v_club_profile
    FROM profiles p
    WHERE p.id = NEW.club_id;

    -- Hidden (banned/frozen) publisher → no feed item.
    IF v_club_profile.id IS NULL
       OR public.profile_is_hidden(v_club_profile.is_blocked, v_club_profile.frozen_minor_at) THEN
      RETURN NEW;
    END IF;

    INSERT INTO home_feed_items (
      item_type, source_id, source_type, is_test_account,
      author_profile_id, author_role, author_country_id,
      metadata
    )
    VALUES (
      'opportunity_posted',
      NEW.id,
      'vacancy',
      COALESCE(v_club_profile.is_test_account, false),
      v_club_profile.id,
      v_club_profile.role,
      v_club_profile.nationality_country_id,
      jsonb_build_object(
        'opportunity_id', NEW.id,
        'title', NEW.title,
        'opportunity_type', NEW.opportunity_type,
        'position', NEW.position,
        'gender', NEW.gender,
        'location_city', NEW.location_city,
        'location_country', NEW.location_country,
        'club_id', NEW.club_id,
        'club_name', v_club_profile.full_name,
        'club_logo', v_club_profile.avatar_url,
        'priority', NEW.priority,
        'start_date', NEW.start_date
      )
    )
    ON CONFLICT (item_type, source_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Fire on INSERT too (the bypass path), keeping the existing UPDATE coverage.
DROP TRIGGER IF EXISTS trigger_opportunity_posted_feed ON public.opportunities;
CREATE TRIGGER trigger_opportunity_posted_feed
  AFTER INSERT OR UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.generate_opportunity_posted_feed_item();
