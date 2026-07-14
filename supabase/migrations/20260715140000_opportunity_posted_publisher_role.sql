-- M8 — opportunity_posted feed card: emit publisher_role + world-club fields.
--
-- The card (OpportunityPostedCard) branches on item.publisher_role,
-- item.world_club_name and item.world_club_avatar to (a) route to the correct
-- profile (coach → /players/id, else → /clubs/id) and (b) show a coach's world
-- club. get_home_feed returns each item as `hfi.metadata || {base fields}`,
-- passing the generator's metadata through VERBATIM — but the generator never
-- emitted these three keys, so publisher_role was always undefined and every
-- coach-published opportunity card misrouted to /clubs/id/<coach-profile-id>.
-- (Prod today: 1 live coach card affected.)
--
-- Fix: (1) generator emits publisher_role (= the publisher's profile role) plus
-- the publisher's linked world-club name/avatar; (2) backfill existing rows'
-- metadata from the home_feed_items.author_role column so already-published
-- cards route correctly too. No get_home_feed and no client change needed
-- (metadata passthrough), so this is deploy-independent of the app binary.

CREATE OR REPLACE FUNCTION public.generate_opportunity_posted_feed_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_club_profile RECORD;
BEGIN
  IF NEW.status = 'open'
     AND (OLD.status IS NULL OR OLD.status::text != 'open') THEN

    -- LEFT JOIN the publisher's linked world club so a coach card can show it
    -- (wc is NULL when the publisher has no linked world club — the card
    -- degrades to the generic profile-name/avatar branch, still correctly
    -- routed by publisher_role).
    SELECT p.id, p.full_name, p.avatar_url, p.is_test_account, p.role,
           p.nationality_country_id, p.is_blocked, p.frozen_minor_at,
           wc.club_name  AS world_club_name,
           wc.avatar_url AS world_club_avatar
    INTO v_club_profile
    FROM profiles p
    LEFT JOIN world_clubs wc ON wc.id = p.current_world_club_id
    WHERE p.id = NEW.club_id;

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
      'opportunity_posted', NEW.id, 'vacancy',
      COALESCE(v_club_profile.is_test_account, false),
      v_club_profile.id, v_club_profile.role, v_club_profile.nationality_country_id,
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
        'level_sought', NEW.level_sought,
        'position_required', NEW.position_required,
        'eu_passport_required', NEW.eu_passport_required,
        -- Card routing + coach world-club branding (metadata passthrough).
        'publisher_role', v_club_profile.role,
        'world_club_name', v_club_profile.world_club_name,
        'world_club_avatar', v_club_profile.world_club_avatar
      )
    )
    ON CONFLICT (item_type, source_id) DO NOTHING;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a feed-gen failure roll back the opportunity publish.
  PERFORM public._log_feed_gen_failure('generate_opportunity_posted_feed_item', SQLSTATE, SQLERRM,
    jsonb_build_object('opportunity_id', NEW.id, 'status', NEW.status));
  RETURN NEW;
END;
$function$;

-- Backfill existing opportunity_posted rows missing publisher_role. author_role
-- is stored as a column on home_feed_items, so it's the source of truth for the
-- publisher's role; world-club fields come from the publisher's linked club.
UPDATE home_feed_items hfi
SET metadata = hfi.metadata || jsonb_build_object(
      'publisher_role', hfi.author_role,
      'world_club_name', wc.club_name,
      'world_club_avatar', wc.avatar_url
    )
FROM profiles p
LEFT JOIN world_clubs wc ON wc.id = p.current_world_club_id
WHERE hfi.item_type = 'opportunity_posted'
  AND p.id = hfi.author_profile_id
  AND NOT (hfi.metadata ? 'publisher_role');
