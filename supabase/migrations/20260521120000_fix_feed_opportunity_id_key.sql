-- Fix: home-feed "New Opportunity posted" cards routed to
-- /opportunities/undefined.
--
-- The opportunity-posted feed trigger writes the opportunity id into the
-- feed item metadata under the key `vacancy_id` — a leftover from the
-- vacancy → opportunity rename. The client (OpportunityPostedCard) reads
-- `opportunity_id`, so the "Apply Now" CTA navigated to
-- `/opportunities/undefined` and landed on "Opportunity Not Found".
--
-- This migration:
--   1. Redefines generate_opportunity_posted_feed_item() to emit
--      `opportunity_id` in the metadata (everything else unchanged).
--   2. Backfills existing home_feed_items rows, renaming the key.
--
-- `source_type` stays 'vacancy': it is consumed by the author-filter
-- derivation in 20260425010000_home_feed_author_filters.sql and is an
-- internal field, not user-facing — renaming it is out of scope here.

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

    SELECT p.id, p.full_name, p.avatar_url, p.is_test_account, p.role, p.nationality_country_id
    INTO v_club_profile
    FROM profiles p
    WHERE p.id = NEW.club_id;

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

-- Backfill existing feed rows: rename metadata.vacancy_id -> opportunity_id.
-- Idempotent: the WHERE clause matches nothing once already renamed.
UPDATE public.home_feed_items
SET metadata = (metadata - 'vacancy_id') || jsonb_build_object('opportunity_id', metadata -> 'vacancy_id')
WHERE item_type = 'opportunity_posted'
  AND metadata ? 'vacancy_id';
