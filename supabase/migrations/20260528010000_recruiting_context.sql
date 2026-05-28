-- ─────────────────────────────────────────────────────────────────────
-- recruiting_context — persistent scouting anchor for clubs + coaches
-- ─────────────────────────────────────────────────────────────────────
-- Sprint 2 of the recruitment intelligence layer (2026-05-28).
--
-- Adds an explicit "what am I recruiting for right now?" anchor that
-- can override the implicit context derived from a club's profile.
-- Solves the Mixed-club problem from Sprint 1: when E2E Test FC has
-- both men's + women's leagues set, the implicit target is 'Mixed'
-- and the Fit signal can't differentiate. With this table, the
-- recruiter can say "I'm scouting for our women's team this week"
-- and Fit scopes accordingly — without changing the underlying
-- club profile.
--
-- Scope rules:
--   - One ACTIVE context per owner (enforced via partial unique index).
--   - Owners can have multiple contexts saved; only one is the active
--     one driving Fit / carousel filter / grid sort at any time.
--   - Clubs auto-seeded with a `type='club'` context on migration
--     (target_category derived from their league columns).
--   - Coaches NOT auto-seeded — they get an outlined "Set recruiting
--     context →" empty-state in the UI per the agreed product policy.
--   - Players / brands / umpires never see the switcher; no contexts
--     are created for them.
--
-- Forward-compat:
--   - `type='opportunity'` + `opportunity_id` reserved for a future
--     slice where a context can be auto-set per opportunity.
--   - `type='custom'` covers free-form scouting contexts (e.g., "Latin
--     America players for next season").
--   - `competition_id` (nullable FK to world_leagues) lets a future
--     slice add explicit competition scoping; v1 derives it from the
--     viewer's profile if needed.
--   - `region` (text) for free-form geographic scoping.

BEGIN;

CREATE TABLE IF NOT EXISTS public.recruiting_context (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('club', 'opportunity', 'custom')),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  target_category TEXT CHECK (target_category IN ('Men', 'Women', 'Mixed')),
  -- world_leagues.id is INTEGER, not UUID — match the upstream type.
  competition_id  INTEGER REFERENCES public.world_leagues(id),
  region          TEXT,
  opportunity_id  UUID REFERENCES public.opportunities(id) ON DELETE SET NULL,
  label           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE public.recruiting_context IS
  'Persistent "what am I recruiting for?" anchor for clubs + coaches. Drives Club Fit, carousel filter, grid sort. Owner-only via RLS.';

-- One active context per owner. Switching active = deactivate old +
-- activate new in a single transaction (handled in the API layer).
CREATE UNIQUE INDEX IF NOT EXISTS recruiting_context_one_active_per_owner
  ON public.recruiting_context (owner_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS recruiting_context_owner_idx
  ON public.recruiting_context (owner_id, created_at DESC);

-- Updated_at trigger (reuses the existing shared helper).
CREATE TRIGGER recruiting_context_set_updated_at
  BEFORE UPDATE ON public.recruiting_context
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public.recruiting_context ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recruiting_context_owner_read" ON public.recruiting_context;
CREATE POLICY "recruiting_context_owner_read"
  ON public.recruiting_context FOR SELECT
  USING (auth.uid() = owner_id OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "recruiting_context_owner_insert" ON public.recruiting_context;
CREATE POLICY "recruiting_context_owner_insert"
  ON public.recruiting_context FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR auth.uid() = owner_id
  );

DROP POLICY IF EXISTS "recruiting_context_owner_update" ON public.recruiting_context;
CREATE POLICY "recruiting_context_owner_update"
  ON public.recruiting_context FOR UPDATE
  USING (auth.role() = 'service_role' OR auth.uid() = owner_id)
  WITH CHECK (auth.role() = 'service_role' OR auth.uid() = owner_id);

DROP POLICY IF EXISTS "recruiting_context_owner_delete" ON public.recruiting_context;
CREATE POLICY "recruiting_context_owner_delete"
  ON public.recruiting_context FOR DELETE
  USING (auth.role() = 'service_role' OR auth.uid() = owner_id);

-- Required GRANTs (Supabase Data API hardening from Oct 30, 2026).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recruiting_context TO authenticated;
GRANT ALL ON public.recruiting_context TO service_role;

-- ── Backfill for existing clubs ───────────────────────────────────────
-- For every existing club WITHOUT a context, create one based on their
-- declared leagues. Idempotent — re-runs are no-ops because of the
-- NOT EXISTS guard.
--
-- Resolution rule (mirrors deriveTargetCategory in lib/recruitingContext.ts):
--   - womens_league_division set + mens null → target_category='Women'
--   - mens_league_division set + womens null → target_category='Men'
--   - both set                                → target_category='Mixed'
--   - neither set                              → target_category=NULL
--
-- target_category=NULL is intentional: the context exists but Fit math
-- still requires a category, so the chip stays hidden until the club
-- picks one via the UI. Honest absence > false signal.

INSERT INTO public.recruiting_context (
  owner_id, type, is_active, target_category, region, label
)
SELECT
  p.id,
  'club',
  TRUE,
  CASE
    WHEN p.womens_league_division IS NOT NULL
      AND p.mens_league_division IS NOT NULL THEN 'Mixed'
    WHEN p.womens_league_division IS NOT NULL THEN 'Women'
    WHEN p.mens_league_division IS NOT NULL THEN 'Men'
    ELSE NULL
  END,
  p.base_city,
  -- Auto-label: "{club name} · {target} · {city}". When pieces are
  -- missing we drop them cleanly so we never render dangling dots.
  trim(both ' ·' FROM concat_ws(
    ' · ',
    NULLIF(trim(coalesce(p.full_name, '')), ''),
    CASE
      WHEN p.womens_league_division IS NOT NULL
        AND p.mens_league_division IS NOT NULL THEN 'Mixed'
      WHEN p.womens_league_division IS NOT NULL THEN 'Women'
      WHEN p.mens_league_division IS NOT NULL THEN 'Men'
      ELSE NULL
    END,
    NULLIF(trim(coalesce(p.base_city, '')), '')
  ))
FROM public.profiles p
WHERE p.role = 'club'
  AND NOT EXISTS (
    SELECT 1 FROM public.recruiting_context rc
    WHERE rc.owner_id = p.id
  );

COMMIT;
