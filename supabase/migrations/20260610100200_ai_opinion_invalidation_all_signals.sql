-- ============================================================================
-- AI Opinion cache invalidation must cover ALL context_hash inputs (audit High)
-- ============================================================================
-- Problem: the proactive invalidation triggers from 20260528150000 predate the
-- scope/intent columns added later. The edge function's context_hash
-- (supabase/functions/ai-opinion/index.ts) now includes player candidate-intent
-- (level_target, opportunity_preference, relocation_willingness, available_from),
-- coach fields (coach_specialization, coaching_categories), and recruiting-scope
-- intent (target_level/compensation/problem/role/position/location/start_date).
-- The client mount-read (useAIOpinion.ts) takes the newest row WITHOUT a
-- context_hash filter, so when one of these drifts and no trigger fires, a
-- recruiter sees a verdict written for the OLD scope/profile for up to the 24h
-- TTL — contradicting the deterministic verdict card rendered right above it.
--
-- Fix: extend the profiles trigger to the 6 missing fields, and make the
-- recruiting_context UPDATE trigger fire on ANY update of an active row (robust
-- against future scope columns drifting from the hash). The invalidation
-- FUNCTIONS are unchanged; only the triggers are recreated.

-- ── profiles: add the 6 missing candidate-intent / coach fields ─────────────
DROP TRIGGER IF EXISTS profiles_invalidate_ai_opinions ON public.profiles;
CREATE TRIGGER profiles_invalidate_ai_opinions
  AFTER UPDATE OF
    playing_category,
    open_to_play,
    open_to_coach,
    open_to_opportunities,
    current_world_club_id,
    mens_league_id,
    womens_league_id,
    accepted_reference_count,
    career_entry_count,
    highlight_video_url,
    full_game_video_count,
    -- #5: candidate-intent + coach fields that feed context_hash but were
    -- never tracked here. Keep this list in lockstep with computeContextHash
    -- in supabase/functions/ai-opinion/index.ts.
    level_target,
    opportunity_preference,
    relocation_willingness,
    available_from,
    coach_specialization,
    coaching_categories
  ON public.profiles
  FOR EACH ROW
  WHEN (
    OLD.playing_category            IS DISTINCT FROM NEW.playing_category
    OR OLD.open_to_play             IS DISTINCT FROM NEW.open_to_play
    OR OLD.open_to_coach            IS DISTINCT FROM NEW.open_to_coach
    OR OLD.open_to_opportunities    IS DISTINCT FROM NEW.open_to_opportunities
    OR OLD.current_world_club_id    IS DISTINCT FROM NEW.current_world_club_id
    OR OLD.mens_league_id           IS DISTINCT FROM NEW.mens_league_id
    OR OLD.womens_league_id         IS DISTINCT FROM NEW.womens_league_id
    OR OLD.accepted_reference_count IS DISTINCT FROM NEW.accepted_reference_count
    OR OLD.career_entry_count       IS DISTINCT FROM NEW.career_entry_count
    OR OLD.highlight_video_url      IS DISTINCT FROM NEW.highlight_video_url
    OR OLD.full_game_video_count    IS DISTINCT FROM NEW.full_game_video_count
    OR OLD.level_target             IS DISTINCT FROM NEW.level_target
    OR OLD.opportunity_preference   IS DISTINCT FROM NEW.opportunity_preference
    OR OLD.relocation_willingness   IS DISTINCT FROM NEW.relocation_willingness
    OR OLD.available_from           IS DISTINCT FROM NEW.available_from
    OR OLD.coach_specialization     IS DISTINCT FROM NEW.coach_specialization
    OR OLD.coaching_categories      IS DISTINCT FROM NEW.coaching_categories
  )
  EXECUTE FUNCTION public.invalidate_ai_opinions_on_profile_change();

-- ── recruiting_context UPDATE: invalidate on ANY update of an active row ────
-- The scope carries target_level/compensation/problem/role/position/location/
-- start_date (all in context_hash) — rather than re-enumerate (and drift again
-- as new scope fields are added), invalidate whenever a row that is (or was)
-- active changes at all. INSERT + DELETE triggers from 20260528150000 are left
-- in place.
DROP TRIGGER IF EXISTS recruiting_context_invalidate_ai_opinions_update ON public.recruiting_context;
CREATE TRIGGER recruiting_context_invalidate_ai_opinions_update
  AFTER UPDATE ON public.recruiting_context
  FOR EACH ROW
  WHEN (COALESCE(NEW.is_active, false) OR COALESCE(OLD.is_active, false))
  EXECUTE FUNCTION public.invalidate_ai_opinions_on_recruiting_context_change();
