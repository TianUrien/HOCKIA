-- Close the gaps in sync_profile_to_feed_metadata.
--
-- Feed items SNAPSHOT the author's name + avatar into metadata at creation
-- time, and this trigger is what keeps those snapshots current when a profile
-- changes. It covered only 4 of the 9 item types that carry a profile-keyed
-- avatar, so for the other 5 the snapshot froze forever: change your photo and
-- your older cards keep showing the old one.
--
-- Found while diagnosing a broken avatar on prod (2026-07-30). The stale
-- snapshot also meant a dead URL survived in metadata even after the profile
-- row was repaired — the feed kept serving a 404 image.
--
-- Covered before:  member_joined, milestone_achieved, reference_received
--                  (both requester + referee), opportunity_posted
-- Added here:      media_added, video_added   (uploader_avatar_url/uploader_id)
--                  open_to_play_confirmed     (player_avatar_url/player_id)
--                  club_responded, role_filled(club_avatar_url/club_id)
--
-- NOT covered, deliberately: brand_post/brand_product (brand_logo_url comes
-- from brands.logo_url — owned by sync_brand_to_feed_metadata) and
-- opportunity_posted.world_club_avatar (sourced from world_clubs, not this
-- profile). career_move carries mover_avatar_url but is filtered out of every
-- feed read, so syncing it would be dead work.
--
-- Trigger binding is unchanged: AFTER UPDATE OF full_name, avatar_url.

CREATE OR REPLACE FUNCTION public.sync_profile_to_feed_metadata()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only act when name or avatar actually changed
  IF OLD.full_name IS NOT DISTINCT FROM NEW.full_name
     AND OLD.avatar_url IS NOT DISTINCT FROM NEW.avatar_url THEN
    RETURN NEW;
  END IF;

  -- 1. Update member_joined items (source_id = profile.id)
  UPDATE home_feed_items
  SET metadata = metadata
    || jsonb_build_object('full_name', NEW.full_name)
    || jsonb_build_object('avatar_url', NEW.avatar_url)
  WHERE item_type = 'member_joined'
    AND source_id = NEW.id
    AND deleted_at IS NULL;

  -- 2. Update milestone_achieved items (metadata->>'profile_id' = profile.id)
  UPDATE home_feed_items
  SET metadata = metadata
    || jsonb_build_object('full_name', NEW.full_name)
    || jsonb_build_object('avatar_url', NEW.avatar_url)
  WHERE item_type = 'milestone_achieved'
    AND metadata->>'profile_id' = NEW.id::text
    AND deleted_at IS NULL;

  -- 3. Update reference_received items where this profile is the requester
  UPDATE home_feed_items
  SET metadata = metadata
    || jsonb_build_object('full_name', NEW.full_name)
    || jsonb_build_object('avatar_url', NEW.avatar_url)
  WHERE item_type = 'reference_received'
    AND metadata->>'profile_id' = NEW.id::text
    AND deleted_at IS NULL;

  -- 4. Update reference_received items where this profile is the referee
  UPDATE home_feed_items
  SET metadata = metadata
    || jsonb_build_object('referee_name', NEW.full_name)
    || jsonb_build_object('referee_avatar', NEW.avatar_url)
  WHERE item_type = 'reference_received'
    AND metadata->>'referee_id' = NEW.id::text
    AND deleted_at IS NULL;

  -- 5. Update opportunity_posted items where this profile is the club
  UPDATE home_feed_items
  SET metadata = metadata
    || jsonb_build_object('club_name', NEW.full_name)
    || jsonb_build_object('club_logo', NEW.avatar_url)
  WHERE item_type = 'opportunity_posted'
    AND metadata->>'club_id' = NEW.id::text
    AND deleted_at IS NULL;

  -- 6. NEW — media_added / video_added: this profile is the uploader.
  UPDATE home_feed_items
  SET metadata = metadata
    || jsonb_build_object('uploader_name', NEW.full_name)
    || jsonb_build_object('uploader_avatar_url', NEW.avatar_url)
  WHERE item_type IN ('media_added', 'video_added')
    AND metadata->>'uploader_id' = NEW.id::text
    AND deleted_at IS NULL;

  -- 7. NEW — open_to_play_confirmed: this profile is the player.
  UPDATE home_feed_items
  SET metadata = metadata
    || jsonb_build_object('player_name', NEW.full_name)
    || jsonb_build_object('player_avatar_url', NEW.avatar_url)
  WHERE item_type = 'open_to_play_confirmed'
    AND metadata->>'player_id' = NEW.id::text
    AND deleted_at IS NULL;

  -- 8. NEW — club_responded / role_filled: this profile is the club.
  UPDATE home_feed_items
  SET metadata = metadata
    || jsonb_build_object('club_name', NEW.full_name)
    || jsonb_build_object('club_avatar_url', NEW.avatar_url)
  WHERE item_type IN ('club_responded', 'role_filled')
    AND metadata->>'club_id' = NEW.id::text
    AND deleted_at IS NULL;

  RETURN NEW;
END;
$function$;

-- Backfill: every existing item of the five newly-covered types is re-pointed
-- at its subject's CURRENT name + avatar. Without this the trigger only helps
-- from the next profile edit onward, leaving today's stale snapshots frozen.
UPDATE home_feed_items hfi
SET metadata = hfi.metadata
  || jsonb_build_object('uploader_name', p.full_name)
  || jsonb_build_object('uploader_avatar_url', p.avatar_url)
FROM profiles p
WHERE hfi.item_type IN ('media_added', 'video_added')
  AND hfi.metadata->>'uploader_id' = p.id::text
  AND hfi.deleted_at IS NULL
  AND (hfi.metadata->>'uploader_avatar_url' IS DISTINCT FROM p.avatar_url
       OR hfi.metadata->>'uploader_name' IS DISTINCT FROM p.full_name);

UPDATE home_feed_items hfi
SET metadata = hfi.metadata
  || jsonb_build_object('player_name', p.full_name)
  || jsonb_build_object('player_avatar_url', p.avatar_url)
FROM profiles p
WHERE hfi.item_type = 'open_to_play_confirmed'
  AND hfi.metadata->>'player_id' = p.id::text
  AND hfi.deleted_at IS NULL
  AND (hfi.metadata->>'player_avatar_url' IS DISTINCT FROM p.avatar_url
       OR hfi.metadata->>'player_name' IS DISTINCT FROM p.full_name);

UPDATE home_feed_items hfi
SET metadata = hfi.metadata
  || jsonb_build_object('club_name', p.full_name)
  || jsonb_build_object('club_avatar_url', p.avatar_url)
FROM profiles p
WHERE hfi.item_type IN ('club_responded', 'role_filled')
  AND hfi.metadata->>'club_id' = p.id::text
  AND hfi.deleted_at IS NULL
  AND (hfi.metadata->>'club_avatar_url' IS DISTINCT FROM p.avatar_url
       OR hfi.metadata->>'club_name' IS DISTINCT FROM p.full_name);
