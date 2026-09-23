-- Figma DEV NOTE · Club & league, DATA FIX 1: Kilkenny Hockey Club was linked
-- through the admin force-claim on 2026-07-17, which wrote only the world_clubs
-- side (is_claimed / claimed_profile_id). The self-service path
-- (claim_world_club) also writes the profile side, and compute_club_fit reads
-- profiles.current_world_club_id — so Kilkenny's level component scored 0 for
-- every applicant. The admin client now writes both sides (adminApi
-- forceClaimWorldClub); this repairs the one existing row.
--
-- Generic and idempotent: any claimed world club whose claiming profile still
-- has no current_world_club_id gets the same link claim_world_club would have
-- written. On production this is exactly one row (Kilkenny); on staging none.
-- A handful of rows at most, so the profiles updated_at trigger is fine here.
UPDATE public.profiles p
   SET current_world_club_id   = wc.id,
       mens_league_id          = wc.men_league_id,
       womens_league_id        = wc.women_league_id,
       mens_league_division    = (SELECT name FROM public.world_leagues WHERE id = wc.men_league_id),
       womens_league_division  = (SELECT name FROM public.world_leagues WHERE id = wc.women_league_id),
       world_region_id         = COALESCE(p.world_region_id, wc.province_id)
  FROM public.world_clubs wc
 WHERE wc.is_claimed = true
   AND wc.claimed_profile_id = p.id
   AND p.role = 'club'
   AND p.current_world_club_id IS NULL;
