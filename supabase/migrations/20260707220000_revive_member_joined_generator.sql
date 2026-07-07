-- P4 Phase 0 — revive the member_joined event generator (founder decision
-- 2026-07-07): events ACCUMULATE SILENTLY from now (solving the new-Home
-- backfill for free) while the CURRENT feed keeps excluding item_type =
-- 'member_joined' (202603130200 — that read-side exclusion is deliberately
-- NOT touched; the events only become visible when the new Home ships its
-- compact one-line format).
--
-- Root cause of the March-12 death (verified in the home-redesign brief):
-- the trigger was UPDATE-only, firing on the onboarding_completed
-- false→true transition — and the signup flow can also create rows already
-- onboarded. It was additionally left DISABLED by 202603130200. Fix: fire on
-- INSERT OR UPDATE with transition logic covering both entry paths;
-- ON CONFLICT (item_type, source_id) keeps it once-only per profile.
--
-- Applies the standing hidden-predicate invariant (CLAUDE.md): no feed item
-- is ever born for a banned/frozen profile.
CREATE OR REPLACE FUNCTION public.generate_member_joined_feed_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.onboarding_completed IS TRUE
     AND (TG_OP = 'INSERT' OR OLD.onboarding_completed IS DISTINCT FROM TRUE)
     AND NEW.role IN ('player', 'coach', 'club')
     AND NOT public.profile_is_hidden(NEW.is_blocked, NEW.frozen_minor_at) THEN

    INSERT INTO home_feed_items (
      item_type, source_id, source_type, is_test_account,
      author_profile_id, author_role, author_country_id,
      metadata
    )
    VALUES (
      'member_joined',
      NEW.id,
      'profile',
      COALESCE(NEW.is_test_account, false),
      NEW.id,
      NEW.role,
      NEW.nationality_country_id,
      jsonb_build_object(
        'profile_id', NEW.id,
        'full_name', NEW.full_name,
        'role', NEW.role,
        'avatar_url', NEW.avatar_url,
        'nationality_country_id', NEW.nationality_country_id,
        'base_location', NEW.base_location,
        'position', NEW.position,
        'current_club', NEW.current_club
      )
    )
    ON CONFLICT (item_type, source_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_member_joined_feed ON public.profiles;
CREATE TRIGGER trigger_member_joined_feed
  AFTER INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.generate_member_joined_feed_item();
-- (CREATE TRIGGER is enabled by default — the 202603130200 DISABLE dies here.)
