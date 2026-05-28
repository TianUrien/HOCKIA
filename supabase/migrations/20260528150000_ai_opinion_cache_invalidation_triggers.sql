-- ─────────────────────────────────────────────────────────────────────
-- ai_opinion cache invalidation triggers — Section F Phase 2 Slice B2
-- ─────────────────────────────────────────────────────────────────────
-- Proactive cache invalidation: DELETE ai_opinions rows when an input
-- that would change the verdict mutates upstream.
--
-- Why this exists:
-- The client hook (useAIOpinion) does a local PostgREST GET on mount
-- to short-circuit the edge function when a fresh row exists. That
-- pre-flight does NOT filter by context_hash (the client can't
-- compute it) — it just grabs the most recent un-expired row for
-- (viewer, player). So when a player updates a prompt-relevant
-- field, the lazy hash-drift invalidation that Slice B1 set up only
-- kicks in on Regenerate, not on plain mount. Mount-time reads
-- continue serving the stale verdict for up to 24h.
--
-- These triggers close that gap by deleting cached rows at the
-- source of truth. After mutation, the hook's GET finds nothing and
-- falls through to the edge function for a fresh generation.
--
-- Two triggers:
--   1. profiles_invalidate_ai_opinions
--        Fires when any of the prompt's player-side or viewer-side
--        fields change on a profile. Invalidates BOTH directions:
--        - viewer_id = NEW.id (this profile is a recruiter whose
--          scope changed → their cached verdicts about anyone are
--          stale)
--        - player_id = NEW.id (this profile is a player whose facts
--          changed → all recruiters' cached verdicts about them are
--          stale)
--   2. recruiting_context_invalidate_ai_opinions
--        Fires on any INSERT/UPDATE/DELETE that changes a viewer's
--        active target. Invalidates that viewer's rows.
--
-- Cost: each mutation triggers at most one DELETE statement, scoped
-- by an index (viewer_id + player_id). For a recruiter with N
-- cached opinions, N rows get deleted. For most profiles N is < 10
-- so this is cheap. We do NOT cascade into ai_opinion_feedback —
-- those rows have ON DELETE CASCADE on the FK so they go with their
-- opinion rows automatically.

BEGIN;

-- ── profiles trigger ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invalidate_ai_opinions_on_profile_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Both directions: profile may be a viewer (recruiter) or a player
  -- subject of cached opinions. ON DELETE CASCADE on the FKs handles
  -- ai_opinions when a profile is hard-deleted; this trigger only
  -- handles UPDATEs where the row stays but its prompt inputs drift.
  DELETE FROM public.ai_opinions
  WHERE viewer_id = NEW.id OR player_id = NEW.id;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.invalidate_ai_opinions_on_profile_change() IS
  'Section F Phase 2 Slice B2: proactive cache invalidation on profiles UPDATE. Fires when any prompt-relevant field changes — see migration 20260528150000 for the field list.';

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
    full_game_video_count
  ON public.profiles
  FOR EACH ROW
  -- WHEN clause filters down to actual value changes (not no-op
  -- UPDATEs that touch the row without changing any tracked column).
  -- For nullable columns, IS DISTINCT FROM handles NULL transitions
  -- correctly where plain <> would return NULL.
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
  )
  EXECUTE FUNCTION public.invalidate_ai_opinions_on_profile_change();

-- ── recruiting_context trigger ──────────────────────────────────────
-- Switching active recruiting context changes the viewer's
-- target_category, which is in the prompt and the cache key. Hook's
-- mount-path would serve the prior context's verdict otherwise.
CREATE OR REPLACE FUNCTION public.invalidate_ai_opinions_on_recruiting_context_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  owner UUID;
BEGIN
  -- On DELETE, OLD.owner_id is the only reference we have.
  -- On INSERT/UPDATE, NEW.owner_id is the active row's owner.
  owner := COALESCE(NEW.owner_id, OLD.owner_id);
  IF owner IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  DELETE FROM public.ai_opinions WHERE viewer_id = owner;
  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.invalidate_ai_opinions_on_recruiting_context_change() IS
  'Section F Phase 2 Slice B2: invalidates a viewer''s cached ai_opinions when their recruiting context changes (insert/update/delete).';

-- INSERT: new active context → invalidate the viewer's cached rows
-- (which were scoped to a prior target or no target).
DROP TRIGGER IF EXISTS recruiting_context_invalidate_ai_opinions_insert ON public.recruiting_context;
CREATE TRIGGER recruiting_context_invalidate_ai_opinions_insert
  AFTER INSERT ON public.recruiting_context
  FOR EACH ROW
  WHEN (NEW.is_active = true)
  EXECUTE FUNCTION public.invalidate_ai_opinions_on_recruiting_context_change();

-- UPDATE: target_category or is_active flipped.
DROP TRIGGER IF EXISTS recruiting_context_invalidate_ai_opinions_update ON public.recruiting_context;
CREATE TRIGGER recruiting_context_invalidate_ai_opinions_update
  AFTER UPDATE OF target_category, is_active ON public.recruiting_context
  FOR EACH ROW
  WHEN (
    OLD.target_category IS DISTINCT FROM NEW.target_category
    OR OLD.is_active    IS DISTINCT FROM NEW.is_active
  )
  EXECUTE FUNCTION public.invalidate_ai_opinions_on_recruiting_context_change();

-- DELETE: active context removed → prior cached rows belong to a
-- recruiter who now has no target.
DROP TRIGGER IF EXISTS recruiting_context_invalidate_ai_opinions_delete ON public.recruiting_context;
CREATE TRIGGER recruiting_context_invalidate_ai_opinions_delete
  AFTER DELETE ON public.recruiting_context
  FOR EACH ROW
  WHEN (OLD.is_active = true)
  EXECUTE FUNCTION public.invalidate_ai_opinions_on_recruiting_context_change();

COMMIT;
