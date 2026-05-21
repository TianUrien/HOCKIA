-- Restore world-club / publisher-role enrichment on opportunity-posted
-- feed items.
--
-- Background: 202602221800_opportunity_world_club_linking.sql added
-- `publisher_role`, `world_club_name` and `world_club_avatar` to the
-- opportunity-posted feed metadata (dual coach + club identity on the
-- card). 20260425010000_home_feed_author_filters.sql then redefined
-- every feed trigger from a stale snapshot and silently dropped those
-- three fields — its header intended a "purely additive" change, so
-- this was an unintentional regression. Live since ~2026-04-25.
--
-- Impact: OpportunityPostedCard routes the "by …" link via
-- `publisher_role`; with it missing, coach-published opportunities
-- linked to /clubs/id/<coachId> (the coach's id on a club route) →
-- "Not Found". Coach + world-club opportunities also lost the
-- "Official" world-club line.
--
-- NOTE — the Feb 2026 version had a latent bug: it read
-- `v_world_club.club_name` from a RECORD that was only SELECTed INTO
-- when `world_club_id IS NOT NULL`. Publishing a non-world-club
-- opportunity therefore hit "record is not assigned yet" and failed.
-- This version uses plain scalar variables (NULL by default, always
-- assigned), so that error cannot recur.
--
-- Builds on 20260521120000 (opportunity_id key fix); source_type stays
-- 'vacancy' (consumed by the author-filter derivation; internal).

CREATE OR REPLACE FUNCTION public.generate_opportunity_posted_feed_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_profile RECORD;
  v_world_club_name TEXT;
  v_world_club_avatar TEXT;
BEGIN
  IF NEW.status = 'open'
     AND (OLD.status IS NULL OR OLD.status::text != 'open') THEN

    SELECT p.id, p.full_name, p.avatar_url, p.is_test_account, p.role, p.nationality_country_id
    INTO v_club_profile
    FROM profiles p
    WHERE p.id = NEW.club_id;

    -- World club is optional. Scalar variables stay NULL when the
    -- opportunity is not linked to one — no unassigned-RECORD hazard.
    IF NEW.world_club_id IS NOT NULL THEN
      SELECT wc.club_name, wc.avatar_url
      INTO v_world_club_name, v_world_club_avatar
      FROM world_clubs wc
      WHERE wc.id = NEW.world_club_id;
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
        'start_date', NEW.start_date,
        'publisher_role', v_club_profile.role,
        'world_club_name', v_world_club_name,
        'world_club_avatar', v_world_club_avatar
      )
    )
    ON CONFLICT (item_type, source_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill existing feed rows with publisher_role + world-club fields.
-- LEFT JOIN on world_clubs: non-world-club opportunities get JSON null,
-- which the client treats as "no world club". Idempotent.
UPDATE public.home_feed_items hfi
SET metadata = hfi.metadata
  || jsonb_build_object('publisher_role', p.role)
  || jsonb_build_object('world_club_name', wc.club_name)
  || jsonb_build_object('world_club_avatar', wc.avatar_url)
FROM public.opportunities o
JOIN public.profiles p ON p.id = o.club_id
LEFT JOIN public.world_clubs wc ON wc.id = o.world_club_id
WHERE hfi.item_type = 'opportunity_posted'
  AND hfi.source_id = o.id
  AND hfi.deleted_at IS NULL;
