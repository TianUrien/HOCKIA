-- Community preview / swipe deck: the first photos of many members in ONE call.
--
-- The redesigned Community preview shows up to 5 photos per member and the
-- swipe deck prefetches the next members, so fetching each member's gallery
-- separately would be one request per card. PostgREST can't limit per group,
-- hence this function.
--
-- Same order the profile screens use:
--   players / coaches / umpires / brands: gallery_photos, order_index DESC, created_at DESC
--   clubs: club_media, is_featured DESC, order_index ASC, created_at DESC
--
-- SECURITY INVOKER: the tables' own RLS applies, so hidden profiles' photos stay
-- hidden ("Public can view ... of visible profiles" → owner_profile_is_visible).
-- At most 60 profiles and 5 photos each per call. Additive: nothing calls it yet
-- in shipped clients.

CREATE OR REPLACE FUNCTION public.get_member_photos(p_profile_ids uuid[], p_per_member integer DEFAULT 5)
RETURNS TABLE (profile_id uuid, url text, ord integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH ids AS (
    SELECT DISTINCT unnest(p_profile_ids[1:60]) AS id
  ),
  lim AS (
    SELECT LEAST(GREATEST(COALESCE(p_per_member, 5), 1), 5) AS n
  ),
  g AS (
    SELECT gp.user_id AS profile_id, gp.photo_url AS url,
           row_number() OVER (PARTITION BY gp.user_id
                              ORDER BY gp.order_index DESC NULLS LAST, gp.created_at DESC) AS rn
      FROM public.gallery_photos gp
      JOIN ids ON ids.id = gp.user_id
     WHERE gp.photo_url IS NOT NULL
  ),
  c AS (
    SELECT cm.club_id AS profile_id, cm.file_url AS url,
           row_number() OVER (PARTITION BY cm.club_id
                              ORDER BY cm.is_featured DESC NULLS LAST, cm.order_index ASC NULLS LAST, cm.created_at DESC) AS rn
      FROM public.club_media cm
      JOIN ids ON ids.id = cm.club_id
     WHERE cm.file_url IS NOT NULL
  )
  SELECT x.profile_id, x.url, x.rn::integer AS ord
    FROM (SELECT * FROM g UNION ALL SELECT * FROM c) x, lim
   WHERE x.rn <= lim.n
   ORDER BY x.profile_id, x.rn;
$function$;

REVOKE ALL ON FUNCTION public.get_member_photos(uuid[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_member_photos(uuid[], integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_member_photos(uuid[], integer) IS
  'First photos (max 5) of up to 60 members in one call, in profile-screen order: gallery_photos for people, club_media for clubs. SECURITY INVOKER so the tables'' RLS (visible profiles only) applies.';
